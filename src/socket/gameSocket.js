import Game from "../models/Game.js";
import GlobalChat from "../models/GlobalChat.js";
import User from "../models/User.js";
import uniqId from "uniqid";

const games = {}
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
    const doctorCount = playerCount >= 3 ? 1 : 0;
    const detectiveCount = playerCount >= 4 ? 1 : 0;

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

      console.log(`⏲️ ${roomId}: ${current.timeLeft}s left`);

      if (current.timeLeft <= 0) {
        clearInterval(current.interval);
        delete roomTimers[roomId];
        io.to(roomId).emit("timer_end");

        try {
          const gameRoom = await Game.findOne({ roomId });
          if (!gameRoom) return;

          console.log(`🔁 Faza almashtirilmoqda | Hozirgi faza: ${gameRoom.phase}`);

          if (gameRoom.phase === "started") {
            gameRoom.phase = "night";
            startRoomTimer(roomId, 10);
          } else if (gameRoom.phase === "night") {
            gameRoom.phase = "day";
            startRoomTimer(roomId, 10);
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
    socket.emit("your_socket_id", socket.id);

    socket.on("mafia_kill", ({ roomId, killerId, targetId }) => {
      console.log({ roomId, killerId, targetId });
      const game = games[roomId]; // roomId endi string, OK!
      console.log("game", game)
      console.log("games object:", games);
      console.log("roomId in request:", roomId);

      if (!game) return;
      const killer = game.players.find(p => p._id.toString() === killerId);
      const target = game.players.find(p => p._id.toString() === targetId);

      console.log("killer", killer)
      console.log("target", target)
      // ❗ Tekshiruvlar
      if (!killer || !target) return;
      if (killer.role !== "mafia") return;
      if (!killer.isAlive) return;

      // ❗ Har kechada faqat 1 marta otish
      if (game.hasMafiaKilled) {
        socket.emit("error_message", `Siz 1ta oyinchini otib bo'lgansiz`);
        return;
      }

      // ❗ O‘ldirish
      target.isAlive = false;
      game.hasMafiaKilled = true;

      // ❗ Hammani xabardor qilish
      io.to(roomId).emit("player_killed", {
        killerId,
        targetId,
        targetUsername: target.username,
      });

      console.log(`💀 Mafia killed: ${target.username} (ID: ${targetId})`);
    });

    socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
      console.log({ roomId, doctorId, targetId })
      const game = games[roomId];
      console.log("game", game)
      if (!game) return;
    
      const doctor = game.players.find(p => p._id.toString() === doctorId);
      const target = game.players.find(p => p._id.toString() === targetId);
      console.log("doctr", doctor)
      console.log("target", target)
      if (!doctor || !target) return;
      if (doctor.role !== "doctor") return;
      if (!doctor.isAlive) return;
    
      if (game.hasDoctorHealed) {
        socket.emit("error_message", "Siz allaqachon davolagansiz.");
        return;
      }
    
      // 1️⃣ Xotirada yangilash
      target.isAlive = true;
      game.savedPlayerId = target._id.toString();
      game.hasDoctorHealed = true;
    
      // 2️⃣ Bazada yangilash
      await Game.updateOne(
        { roomId, "players.userId": target._id },
        { $set: { "players.$.isAlive": true } }
      );
    
      // 3️⃣ Hammani xabardor qilish
      io.to(roomId).emit("doctor_healed", {
        doctorId,
        targetId,
        message: `👨‍⚕️ Doctor kimnidir davoladi!`
      });
    
      // 4️⃣ Yangi player ro'yxatini qayta yuborish
      const updatedRoom = await Game.findOne({ roomId });
      io.to(roomId).emit("game_players", updatedRoom);
    
      console.log(`Doctor (${doctor.username}) healed ${target.username}`);
    });
    

    socket.on("detective_check", ({ roomId, detectiveId, targetId }) => {
      const game = games[roomId];
      if (!game) return;

      const detective = game.players.find(p => p._id === detectiveId);
      const target = game.players.find(p => p._id === targetId);

      if (!detective || !target) return;
      if (detective.role !== "detective" || !detective.isAlive) return;
      if (game.hasDetectiveActed) return;

      game.hasDetectiveActed = true;
      socket.emit("detective_result", {
        targetId,
        role: target.role,
      });
    });


    socket.on("detective_kill", ({ roomId, detectiveId, targetId }) => {
      const game = games[roomId];
      if (!game) return;

      const detective = game.players.find(p => p._id === detectiveId);
      const target = game.players.find(p => p._id === targetId);
      console.log("detectiveKill", detective)
      console.log("target", target)
      if (!detective || !target) return;
      if (detective.role !== "detective" || !detective.isAlive || !target.isAlive) return;
      if (game.hasDetectiveActed) return;

      target.isAlive = false;
      game.hasDetectiveActed = true;

      io.to(roomId).emit("player_killed_by_detective", {
        detectiveId,
        targetId,
        message: `🕵️ Detektiv ${target.username} ni o‘ldirdi!`,
      });
    });


    socket.on("create_room", async (data) => {
      console.log("data users:", data);

      try {
        const owner = await User.findById(data.hostId)
        console.log("owner:", owner)
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

        console.log("debug players:", newRoom)

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

    socket.on("send_message", ({ roomId, message }) => {
      io.to(String(roomId)).emit("receive_message", message);
    });
    socket.on("add_voice", ({ roomId, selected, user }) => {
      const gameRoom = games[roomId];
      if (!gameRoom) return;

      const voter = gameRoom.players.find(p => p._id === user);
      const votedPlayer = gameRoom.players.find(p => p._id === selected);

      // Faqat isAlive bo'lganlar ovoz bera oladi
      if (!voter || !voter.isAlive || !votedPlayer || !votedPlayer.isAlive) return;

      // Dublikat ovoz berishni oldini olish
      if (!voter.voice) voter.voice = [];
      if (voter.voice.includes(selected)) return;

      voter.voice.push(selected); // ovoz berilgan

      // Ovoz sanash uchun hammasini yig'amiz
      const votes = {};

      for (let p of gameRoom.players) {
        if (p.voice && p.voice.length > 0) {
          const selectedId = p.voice[0];
          votes[selectedId] = (votes[selectedId] || 0) + 1;
        }
      }

      // Ko‘p ovoz olgan topiladi
      const maxVotes = Math.max(...Object.values(votes));
      const topVoted = Object.entries(votes)
        .filter(([_, count]) => count === maxVotes)
        .map(([id]) => id);

      // Faqat bitta eng ko‘p ovozli bo‘lsa, uni chiqaramiz
      let eliminatedPlayer = null;
      if (topVoted.length === 1) {
        eliminatedPlayer = gameRoom.players.find(p => p._id === topVoted[0]);
        if (eliminatedPlayer) eliminatedPlayer.isAlive = false;
      }

      io.to(roomId).emit("voice_results", {
        votes,
        eliminated: eliminatedPlayer ? {
          username: eliminatedPlayer.username,
          id: eliminatedPlayer._id,
          role: eliminatedPlayer.role
        } : null
      });
    });

    socket.on("remove_voice", ({ roomId, userId, user }) => {
      const gameRoom = games[roomId];
      if (!gameRoom) return;

      const voter = gameRoom.players.find(p => p._id === user);
      if (!voter || !voter.isAlive) return;

      // Agar oldin ovoz bergan bo‘lsa, o‘chirib tashlaymiz
      if (voter.voice && voter.voice.includes(userId)) {
        voter.voice = voter.voice.filter(v => v !== userId);
      }

      // Yangilangan ovozlarni hisoblab, frontga yuboramiz
      const votes = {};

      for (let p of gameRoom.players) {
        if (p.voice && p.voice.length > 0) {
          const selectedId = p.voice[0];
          votes[selectedId] = (votes[selectedId] || 0) + 1;
        }
      }

      // Qayta ovoz yetakchisini aniqlash
      const maxVotes = Math.max(...Object.values(votes), 0);
      const topVoted = Object.entries(votes)
        .filter(([_, count]) => count === maxVotes)
        .map(([id]) => id);

      let eliminatedPlayer = null;

      // Faqat bitta lider bo‘lsa
      if (topVoted.length === 1) {
        eliminatedPlayer = gameRoom.players.find(p => p._id === topVoted[0]);
      }

      io.to(roomId).emit("voice_results", {
        votes,
        eliminated: eliminatedPlayer
          ? {
            username: eliminatedPlayer.username,
            id: eliminatedPlayer._id,
            role: eliminatedPlayer.role,
          }
          : null,
      });
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
            voice: []
          });

          await gameRoom.save();
        }
        if (!games[roomId]) {
          games[roomId] = {
            mafiaKill: null,
            doctorSave: null,
            detectiveCheck: null,
            hasMafiaActed: false,
            hasDoctorActed: false,
            hasDetectiveActed: false, // 🟢 MUHIM QATOR!
          };
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
          games[roomId] = {
            players: shuffled.map(p => ({
              _id: p.userId.toString(),     // ❗ Bu yerni ObjectId dan stringga aylantiring
              username: p.username,
              role: p.gameRole,
              isAlive: true,
            })),
            hasMafiaKilled: false,
            phase: "night"
          };
          io.to(roomId).emit("start_game");
          io.to(roomId).emit("game_players", gameRoom);
          io.to(roomId).emit("game_phase", gameRoom);

          startRoomTimer(roomId, 10);
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
          startRoomTimer(roomId, 10);
        } else if (gameRoom.phase === "night") {
          gameRoom.phase = "day";
          startRoomTimer(roomId, 10);
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
  });
};
