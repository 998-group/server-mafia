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

  const checkWinCondition = (gameRoom) => {
    const alivePlayers = gameRoom.players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.gameRole === "mafia");
    const aliveInnocents = alivePlayers.filter(p => p.gameRole !== "mafia");

    if (aliveMafia.length === 0) {
      return "innocent";
    } else if (aliveMafia.length >= aliveInnocents.length) {
      return "mafia";
    }
    return null;
  };

  const resetNightActions = (gameRoom) => {
    gameRoom.hasMafiaKilled = false;
    gameRoom.hasDoctorHealed = false;
    // Reset heal status for all players
    gameRoom.players.forEach(p => {
      p.isHealed = false;
    });
  };

  const resetDayVotes = (gameRoom) => {
    gameRoom.players.forEach(p => {
      p.votes = 0;
      p.hasVoted = false; // Track if player has already voted
    });
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
              resetNightActions(gameRoom);
              break;
            case "night":
              nextPhase = "day";
              resetDayVotes(gameRoom);
              break;
            case "day":
              // Check for lynching before ending day
              const maxVotes = Math.max(...gameRoom.players.map(p => p.votes || 0));
              if (maxVotes > 0) {
                const playersWithMaxVotes = gameRoom.players.filter(p => (p.votes || 0) === maxVotes);
                if (playersWithMaxVotes.length === 1) {
                  // Lynch the player with most votes
                  playersWithMaxVotes[0].isAlive = false;
                  io.to(roomId).emit("player_lynched", {
                    targetId: playersWithMaxVotes[0].userId.toString(),
                    targetUsername: playersWithMaxVotes[0].username,
                    votes: maxVotes
                  });
                }
              }

              // Check win condition
              const winner = checkWinCondition(gameRoom);
              if (winner) {
                nextPhase = "ended";
                gameRoom.winner = winner;
                gameRoom.endedAt = new Date();
              } else {
                nextPhase = "night";
                resetNightActions(gameRoom);
              }
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
                p.hasVoted = false;
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

        if (!target.isAlive) {
          socket.emit("error", { message: "Target is already dead" });
          return;
        }

        if (gameRoom.hasMafiaKilled) {
          socket.emit("error", { message: "Mafia has already killed this night" });
          return;
        }

        // Store the kill target, but don't kill immediately
        gameRoom.mafiaTarget = targetId;
        gameRoom.hasMafiaKilled = true;
        await gameRoom.save();

        // Only notify mafia members about the kill choice
        const mafiaPlayers = gameRoom.players.filter(p => p.gameRole === "mafia");
        mafiaPlayers.forEach(mafiaPlayer => {
          io.to(socket.id).emit("mafia_kill_confirmed", {
            targetId,
            targetUsername: target.username,
          });
        });

        console.log(`💀 Mafia selected target: ${target.username} (ID: ${targetId})`);
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

        if (!target.isAlive) {
          socket.emit("error", { message: "Cannot heal dead players" });
          return;
        }

        if (gameRoom.hasDoctorHealed) {
          socket.emit("error", { message: "Doctor has already healed this night" });
          return;
        }

        target.isHealed = true;
        gameRoom.hasDoctorHealed = true;
        await gameRoom.save();

        // Only notify the doctor
        socket.emit("doctor_heal_confirmed", {
          targetId,
          targetUsername: target.username,
        });

        console.log(`👨‍⚕️ Doctor (${doctor.username}) healed ${target.username}`);
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

        // Check if user is already in another room
        const existingRoom = await Game.findOne({ "players.userId": data.hostId });
        if (existingRoom) {
          socket.emit("error", { message: "You are already in another room" });
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
              votes: 0,
              isHealed: false,
              hasVoted: false,
              voice: [],
            },
          ],
          hostId: data.hostId,
          phase: "waiting",
          hasMafiaKilled: false,
          hasDoctorHealed: false,
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

        // Sanitize message to prevent XSS
        const sanitizedMessage = data.message.toString().trim();
        if (!sanitizedMessage || sanitizedMessage.length > 1000) {
          socket.emit("error", { message: "Invalid message length" });
          return;
        }

        const newMessage = await GlobalChat.create({
          sender: senderId,
          text: sanitizedMessage,
          global: Boolean(global),
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
        const msgs = await GlobalChat.find({ global: Boolean(global) })
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

        // Check if game is in progress
        if (gameRoom.phase !== "waiting") {
          socket.emit("error", { message: "Cannot join room: game is in progress" });
          return;
        }

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );

        // Check if user is in any other room
        const allRooms = await Game.find({ "players.userId": userId });
        const alreadyInOtherRoom = allRooms.some((r) => r.roomId !== roomId);

        if (alreadyInOtherRoom) {
          socket.emit("error", {
            message: "You are already in another room. Leave it first.",
          });
          return;
        }

        // Check room capacity (max 10 players for example)
        if (!alreadyInRoom && gameRoom.players.length >= 10) {
          socket.emit("error", { message: "Room is full" });
          return;
        }

        if (!alreadyInRoom) {
          gameRoom.players.push({
            userId,
            username,
            isAlive: true,
            isReady: false,
            votes: 0,
            isHealed: false,
            hasVoted: false,
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

        if (gameRoom.phase !== "waiting") {
          socket.emit("error", { message: "Cannot change ready status: game is not in waiting phase" });
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
          gameRoom.players.length >= 3 && // Minimum 3 players needed
          gameRoom.players.every((p) => p.isReady);

        if (allReady && gameRoom.phase === "waiting") {
          const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
          const roles = generateRoles(shuffled.length);
          shuffled.forEach((player, i) => {
            player.gameRole = roles[i];
            player.isAlive = true;
            player.isHealed = false;
            player.votes = 0;
            player.hasVoted = false;
          });

          gameRoom.phase = "started";
          gameRoom.hasMafiaKilled = false;
          gameRoom.hasDoctorHealed = false;
          gameRoom.currentTurn = 1;
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
          winner: gameRoom.winner,
          currentTurn: gameRoom.currentTurn,
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

        const wasHost = gameRoom.hostId.toString() === userId;
        
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
          // If host left, assign new host
          if (wasHost && gameRoom.players.length > 0) {
            gameRoom.hostId = gameRoom.players[0].userId;
            io.to(roomId).emit("new_host", { newHostId: gameRoom.hostId });
          }

          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        socket.data.userId = null;
        socket.data.roomId = null;
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

        const wasHost = gameRoom.hostId.toString() === userId;

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
          // If host disconnected, assign new host
          if (wasHost && gameRoom.players.length > 0) {
            gameRoom.hostId = gameRoom.players[0].userId;
            io.to(roomId).emit("new_host", { newHostId: gameRoom.hostId });
          }

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

        if (voter.hasVoted) {
          socket.emit("error", { message: "You have already voted" });
          return;
        }

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target || !target.isAlive) {
          socket.emit("error", { message: "Target must be alive" });
          return;
        }

        if (voterId === targetUserId) {
          socket.emit("error", { message: "Cannot vote for yourself" });
          return;
        }

        target.votes = (target.votes || 0) + 1;
        voter.hasVoted = true;
        await gameRoom.save();

        io.to(roomId).emit("player_voted", {
          voterId,
          voterUsername: voter.username,
          targetUserId,
          targetUsername: target.username,
          votes: target.votes,
        });

        console.log(`✅ Player ${voter.username} voted for ${target.username}`);
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
        if (!checker || checker.gameRole !== "detective" || !checker.isAlive) {
          socket.emit("error", { message: "Checker must be an alive detective" });
          return;
        }

        if (gameRoom.hasDetectiveChecked) {
          socket.emit("error", { message: "Detective has already checked this night" });
          return;
        }

        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetUserId
        );
        if (!target || !target.isAlive) {
          socket.emit("error", { message: "Target must be alive" });
          return;
        }

        if (checkerId === targetUserId) {
          socket.emit("error", { message: "Cannot check yourself" });
          return;
        }

        gameRoom.hasDetectiveChecked = true;
        await gameRoom.save();

        socket.emit("check_result", {
          targetUserId,
          targetUsername: target.username,
          role: target.gameRole === "mafia" ? "mafia" : "innocent",
        });

        console.log(`🔍 Detective ${checker.username} checked ${target.username}`);
      } catch (err) {
        console.error("❌ check_player error:", err.message);
        socket.emit("error", { message: "Failed to check player" });
      }
    });
  });
};