import Game from "../models/Game.js";
import GlobalChat from "../models/GlobalChat.js";
import User from "../models/User.js";
import uniqId from "uniqid";

export const socketHandler = (io) => {
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
    console.log("⏱️ startRoomTimer():", roomId, durationInSeconds);

    if (roomTimers[roomId]?.interval) {
      clearInterval(roomTimers[roomId].interval);
    }

    roomTimers[roomId] = {
      timeLeft: durationInSeconds,
      interval: null,
    };

    roomTimers[roomId].interval = setInterval(async () => {
      const current = roomTimers[roomId];
      if (!current) return;

      console.log(`⏲ ${roomId}: ${current.timeLeft}s left`);

      if (current.timeLeft <= 0) {
        clearInterval(current.interval);
        delete roomTimers[roomId];
        io.to(roomId).emit("timer_end");

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

      io.to(roomId).emit("timer_update", { timeLeft: current.timeLeft });
      current.timeLeft--;
    }, 1000);
  };

  const getTimeLeftForRoom = (roomId) => {
    return roomTimers[roomId]?.timeLeft ?? null;
  };

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("create_room", async (data) => {
      console.log("data users:", data);
      try {
        const owner = await User.findById(data.hostId);
        console.log("owner:", owner);
        const newRoom = await Game.create({
          roomId: uniqId(),
          roomName: data.roomName,
          players: [],
          hostId: data.hostId,
          phase: "waiting",
        });

        // 2. Roomga hostni qo‘shamiz
        newRoom.players.push({
          userId: owner._id,
          username: owner.username, // kerakli nom kelsin
          isAlive: true,
          isReady: false,
          voice: [],
        });

        console.log("debug players:", newRoom);

        await newRoom.save(); // host qo‘shilgach saqlaymiz

        // 3. Hostni roomga qo‘shamiz (socket.join)
        socket.join(newRoom.roomId);
        socket.data.userId = data.hostId;
        socket.data.roomId = newRoom.roomId;

        // 4. Emit qilish
        socket.emit("joined_room", newRoom);
        io.to(newRoom.roomId).emit("update_players", newRoom.players);
        io.to(newRoom.roomId).emit("game_players", newRoom);
        io.to(newRoom.roomId).emit("game_phase", newRoom);
        await sendRooms();
        console.log("Room debug:", [newRoom]);
        console.log("Game:", Game);
      } catch (err) {
        console.log(err);
      }
    });

    socket.on("send_message", async (data) => {
      try {
        console.log("message keldi:", data);

        const newMessage = await GlobalChat.create({
          sender: data.user.user._id, // user._id bo'lishi kerak
          text: data.message,
        });

        // Populate sender so we get the full user object (not just _id)
        const populatedMessage = await newMessage.populate(
          "sender",
          "_id username avatar role"
        );

        console.log("message saved:", populatedMessage);

        io.emit("receive_message", populatedMessage);
      } catch (err) {
        console.error("❌ send_message error:", err.message);
      }
    });

    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    socket.on("game_chat", ({ roomId, message }) => {
      console.log("message keldi:", message);
      io.to(String(roomId)).emit("receive_chat_message", message);
    });

    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );

        const allRooms = await Game.find({ "players.userId": userId });

        // 🛑 Agar u boshqa roomda bo‘lsa va bu room emas bo‘lsa → rad qilamiz
        const alreadyInOtherRoom = allRooms.some((r) => r.roomId !== roomId);

        if (alreadyInOtherRoom) {
          socket.emit("notification", {
            type: "error",
            message:
              "Siz boshqa xonada ishtirok etyapsiz. Avval u xonadan chiqing.",
          });
          return;
        }

        // ✅ Agar u allaqachon shu roomda bo‘lsa — socket.join() qilamiz xolos
        if (!alreadyInRoom) {
          gameRoom.players.push({
            userId,
            username,
            isAlive: true,
            isReady: false,
            voice: [],
          });

          await gameRoom.save();
        }

        socket.join(roomId);
        socket.data.userId = userId;
        socket.data.roomId = roomId;

        socket.emit("joined_room", gameRoom);
        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("game_players", gameRoom);
        io.to(roomId).emit("game_phase", gameRoom);
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
          const shuffled = [...gameRoom.players].sort(
            () => Math.random() - 0.5
          );
          const roles = generateRoles(shuffled.length);
          shuffled.forEach((player, i) => {
            player.gameRole = roles[i];
          });

          gameRoom.phase = "started";
          await gameRoom.save();

          io.to(roomId).emit("start_game");
          io.to(roomId).emit("game_players", gameRoom);
          io.to(roomId).emit("game_phase", gameRoom);

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
      } catch (e) {
        console.error("❌ game_phase error:", e.message);
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
            clearInterval(roomTimers[roomId].interval);
            delete roomTimers[roomId];
          }
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        await sendRooms();
      } catch (e) {
        console.error("❌ leave_room error:", e);
      }
    });

    socket.on("disconnect", async () => {
      const { userId, roomId } = socket.data || {};
      if (!userId || !roomId) return;

      try {
        await Game.updateOne({ roomId }, { $pull: { players: { userId } } });
        const updatedRoom = await Game.findOne({ roomId });

        if (updatedRoom?.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          if (roomTimers[roomId]) {
            clearInterval(roomTimers[roomId].interval);
            delete roomTimers[roomId];
          }
        } else {
          io.to(roomId).emit("update_players", updatedRoom.players);
        }

        socket.leave(roomId);
        await sendRooms();
      } catch (err) {
        console.error("❌ disconnect error:", err.message);
      }
    });

    socket.on("get_players", async (roomId) => {
      const gameRoom = await Game.findOne({ roomId });
      if (gameRoom) {
        socket.emit("update_players", gameRoom.players);
        socket.emit("game_players", gameRoom);
        socket.emit("game_phase", gameRoom);

        const timeLeft = getTimeLeftForRoom(roomId);

        if (timeLeft !== null) {
          socket.emit("timer_update", { timeLeft });

          const timerObj = roomTimers[roomId];
          if (!timerObj || typeof timerObj.interval !== "object") {
            console.log("⏳ Timer is being restarted after reload:", roomId);
            startRoomTimer(roomId, timeLeft);
          }
        }
      }
    });

    socket.on("vote_player", async ({ roomId, voterId, targetUserId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const voter = gameRoom.players.find(
          (p) => p.userId.toString() === voterId
        );
        if (!voter || !voter.isAlive) return;

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target || !target.isAlive) return;

        target.votes = (target.votes || 0) + 1;

        await gameRoom.save();
        io.to(roomId).emit("player_voted", {
          targetUserId,
          votes: target.votes,
        });
      } catch (e) {
        console.error("❌ vote_player error:", e.message);
      }
    });

    socket.on("check_player", async ({ roomId, checkerId, targetUserId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const checker = gameRoom.players.find(
          (p) => p.userId.toString() === checkerId
        );
        if (!checker || checker.gameRole !== "detective") return;

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target) return;

        // Only show role to the checker (not to everyone)
        socket.emit("check_result", {
          targetUserId,
          role: target.gameRole,
        });
      } catch (e) {
        console.error("❌ check_player error:", e.message);
      }
    });

    // 💉 Doctor heals a player
    socket.on("take_health", async ({ roomId, doctorId, targetUserId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const doctor = gameRoom.players.find(
          (p) => p.userId.toString() === doctorId
        );
        if (!doctor || doctor.gameRole !== "doctor") return;

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target) return;

        target.isHealed = true;
        await gameRoom.save();
      } catch (e) {
        console.error("❌ take_health error:", e.message);
      }
    });

    // 🔪 Mafia kills a player
    socket.on("kill_player", async ({ roomId, killerId, targetUserId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const killer = gameRoom.players.find(
          (p) => p.userId.toString() === killerId
        );
        if (!killer || killer.gameRole !== "mafia") return;

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target || !target.isAlive) return;

        // Check if healed
        if (target.isHealed) {
          target.isHealed = false; // Reset healing for next night
        } else {
          target.isAlive = false;
        }

        await gameRoom.save();
        io.to(roomId).emit("update_players", gameRoom.players);
      } catch (e) {
        console.error("❌ kill_player error:", e.message);
      }
    });
  });
};
