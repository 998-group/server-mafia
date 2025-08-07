import Game from "../models/Game.js";
import GlobalChat from "../models/GlobalChat.js";
import User from "../models/User.js";
import uniqId from "uniqid";

// Configuration constants
const PHASE_DURATIONS = {
  night: 180, // 3 minutes
  day: 180, // 3 minutes
  ended: 10, // 10 seconds
  waiting: null, // No timer for waiting phase
};

const ROLE_DISTRIBUTION = {
  mafia: (playerCount) => Math.max(1, Math.floor(playerCount / 4)),
  doctor: (playerCount) => (playerCount >= 3 ? 1 : 0),
  detective: (playerCount) => (playerCount >= 6 ? 1 : 0),
};

export const socketHandler = (io) => {
  const roomTimers = {};

  const sendRooms = async () => {
    try {
      const rooms = await Game.find({ players: { $not: { $size: 0 } } })
        .sort({ createdAt: -1 })
        .limit(100);
      io.emit("update_rooms", rooms);
    } catch (err) {
      console.error("❌ sendRooms error:", err.message);
    }
  };

  const generateRoles = (playerCount) => {
    const roles = [];
    const mafiaCount = ROLE_DISTRIBUTION.mafia(playerCount);
    const doctorCount = ROLE_DISTRIBUTION.doctor(playerCount);
    const detectiveCount = ROLE_DISTRIBUTION.detective(playerCount);

    for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
    if (doctorCount) roles.push("doctor");
    if (detectiveCount) roles.push("detective");
    while (roles.length < playerCount) roles.push("peaceful");

    return roles.sort(() => Math.random() - 0.5);
  };

  const startRoomTimer = async (roomId, durationInSeconds) => {
    if (!durationInSeconds) return;

    console.log(`⏱️ Timer started for ${roomId} for ${durationInSeconds} seconds`);

    if (roomTimers[roomId]?.interval) {
      clearInterval(roomTimers[roomId].interval);
    }

    roomTimers[roomId] = {
      timeLeft: durationInSeconds,
      interval: null,
    };

    roomTimers[roomId].interval = setInterval(async () => {
      const timer = roomTimers[roomId];
      if (!timer) return;

      if (timer.timeLeft <= 0) {
        clearInterval(timer.interval);
        delete roomTimers[roomId];

        io.to(roomId).emit("timer_end");

        try {
          const gameRoom = await Game.findOne({ roomId });
          if (!gameRoom) return;

          let nextPhase = null;
          switch (gameRoom.phase) {
            case "started":
              nextPhase = "night";
              break;
            case "night":
              nextPhase = "day";
              break;
            case "day":
              nextPhase = "ended";
              gameRoom.endedAt = new Date();
              break;
            case "ended":
              nextPhase = "waiting";
              gameRoom.winner = null;
              gameRoom.currentTurn = 0;
              gameRoom.players.forEach((p) => {
                p.isReady = false;
                p.isAlive = true;
                p.gameRole = null;
                p.votes = 0;
                p.isHealed = false;
              });
              break;
            default:
              console.warn(`⚠️ Unknown phase: ${gameRoom.phase}`);
              return;
          }

          gameRoom.phase = nextPhase;
          await gameRoom.save();

          io.to(roomId).emit("game_phase", gameRoom);
          io.to(roomId).emit("update_players", gameRoom.players);

          if (PHASE_DURATIONS[nextPhase]) {
            startRoomTimer(roomId, PHASE_DURATIONS[nextPhase]);
          }

          console.log(`✅ Phase changed to ${nextPhase} for room ${roomId}`);
        } catch (err) {
          console.error("❌ Timer phase switch error:", err.message);
          io.to(roomId).emit("error", { message: "Timer phase switch failed" });
        }

        return;
      }

      io.to(roomId).emit("timer_update", { timeLeft: timer.timeLeft });
      timer.timeLeft--;
    }, 1000);
  };

  const getTimeLeftForRoom = (roomId) => {
    return roomTimers[roomId]?.timeLeft ?? null;
  };

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);
    socket.emit("your_socket_id", socket.id);

    socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "night") {
          socket.emit("error", { message: "Invalid game or not night phase" });
          return;
        }

        const killer = gameRoom.players.find(
          (p) => p.userId.toString() === killerId
        );
        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetId
        );

        if (!killer || !target) {
          socket.emit("error", { message: "Invalid killer or target" });
          return;
        }

        if (killer.gameRole !== "mafia" || !killer.isAlive) {
          socket.emit("error", { message: "Killer must be an alive mafia" });
          return;
        }

        if (gameRoom.hasMafiaKilled) {
          socket.emit("error", { message: "Mafia has already killed this night" });
          return;
        }

        if (target.isHealed) {
          target.isHealed = false;
        } else {
          target.isAlive = false;
        }

        gameRoom.hasMafiaKilled = true;
        await gameRoom.save();

        io.to(roomId).emit("player_killed", {
          killerId,
          targetId,
          targetUsername: target.username,
        });

        console.log(`💀 Mafia killed: ${target.username} (ID: ${targetId})`);
      } catch (err) {
        console.error("❌ mafia_kill error:", err.message);
        socket.emit("error", { message: "Failed to process kill" });
      }
    });

    socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "night") {
          socket.emit("error", { message: "Invalid game or not night phase" });
          return;
        }

        const doctor = gameRoom.players.find(
          (p) => p.userId.toString() === doctorId
        );
        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetId
        );

        if (!doctor || !target) {
          socket.emit("error", { message: "Invalid doctor or target" });
          return;
        }

        if (doctor.gameRole !== "doctor" || !doctor.isAlive) {
          socket.emit("error", { message: "Doctor must be alive" });
          return;
        }

        if (gameRoom.hasDoctorHealed) {
          socket.emit("error", { message: "Doctor has already healed this night" });
          return;
        }

        target.isHealed = true;
        gameRoom.hasDoctorHealed = true;
        await gameRoom.save();

        io.to(roomId).emit("doctor_healed", {
          doctorId,
          targetId,
          message: "👨‍⚕️ Doctor healed someone!",
        });

        console.log(`Doctor (${doctor.username}) healed ${target.username}`);
      } catch (err) {
        console.error("❌ doctor_heal error:", err.message);
        socket.emit("error", { message: "Failed to process heal" });
      }
    });

    socket.on("create_room", async (data) => {
      try {
        if (!data.hostId || !data.roomName) {
          socket.emit("error", { message: "Missing hostId or roomName" });
          return;
        }

        const owner = await User.findById(data.hostId);
        if (!owner) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        const newRoom = await Game.create({
          roomId: uniqId(),
          roomName: data.roomName,
          players: [
            {
              userId: owner._id,
              username: owner.username,
              isAlive: true,
              isReady: false,
              voice: [],
            },
          ],
          hostId: data.hostId,
          phase: "waiting",
        });

        socket.join(newRoom.roomId);
        socket.data.userId = data.hostId;
        socket.data.roomId = newRoom.roomId;

        socket.emit("joined_room", newRoom);
        io.to(newRoom.roomId).emit("update_players", newRoom.players);
        io.to(newRoom.roomId).emit("game_phase", newRoom);
        await sendRooms();

        console.log(`✅ Room created: ${newRoom.roomId}`);
      } catch (err) {
        console.error("❌ create_room error:", err.message);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    socket.on("send_message", async ({ data, global }) => {
      try {
        const senderId = data?.user?.user?._id;
        if (!senderId || !data.message) {
          socket.emit("error", { message: "Invalid sender ID or message" });
          return;
        }

        const newMessage = await GlobalChat.create({
          sender: senderId,
          text: data.message,
          global,
        });

        const populated = await newMessage.populate(
          "sender",
          "_id username avatar role"
        );

        if (global) {
          io.emit("receive_message", populated);
        } else if (data.roomId) {
          io.to(data.roomId).emit("receive_message", populated);
        } else {
          socket.emit("receive_message", populated);
        }

        console.log(`✅ Message sent by ${populated.sender.username}`);
      } catch (err) {
        console.error("❌ send_message error:", err.message);
        socket.emit("error", { message: "Failed to send message" });
      }
    });

    socket.on("fetch_messages", async ({ global }) => {
      try {
        const msgs = await GlobalChat.find({ global })
          .populate("sender", "_id username avatar role")
          .sort({ createdAt: 1 })
          .limit(50);
        socket.emit("initial_messages", msgs);
      } catch (err) {
        console.error("❌ fetch_messages error:", err.message);
        socket.emit("error", { message: "Failed to fetch messages" });
      }
    });

    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        if (!roomId || !userId || !username) {
          socket.emit("error", { message: "Missing roomId, userId, or username" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );

        const allRooms = await Game.find({ "players.userId": userId });
        const alreadyInOtherRoom = allRooms.some((r) => r.roomId !== roomId);

        if (alreadyInOtherRoom) {
          socket.emit("error", {
            message: "You are already in another room. Leave it first.",
          });
          return;
        }

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
        io.to(roomId).emit("game_phase", gameRoom);
        await sendRooms();

        console.log(`✅ User ${username} joined room ${roomId}`);
      } catch (err) {
        console.error("❌ join_room error:", err.message);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    socket.on("ready", async ({ roomId, userId }) => {
      try {
        if (!roomId || !userId) {
          socket.emit("error", { message: "Missing roomId or userId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId
        );
        if (!player) {
          socket.emit("error", { message: "Player not found" });
          return;
        }

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

        if (allReady && gameRoom.phase === "waiting") {
          const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
          const roles = generateRoles(shuffled.length);
          shuffled.forEach((player, i) => {
            player.gameRole = roles[i];
            player.isAlive = true;
            player.isHealed = false;
            player.votes = 0;
          });

          gameRoom.phase = "started";
          gameRoom.hasMafiaKilled = false;
          gameRoom.hasDoctorHealed = false;
          await gameRoom.save();

          io.to(roomId).emit("start_game");
          io.to(roomId).emit("update_players", gameRoom.players);
          io.to(roomId).emit("game_phase", gameRoom);

          startRoomTimer(roomId, PHASE_DURATIONS.night);
        }
      } catch (err) {
        console.error("❌ ready error:", err.message);
        socket.emit("error", { message: "Failed to toggle ready status" });
      }
    });

    socket.on("start_timer", ({ roomId, duration }) => {
      if (!roomId || !duration || duration <= 0) {
        socket.emit("error", { message: "Invalid roomId or duration" });
        return;
      }
      startRoomTimer(roomId, duration);
    });

    socket.on("get_game_status", async ({ roomId }) => {
      try {
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        const timeLeft = getTimeLeftForRoom(roomId);
        socket.emit("game_status", {
          timeLeft: timeLeft !== null ? Math.floor(timeLeft) : null,
          phase: gameRoom.phase,
        });

        console.log(
          `🔎 get_game_status: Room ${roomId} | Phase: ${gameRoom.phase} | TimeLeft: ${
            timeLeft !== null ? Math.floor(timeLeft) : "N/A"
          }s`
        );
      } catch (err) {
        console.error("❌ get_game_status error:", err.message);
        socket.emit("error", { message: "Failed to get game status" });
      }
    });

    socket.on("leave_room", async ({ roomId, userId }) => {
      try {
        if (!roomId || !userId) {
          socket.emit("error", { message: "Missing roomId or userId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

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

        console.log(`✅ User ${userId} left room ${roomId}`);
      } catch (err) {
        console.error("❌ leave_room error:", err.message);
        socket.emit("error", { message: "Failed to leave room" });
      }
    });

    socket.on("disconnect", async () => {
      const { userId, roomId } = socket.data || {};
      if (!userId || !roomId) return;

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

        console.log(`🔌 User ${userId} disconnected from room ${roomId}`);
      } catch (err) {
        console.error("❌ disconnect error:", err.message);
      }
    });

    socket.on("get_players", async (roomId) => {
      try {
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        socket.emit("update_players", gameRoom.players);
        socket.emit("game_phase", gameRoom);

        const timeLeft = getTimeLeftForRoom(roomId);
        if (timeLeft !== null) {
          socket.emit("timer_update", { timeLeft });
        }
      } catch (err) {
        console.error("❌ get_players error:", err.message);
        socket.emit("error", { message: "Failed to get players" });
      }
    });

    socket.on("vote_player", async ({ roomId, voterId, targetUserId }) => {
      try {
        if (!roomId || !voterId || !targetUserId) {
          socket.emit("error", { message: "Missing roomId, voterId, or targetUserId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "day") {
          socket.emit("error", { message: "Invalid game or not day phase" });
          return;
        }

        const voter = gameRoom.players.find(
          (p) => p.userId.toString() === voterId
        );
        if (!voter || !voter.isAlive) {
          socket.emit("error", { message: "Voter must be alive" });
          return;
        }

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target || !target.isAlive) {
          socket.emit("error", { message: "Target must be alive" });
          return;
        }

        target.votes = (target.votes || 0) + 1;
        await gameRoom.save();

        io.to(roomId).emit("player_voted", {
          targetUserId,
          votes: target.votes,
        });

        console.log(`✅ Player ${voterId} voted for ${targetUserId}`);
      } catch (err) {
        console.error("❌ vote_player error:", err.message);
        socket.emit("error", { message: "Failed to process vote" });
      }
    });

    socket.on("check_player", async ({ roomId, checkerId, targetUserId }) => {
      try {
        if (!roomId || !checkerId || !targetUserId) {
          socket.emit("error", { message: "Missing roomId, checkerId, or targetUserId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "night") {
          socket.emit("error", { message: "Invalid game or not night phase" });
          return;
        }

        const checker = gameRoom.players.find(
          (p) => p.userId.toString() === checkerId
        );
        if (!checker || checker.gameRole !== "detective") {
          socket.emit("error", { message: "Checker must be a detective" });
          return;
        }

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target) {
          socket.emit("error", { message: "Target not found" });
          return;
        }

        socket.emit("check_result", {
          targetUserId,
          role: target.gameRole,
        });

        console.log(`✅ Detective ${checkerId} checked ${targetUserId}`);
      } catch (err) {
        console.error("❌ check_player error:", err.message);
        socket.emit("error", { message: "Failed to check player" });
      }
    });
  });
};