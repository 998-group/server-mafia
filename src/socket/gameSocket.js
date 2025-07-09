import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map();
  const roomTimers = {};

  const sendRooms = async () => {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    io.emit("update_rooms", rooms);
  };

  const generateRoles = (playerCount) => {
    const roles = [];
    const mafiaCount = Math.max(1, Math.floor(playerCount / 4));
    const doctorCount = playerCount >= 5 ? 1 : 0;
    const detectiveCount = playerCount >= 6 ? 1 : 0;

    for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
    if (doctorCount) roles.push("doctor");
    if (detectiveCount) roles.push("detective");

    while (roles.length < playerCount) roles.push("peaceful");

    return roles.sort(() => Math.random() - 0.5);
  };

  const startRoomTimer = (roomId, durationInSeconds) => {
    let timeLeft = durationInSeconds;
  
    if (roomTimers[roomId]) {
      clearInterval(roomTimers[roomId]);
      console.log(`♻️ Oldingi timer tozalandi: ${roomId}`);
    }
  
    console.log(`⏳ Timer boshladi | Room: ${roomId} | Duration: ${durationInSeconds}s`);
  
    roomTimers[roomId] = setInterval(async () => {
      io.to(roomId).emit("timer_update", { timeLeft });
  
      // DEBUG uchun log
      if (timeLeft % 10 === 0 || timeLeft <= 5) {
        console.log(`⏱️ ${roomId}: Qolgan vaqt - ${timeLeft}s`);
      }
  
      if (timeLeft <= 0) {
        clearInterval(roomTimers[roomId]);
        delete roomTimers[roomId];
        console.log(`✅ Timer tugadi | Room: ${roomId}`);
  
        io.to(roomId).emit("timer_end");
  
        try {
          const gameRoom = await Game.findOne({ roomId });
          if (!gameRoom) return;
  
          console.log(`🔁 Faza almashtirilmoqda | Hozirgi faza: ${gameRoom.phase}`);
  
          if (gameRoom.phase === "started") {
            gameRoom.phase = "night";
            startRoomTimer(roomId, 180);
          } else if (gameRoom.phase === "night") {
            gameRoom.phase = "day";
            startRoomTimer(roomId, 180);
          } else if (gameRoom.phase === "day") {
            gameRoom.phase = "ended";
            gameRoom.endedAt = new Date();
            startRoomTimer(roomId, 10);
          } else if (gameRoom.phase === "ended") {
            gameRoom.phase = "waiting";
            gameRoom.winner = null;
            gameRoom.currentTurn = 0;
            gameRoom.players.forEach((p) => {
              p.isReady = false;
              p.isAlive = true;
              p.gameRole = null;
            });
          }
  
          await gameRoom.save();
          io.to(roomId).emit("game_phase", gameRoom);
          io.to(roomId).emit("game_players", gameRoom);
        } catch (err) {
          console.error("❌ Auto-phase error:", err.message);
        }
  
        return;
      }
  
      timeLeft--;
    }, 1000);
  };
  
  


  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    socket.on("send_message", ({ roomId, message }) => {
      io.to(String(roomId)).emit("receive_message", message);
    });

    socket.on("join_test", async (roomId) => {
      try {
        await socket.join(String(roomId));
        io.to(roomId).emit("test_message", "Welcome to test room!");
      } catch (err) {
        console.error("❌ join_test error:", err);
      }
    });

    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );

        if (!alreadyInRoom) {
          gameRoom.players.push({
            userId,
            username,
            isAlive: true,
            isReady: false,
          });
          await gameRoom.save();
        }

        socket.join(roomId);
        socketUserMap.set(socket.id, { userId, roomId });
        socket.emit("joined_room", gameRoom);
        io.to(roomId).emit("update_players", gameRoom.players);
      } catch (e) {
        console.error("❌ join_room error:", e.message);
      }
    });

    socket.on("ready", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId
        );
        if (!player) return;

        player.isReady = !player.isReady;
        await gameRoom.save();

        socket.emit("notification", {
          type: "success",
          message: player.isReady ? "You are ready" : "You are not ready",
        });

        io.to(roomId).emit("update_players", gameRoom.players);

        const allReady =
          gameRoom.players.length >= 2 &&
          gameRoom.players.every((p) => p.isReady);

        if (allReady) {
          // 🔰 Role tayinlash
          const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
          const roles = generateRoles(shuffled.length);
          shuffled.forEach((player, i) => {
            player.gameRole = roles[i];
          });

          gameRoom.phase = "started";
          await gameRoom.save();

          io.to(roomId).emit("start_game");
          io.to(roomId).emit("game_players", gameRoom);
          startRoomTimer(roomId, 60);
        }
      } catch (e) {
        console.error("❌ ready error:", e);
      }
    });

    socket.on("start_timer", ({ roomId, duration }) => {
      startRoomTimer(roomId, duration);
    });

    socket.on("game_phase", async ({ roomId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        if (gameRoom.phase === "started") {
          gameRoom.phase = "night";
          startRoomTimer(roomId, 180);
        } else if (gameRoom.phase === "night") {
          gameRoom.phase = "day";
          startRoomTimer(roomId, 180);
        } else if (gameRoom.phase === "day") {
          gameRoom.phase = "ended";
          gameRoom.endedAt = new Date();
          startRoomTimer(roomId, 180);
        } else if (gameRoom.phase === "ended") {
          gameRoom.phase = "waiting";
          gameRoom.winner = null;
          gameRoom.currentTurn = 0;
          gameRoom.players.forEach((p) => {
            p.isReady = false;
            p.isAlive = true;
            p.gameRole = null;
          });
        }

        await gameRoom.save();
        io.to(roomId).emit("game_phase", gameRoom);
      } catch (e) {
        console.error("❌ game_phase error:", e.message);
      }
    });
    socket.on("get_game_status", async ({ roomId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (gameRoom) {
          const roomTimer = roomTimers[roomId];
          let timeLeft = 0;
    
          if (roomTimer && roomTimer._idleStart && roomTimer._idleTimeout) {
            const elapsed = (Date.now() - roomTimer._idleStart) / 1000;
            timeLeft = Math.max(0, roomTimer._idleTimeout / 1000 - elapsed);
          }
    
          console.log(`🔎 get_game_status: Room ${roomId} | Phase: ${gameRoom.phase} | TimeLeft: ${Math.floor(timeLeft)}s`);
    
          socket.emit("game_status", {
            timeLeft: Math.floor(timeLeft),
            phase: gameRoom.phase,
          });
        }
      } catch (err) {
        console.error("❌ get_game_status error:", err.message);
      }
    });
    

    socket.on("leave_room", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          if (roomTimers[roomId]) {
            clearInterval(roomTimers[roomId]);
            delete roomTimers[roomId];
          }
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        socketUserMap.delete(socket.id);
        await sendRooms();
      } catch (e) {
        console.error("❌ leave_room error:", e);
      }
    });

    socket.on("disconnect", async () => {
      const session = socketUserMap.get(socket.id);
      if (!session) return;

      const { userId, roomId } = session;

      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          if (roomTimers[roomId]) {
            clearInterval(roomTimers[roomId]);
            delete roomTimers[roomId];
          }
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        socketUserMap.delete(socket.id);
        await sendRooms();
      } catch (err) {
        console.error("❌ disconnect error:", err);
      }
    });

    socket.on("get_players", async (data) => {
      const gameRoom = await Game.findOne({ roomId: data });
      if (gameRoom) {
        socket.emit("update_players", gameRoom.players);
      }
    });
  });
};
