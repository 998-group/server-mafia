import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map();
  const roomTimers = {}; // 🕒 Сюда будем сохранять таймеры по комнатам

  const sendRooms = async () => {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    io.emit("update_rooms", rooms);
  };

  // 🕒 Функция запуска таймера для комнаты
  const startRoomTimer = (roomId, durationInSeconds) => {
    let timeLeft = durationInSeconds;

    if (roomTimers[roomId]) {
      clearInterval(roomTimers[roomId]);
    }

    roomTimers[roomId] = setInterval(() => {
      if (timeLeft <= 0) {
        clearInterval(roomTimers[roomId]);
        delete roomTimers[roomId];
        io.to(roomId).emit("timer_end");
        console.log(`⏰ Timer for room ${roomId} ended`);
        return;
      }

      io.to(roomId).emit("timer_update", { timeLeft });
      console.log(`🕒 Room ${roomId} - Time left: ${timeLeft} seconds`); // ✅ Вот эта строка добавлена

      timeLeft--;
    }, 1000);

    console.log(
      `🕒 Timer started for room ${roomId}: ${durationInSeconds} seconds`
    );
  };

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // 🔹 REQUEST ROOMS
    socket.on("request_rooms", async () => {
      console.log("📥 Event: request_rooms");
      await sendRooms();
    });

    // 🔹 SEND MESSAGE
    socket.on("send_message", ({ roomId, message }) => {
      console.log("📥 Event: send_message");
      console.log("📩 Message received:", message);
      io.to(String(roomId)).emit("receive_message", message);
    });

    // 🔹 JOIN TEST ROOM
    socket.on("join_test", async (roomId) => {
      console.log("📥 Event: join_test");
      try {
        await socket.join(String(roomId));
        console.log("✅ Test room joined:", roomId);
        io.to(roomId).emit("test_message", "Welcome to test room!");
      } catch (err) {
        console.error("❌ join_test error:", err);
      }
    });

    // 🔹 JOIN GAME ROOM
    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        console.log("joined_game:", { userId, roomId });
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

    // 🔹 PLAYER READY
    socket.on("ready", async ({ roomId, userId }) => {
      console.log("📥 Event: ready");
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
          gameRoom.phase = "started";
          await gameRoom.save();
          console.log("Game room", gameRoom)

          io.to(roomId).emit("start_game");
          console.log("✅ START GAME");

          io.to(roomId).emit("game_players", gameRoom);
          console.log("📤 Game_Players");

          startRoomTimer(roomId, 60);
        }
      } catch (e) {
        console.error("❌ ready error:", e);
      }
    });

    socket.on("start_timer", ({ roomId, duration }) => {
      console.log(
        `📥 Event: start_timer for room ${roomId}, duration: ${duration}`
      );
      startRoomTimer(roomId, duration);
      
    });
    socket.on("game_phase", async ({ roomId }) => {
      console.log(`📥 Event: game_phase for room ${roomId}`);
      try {
        console.log("game phase", gameRoom.phase);
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        if (gameRoom.phase === "started") {
          gameRoom.phase = "night";
          startRoomTimer(roomId, 180); // 3 minut
        } else if (gameRoom.phase === "night") {
          gameRoom.phase = "day";
          startRoomTimer(roomId, 180); // 3 minut
        } else if (gameRoom.phase === "day") {
          gameRoom.endedAt = new Date();
          startRoomTimer(roomId, 180); // 3 minut
        } else if (gameRoom.phase === "ended") {
          gameRoom.phase = "waiting";
          gameRoom.winner = null;
          gameRoom.currentTurn = 0;
          gameRoom.players.forEach((p) => {
            p.isReady = false;
            p.isAlive = true;
            p.gameRole = null;
          });

        
          // ❌ No timer for waiting phase
        }

        await gameRoom.save();
        io.to(roomId).emit("game_phase", gameRoom);
        console.log(`🔁 Phase changed to: ${gameRoom.phase}`);
      } catch (e) {
        console.error("❌ game_phase error:", e.message);
      }
    });

    // 🔹 LEAVE ROOM
    socket.on("leave_room", async ({ roomId, userId }) => {
      console.log("📥 Event: leave_room");
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          // 🕒 Остановить таймер если все вышли
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

        console.log(`🚪 ${userId} left ${roomId}`);
      } catch (e) {
        console.error("❌ leave_room error:", e);
      }
    });

    // 🔹 DISCONNECT
    socket.on("disconnect", async () => {
      console.log("📥 Event: disconnect");
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

          // 🕒 Остановить таймер если никого нет
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

        console.log(`❌ Disconnected: ${userId}`);
      } catch (err) {
        console.error("❌ disconnect error:", err);
      }
    });

    // 🔹 GET PLAYERS
    socket.on("get_players", async (data) => {
      console.log("📥 Event: get_players", data);
      const gameRoom = await Game.findOne({ roomId: data });
      if (gameRoom) {
        socket.emit("update_players", gameRoom.players);
      }
    });
  });
};
