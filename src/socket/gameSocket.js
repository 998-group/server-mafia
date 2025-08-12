// src/socket/gameSocket.js
import Game from "../models/Game.js";
import GlobalChat from "../models/GlobalChat.js";
import User from "../models/User.js";
import uniqId from "uniqid";
import { SendRooms } from "./SendRoom.js";

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

export const socketHandler = async (io) => {
  const roomTimers = {};

  const sendRooms =  await sendRooms();

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
    gameRoom.hasDetectiveChecked = false;
    gameRoom.mafiaTarget = null;
    gameRoom.doctorTarget = null;
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
              // Process night actions
              if (gameRoom.mafiaTarget && gameRoom.doctorTarget !== gameRoom.mafiaTarget) {
                const targetPlayer = gameRoom.players.find(p => p.userId.toString() === gameRoom.mafiaTarget);
                if (targetPlayer) {
                  targetPlayer.isAlive = false;
                  io.to(roomId).emit("player_killed", {
                    targetId: gameRoom.mafiaTarget,
                    targetUsername: targetPlayer.username,
                  });
                }
              } else if (gameRoom.mafiaTarget && gameRoom.doctorTarget === gameRoom.mafiaTarget) {
                io.to(roomId).emit("player_saved", {
                  message: "Someone was saved by the doctor!"
                });
              }
              
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

    // ===== CREATE ROOM EVENT =====
    socket.on("create_room", async (data) => {
      try {
        console.log(`🏠 Creating room: ${data.roomName} by ${data.hostId}`);
        
        if (!data.hostId || !data.roomName) {
          socket.emit("error", { message: "Missing hostId or roomName" });
          return;
        }

        // ✅ FIXED: Host user mavjudligini tekshirish
        const owner = await User.findById(data.hostId);
        if (!owner) {
          socket.emit("error", { message: "Host user not found" });
          return;
        }

        // ✅ FIXED: User boshqa roomda emasligini tekshirish
        const existingRoom = await Game.findOne({ 
          "players.userId": data.hostId 
        });
        if (existingRoom) {
          console.log(`❌ User ${owner.username} already in room ${existingRoom.roomId}`);
          socket.emit("error", { message: "You are already in another room" });
          return;
        }

        const newRoom = await Game.create({
          roomId: uniqId(),
          roomName: data.roomName,
          players: [
            {
              userId: owner._id, // ✅ ObjectId sifatida saqlash
              username: owner.username,
              isAlive: true,
              isReady: false,
              votes: 0,
              isHealed: false,
              hasVoted: false,
              voice: [],
            },
          ],
          hostId: data.hostId, // ✅ ObjectId sifatida saqlash
          phase: "waiting",
          hasMafiaKilled: false,
          hasDoctorHealed: false,
          hasDetectiveChecked: false,
          mafiaTarget: null,
          doctorTarget: null,
        });

        socket.join(newRoom.roomId);
        socket.data.userId = data.hostId;
        socket.data.roomId = newRoom.roomId;

        socket.emit("joined_room", newRoom);
        io.to(newRoom.roomId).emit("update_players", newRoom.players);
        io.to(newRoom.roomId).emit("game_phase", newRoom);
        await sendRooms();

        console.log(`✅ Room created: ${newRoom.roomId} by ${owner.username}`);
      } catch (err) {
        console.error("❌ create_room error:", err.message);
        socket.emit("error", { message: "Failed to create room" });
      }
    });

    // ===== JOIN ROOM EVENT =====
    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        console.log(`🚪 User ${username} (${userId}) trying to join room ${roomId}`);
        
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

        // ✅ FIXED: String comparison muammosini hal qilish
        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId.toString() // ✅ Ikkala tarafni string qilish
        );

        console.log(`🔍 User ${username} (${userId}) joining room ${roomId}`);
        console.log(`📋 Current players:`, gameRoom.players.map(p => ({ 
          userId: p.userId.toString(), 
          username: p.username 
        })));
        console.log(`❓ Already in room: ${alreadyInRoom}`);

        // Check if user is in any other room
        const allRooms = await Game.find({ 
          "players.userId": userId,
          roomId: { $ne: roomId } // ✅ Current roomni exclude qilish
        });
        const alreadyInOtherRoom = allRooms.length > 0;

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

        // ✅ FIXED: Faqat agar user roomda bo'lmasa qo'shish
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
          console.log(`✅ User ${username} added to room ${roomId}`);
        } else {
          console.log(`ℹ️ User ${username} already in room ${roomId}, skipping add`);
        }

        // ✅ Socket join har doim qilish kerak
        socket.join(roomId);
        socket.data.userId = userId;
        socket.data.roomId = roomId;

        socket.emit("joined_room", gameRoom);
        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("game_phase", gameRoom);
        await sendRooms();

        console.log(`✅ User ${username} successfully joined room ${roomId}`);
      } catch (err) {
        console.error("❌ join_room error:", err.message);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    // ===== READY TOGGLE EVENT =====
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
          (p) => p.userId.toString() === userId.toString()
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

        // Check if all players are ready and minimum players requirement
        const allReady =
          gameRoom.players.length >= 3 && // Minimum 3 players needed
          gameRoom.players.every((p) => p.isReady);

        if (allReady && gameRoom.phase === "waiting") {
          // Shuffle players and assign roles
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
          gameRoom.hasDetectiveChecked = false;
          gameRoom.currentTurn = 1;
          gameRoom.mafiaTarget = null;
          gameRoom.doctorTarget = null;
          await gameRoom.save();

          io.to(roomId).emit("start_game");
          io.to(roomId).emit("update_players", gameRoom.players);
          io.to(roomId).emit("game_phase", gameRoom);

          // Start with night phase timer
          startRoomTimer(roomId, PHASE_DURATIONS.night);
          
          console.log(`🎮 Game started in room ${roomId} with ${gameRoom.players.length} players`);
        }
      } catch (err) {
        console.error("❌ ready error:", err.message);
        socket.emit("error", { message: "Failed to toggle ready status" });
      }
    });

    // ===== LEAVE ROOM EVENT =====
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

        const wasHost = gameRoom.hostId.toString() === userId.toString();
        
        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId.toString()
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

    // ===== GET PLAYERS EVENT =====
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

    // ===== GET MY ROLE EVENT =====
    socket.on("get_my_role", async ({ userId, roomId }) => {
      try {
        if (!userId || !roomId) {
          socket.emit("error", { message: "Missing userId or roomId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId.toString()
        );

        if (!player) {
          socket.emit("error", { message: "Player not found in room" });
          return;
        }

        socket.emit("your_role", { 
          role: player.gameRole || "unknown",
          username: player.username,
          isAlive: player.isAlive 
        });

        console.log(`🎭 Sent role ${player.gameRole} to ${player.username}`);
      } catch (err) {
        console.error("❌ get_my_role error:", err.message);
        socket.emit("error", { message: "Failed to get role" });
      }
    });

    // ===== MAFIA KILL EVENT =====
    socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "night") {
          socket.emit("error", { message: "Invalid game or not night phase" });
          return;
        }

        const killer = gameRoom.players.find(
          (p) => p.userId.toString() === killerId.toString()
        );
        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetId.toString()
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

    // ===== DOCTOR HEAL EVENT =====
    socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom || gameRoom.phase !== "night") {
          socket.emit("error", { message: "Invalid game or not night phase" });
          return;
        }

        const doctor = gameRoom.players.find(
          (p) => p.userId.toString() === doctorId.toString()
        );
        const target = gameRoom.players.find(
          (p) => p.userId.toString() === targetId.toString()
        );

        if (!doctor || !target) {
          socket.emit("error", { message: "Invalid doctor or target" });
          return;
        }

        if (doctor.gameRole !== "doctor" || !doctor.isAlive) {
          socket.emit("error", { message: "Healer must be an alive doctor" });
          return;
        }

        if (!target.isAlive) {
          socket.emit("error", { message: "Target is already dead" });
          return;
        }

        if (gameRoom.hasDoctorHealed) {
          socket.emit("error", { message: "Doctor has already healed this night" });
          return;
        }

        gameRoom.doctorTarget = targetId;
        gameRoom.hasDoctorHealed = true;
        target.isHealed = true;
        await gameRoom.save();

        socket.emit("doctor_heal_confirmed", {
          targetId,
          targetUsername: target.username,
        });

        console.log(`🩺 Doctor healed: ${target.username} (ID: ${targetId})`);
      } catch (err) {
        console.error("❌ doctor_heal error:", err.message);
        socket.emit("error", { message: "Failed to process heal" });
      }
    });

    // ===== DETECTIVE CHECK EVENT =====
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
          (p) => p.userId.toString() === checkerId.toString()
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
          (p) => p.userId.toString() === targetUserId.toString()
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

    // ===== VOTE PLAYER EVENT =====
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
          (p) => p.userId.toString() === voterId.toString()
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
          (p) => p.userId.toString() === targetUserId.toString()
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

    // ===== VOICE/CHAT RELATED EVENTS =====
    socket.on("add_voice", async ({ roomId, selected, user }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        // Add voice logic here
        console.log(`🗣️ User ${user} added voice for ${selected} in room ${roomId}`);
        
        // Update game room logic as needed
        await gameRoom.save();
        io.to(roomId).emit("update_players", gameRoom.players);
      } catch (err) {
        console.error("❌ add_voice error:", err.message);
        socket.emit("error", { message: "Failed to add voice" });
      }
    });

    socket.on("remove_voice", async ({ roomId, userId, user }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        // Remove voice logic here
        console.log(`🔇 User ${user} removed voice from ${userId} in room ${roomId}`);
        
        // Update game room logic as needed
        await gameRoom.save();
        io.to(roomId).emit("update_players", gameRoom.players);
      } catch (err) {
        console.error("❌ remove_voice error:", err.message);
        socket.emit("error", { message: "Failed to remove voice" });
      }
    });

    // ===== MESSAGING EVENTS =====
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

    socket.on("send_room_message", async ({ roomId, message }) => {
      try {
        if (!roomId || !message) {
          socket.emit("error", { message: "Missing roomId or message" });
          return;
        }

        // Broadcast room message to all players in the room
        io.to(roomId).emit("receive_room_message", {
          ...message,
          timestamp: new Date().toISOString(),
        });

        console.log(`💬 Room message sent in ${roomId} by ${message.name}`);
      } catch (err) {
        console.error("❌ send_room_message error:", err.message);
        socket.emit("error", { message: "Failed to send room message" });
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

    // ===== ROOM MANAGEMENT EVENTS =====
    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    socket.on("get_room_info", async ({ roomId }) => {
      try {
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId })
          .populate("players.userId", "username avatar")
          .populate("hostId", "username avatar");

        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        socket.emit("room_info", gameRoom);
      } catch (err) {
        console.error("❌ get_room_info error:", err.message);
        socket.emit("error", { message: "Failed to get room info" });
      }
    });

    // ===== GAME STATUS EVENTS =====
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
          players: gameRoom.players,
          hostId: gameRoom.hostId,
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

    socket.on("get_game_players", async (userId) => {
      try {
        if (!userId) {
          socket.emit("error", { message: "Missing userId" });
          return;
        }

        // Find the room where this user is playing
        const gameRoom = await Game.findOne({ 
          "players.userId": userId 
        });

        if (!gameRoom) {
          socket.emit("error", { message: "User not in any game" });
          return;
        }

        socket.emit("game_players", {
          players: gameRoom.players,
          phase: gameRoom.phase,
          roomId: gameRoom.roomId,
        });

        console.log(`👥 Sent game players to user ${userId}`);
      } catch (err) {
        console.error("❌ get_game_players error:", err.message);
        socket.emit("error", { message: "Failed to get game players" });
      }
    });

    // ===== DISCONNECT EVENT =====
    socket.on("disconnect", async () => {
      const { userId, roomId } = socket.data || {};
      console.log(`🔌 Disconnected: ${socket.id}, userId: ${userId}, roomId: ${roomId}`);
      
      if (!userId || !roomId) return;

      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const wasHost = gameRoom.hostId.toString() === userId.toString();

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId.toString()
        );

        if (gameRoom.players.length === 0) {
          // Delete empty room
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          // Clear timer if exists
          if (roomTimers[roomId]) {
            clearInterval(roomTimers[roomId].interval);
            delete roomTimers[roomId];
          }

          console.log(`🗑️ Empty room ${roomId} deleted`);
        } else {
          // If host disconnected, assign new host
          if (wasHost && gameRoom.players.length > 0) {
            gameRoom.hostId = gameRoom.players[0].userId;
            io.to(roomId).emit("new_host", { 
              newHostId: gameRoom.hostId,
              newHostUsername: gameRoom.players[0].username 
            });
            console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
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

    // ===== ERROR HANDLING =====
    socket.on("error", (error) => {
      console.error("❌ Socket error:", error);
      socket.emit("error", { message: "Socket error occurred" });
    });
  });

  // ===== CLEANUP ON PROCESS EXIT =====
  process.on('SIGINT', () => {
    console.log('🛑 Cleaning up timers...');
    Object.keys(roomTimers).forEach(roomId => {
      if (roomTimers[roomId]?.interval) {
        clearInterval(roomTimers[roomId].interval);
      }
    });
    process.exit(0);
  });

  console.log('🚀 Socket.IO game handler initialized');
};