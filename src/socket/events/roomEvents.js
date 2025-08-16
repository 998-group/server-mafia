// src/socket/events/roomEvents.js - Complete Fixed Version

import Game from "../../models/Game.js";
import User from "../../models/User.js";
import uniqId from "uniqid";
import { GAME_CONFIG } from "../../config/gameConfig.js";
import { generateRoles } from "../helpers/gameLogic.js";

export const setupRoomEvents = (socket, io, timerManager, sendRooms) => {
  
  // ===== CREATE ROOM EVENT =====
  socket.on("create_room", async (data) => {
    try {
      console.log(`🏠 Creating room: ${data.roomName} by ${data.hostId}`);
      
      // ✅ Input validation
      if (!data.hostId || !data.roomName) {
        socket.emit("error", { message: "Missing hostId or roomName" });
        return;
      }

      // ✅ Validate room name
      const trimmedName = data.roomName.trim();
      if (!trimmedName || trimmedName.length < 3 || trimmedName.length > 30) {
        socket.emit("error", { message: "Room name must be between 3-30 characters" });
        return;
      }

      // ✅ Check if host user exists
      const owner = await User.findById(data.hostId);
      if (!owner) {
        socket.emit("error", { message: "Host user not found" });
        return;
      }

      // ✅ Check if user is already in another active room
      const existingRoom = await Game.findOne({ 
        "players.userId": data.hostId,
        phase: { $in: ["waiting", "started", "night", "day"] }
      });
      
      if (existingRoom) {
        console.log(`❌ User ${owner.username} already in active room ${existingRoom.roomId}`);
        socket.emit("error", { message: "You are already in another active room" });
        return;
      }

      // ✅ Create new room
      const roomId = uniqId();
      const newRoom = await Game.create({
        roomId,
        roomName: trimmedName,
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
            gameRole: null
          },
        ],
        hostId: data.hostId,
        phase: "waiting",
        hasMafiaKilled: false,
        hasDoctorHealed: false,
        hasDetectiveChecked: false,
        mafiaTarget: null,
        doctorTarget: null,
        currentTurn: 1,
        winner: null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // ✅ Socket setup
      socket.join(roomId);
      socket.data.userId = data.hostId;
      socket.data.roomId = roomId;

      // ✅ Send response
      const responseRoom = {
        roomId: newRoom.roomId,
        roomName: newRoom.roomName,
        players: newRoom.players,
        phase: newRoom.phase,
        hostId: newRoom.hostId,
        currentTurn: newRoom.currentTurn
      };

      socket.emit("joined_room", responseRoom);
      io.to(roomId).emit("update_players", newRoom.players);
      io.to(roomId).emit("game_phase", {
        phase: newRoom.phase,
        currentTurn: newRoom.currentTurn,
        players: newRoom.players,
        roomName: newRoom.roomName
      });
      
      // ✅ Update room list
      if (sendRooms) await sendRooms();

      console.log(`✅ Room created successfully: ${roomId} by ${owner.username}`);
    } catch (err) {
      console.error("❌ create_room error:", err.message, err.stack);
      socket.emit("error", { message: "Failed to create room" });
    }
  });

  // ===== JOIN ROOM EVENT =====
  socket.on("join_room", async ({ roomId, userId, username }) => {
    try {
      console.log(`🚪 User ${username} (${userId}) attempting to join room ${roomId}`);
      
      // ✅ Input validation
      if (!roomId || !userId || !username) {
        console.log(`❌ Missing required fields: roomId=${roomId}, userId=${userId}, username=${username}`);
        socket.emit("error", { message: "Missing roomId, userId, or username" });
        return;
      }

      // ✅ Find room
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.log(`❌ Room ${roomId} not found`);
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Check game phase
      if (gameRoom.phase !== "waiting") {
        console.log(`❌ Cannot join room ${roomId}: game in progress (phase: ${gameRoom.phase})`);
        socket.emit("error", { message: "Cannot join room: game is in progress" });
        return;
      }

      // ✅ Check if already in THIS room
      const alreadyInThisRoom = gameRoom.players.some(
        (p) => p.userId.toString() === userId.toString()
      );

      console.log(`🔍 User ${username} already in room ${roomId}: ${alreadyInThisRoom}`);

      if (!alreadyInThisRoom) {
        // ✅ Check for other active rooms
        const otherActiveRooms = await Game.find({ 
          "players.userId": userId,
          roomId: { $ne: roomId },
          phase: { $in: ["waiting", "started", "night", "day"] }
        });

        if (otherActiveRooms.length > 0) {
          console.log(`❌ User ${username} is in other active rooms:`, otherActiveRooms.map(r => r.roomId));
          socket.emit("error", { message: "You are already in another active room" });
          return;
        }

        // ✅ Check room capacity
        if (gameRoom.players.length >= (GAME_CONFIG.MAX_PLAYERS || 10)) {
          console.log(`❌ Room ${roomId} is full (${gameRoom.players.length}/${GAME_CONFIG.MAX_PLAYERS || 10})`);
          socket.emit("error", { message: "Room is full" });
          return;
        }

        // ✅ Verify user exists
        const user = await User.findById(userId);
        if (!user) {
          socket.emit("error", { message: "User not found" });
          return;
        }

        // ✅ Add player to room
        gameRoom.players.push({
          userId,
          username: user.username,
          isAlive: true,
          isReady: false,
          votes: 0,
          isHealed: false,
          hasVoted: false,
          voice: [],
          gameRole: null
        });
        
        gameRoom.updatedAt = new Date();
        await gameRoom.save();
        console.log(`✅ User ${username} added to room ${roomId}`);
      } else {
        console.log(`ℹ️ User ${username} already in room ${roomId}, reconnecting`);
      }

      // ✅ Socket setup (always do this)
      socket.join(roomId);
      socket.data.userId = userId;
      socket.data.roomId = roomId;

      // ✅ Send responses
      const responseRoom = {
        roomId: gameRoom.roomId,
        roomName: gameRoom.roomName,
        players: gameRoom.players,
        phase: gameRoom.phase,
        hostId: gameRoom.hostId,
        currentTurn: gameRoom.currentTurn
      };

      socket.emit("joined_room", responseRoom);
      io.to(roomId).emit("update_players", gameRoom.players);
      io.to(roomId).emit("game_phase", {
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
        roomName: gameRoom.roomName
      });
      
      if (sendRooms) await sendRooms();

      console.log(`✅ User ${username} successfully joined/reconnected to room ${roomId}`);
    } catch (err) {
      console.error("❌ join_room error:", err.message, err.stack);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // ===== READY TOGGLE EVENT =====
  socket.on("ready", async ({ roomId, userId }) => {
    try {
      console.log(`🔄 User ${userId} toggling ready status in room ${roomId}`);
      
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
        socket.emit("error", { message: "Player not found in room" });
        return;
      }

      // ✅ Toggle ready status
      player.isReady = !player.isReady;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      console.log(`✅ User ${player.username} is now ${player.isReady ? 'ready' : 'not ready'}`);

      socket.emit("notification", {
        type: "success",
        message: player.isReady ? "You are ready" : "You are not ready",
      });

      io.to(roomId).emit("update_players", gameRoom.players);

      // ✅ Check if all players are ready and can start game
      const minPlayers = GAME_CONFIG.MIN_PLAYERS || 3;
      const allReady = gameRoom.players.length >= minPlayers && 
                      gameRoom.players.every((p) => p.isReady);

      console.log(`📊 Ready Check: ${gameRoom.players.length}/${minPlayers} players, All ready: ${allReady}`);

      if (allReady && gameRoom.phase === "waiting") {
        console.log(`🎮 Starting game in room ${roomId}...`);
        
        try {
          // ✅ Shuffle players and assign roles
          const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
          const roles = generateRoles(shuffled.length);
          
          shuffled.forEach((player, i) => {
            player.gameRole = roles[i];
            player.isAlive = true;
            player.isHealed = false;
            player.votes = 0;
            player.hasVoted = false;
          });

          // ✅ Update game state
          gameRoom.players = shuffled;
          gameRoom.phase = "started";
          gameRoom.hasMafiaKilled = false;
          gameRoom.hasDoctorHealed = false;
          gameRoom.hasDetectiveChecked = false;
          gameRoom.currentTurn = 1;
          gameRoom.mafiaTarget = null;
          gameRoom.doctorTarget = null;
          gameRoom.updatedAt = new Date();
          
          await gameRoom.save();

          // ✅ Notify clients
          io.to(roomId).emit("start_game");
          io.to(roomId).emit("update_players", gameRoom.players);
          io.to(roomId).emit("game_phase", {
            phase: gameRoom.phase,
            currentTurn: gameRoom.currentTurn,
            players: gameRoom.players,
            roomName: gameRoom.roomName
          });

          // ✅ Start night phase timer
          if (timerManager && GAME_CONFIG.PHASE_DURATIONS) {
            timerManager.startRoomTimer(roomId, GAME_CONFIG.PHASE_DURATIONS.night || 60000);
          }
          
          console.log(`✅ Game started in room ${roomId} with ${gameRoom.players.length} players`);
        } catch (gameStartError) {
          console.error(`❌ Error starting game in room ${roomId}:`, gameStartError.message);
          socket.emit("error", { message: "Failed to start game" });
        }
      }
    } catch (err) {
      console.error("❌ ready error:", err.message, err.stack);
      socket.emit("error", { message: "Failed to toggle ready status" });
    }
  });

  // ===== LEAVE ROOM EVENT =====
  socket.on("leave_room", async ({ roomId, userId }) => {
    try {
      console.log(`🚪 User ${userId} attempting to leave room ${roomId}`);
      
      if (!roomId || !userId) {
        socket.emit("error", { message: "Missing roomId or userId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.log(`❌ Room ${roomId} not found for user ${userId}`);
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Check if user is actually in this room
      const playerIndex = gameRoom.players.findIndex(
        (p) => p.userId.toString() === userId.toString()
      );

      if (playerIndex === -1) {
        console.log(`❌ User ${userId} not found in room ${roomId}`);
        socket.emit("error", { message: "You are not in this room" });
        return;
      }

      const wasHost = gameRoom.hostId.toString() === userId.toString();
      const leavingPlayer = gameRoom.players[playerIndex];
      
      console.log(`👤 User ${leavingPlayer.username} is ${wasHost ? 'host' : 'player'}, leaving room ${roomId}`);

      // ✅ Remove player from room
      gameRoom.players.splice(playerIndex, 1);

      // ✅ Handle empty room
      if (gameRoom.players.length === 0) {
        console.log(`🗑️ Room ${roomId} is empty, deleting...`);
        await Game.deleteOne({ roomId });
        socket.leave(roomId);
        io.to(roomId).emit("room_closed", { message: "Room has been closed" });
        if (sendRooms) await sendRooms();
        return;
      }

      // ✅ Assign new host if needed
      if (wasHost && gameRoom.players.length > 0) {
        gameRoom.hostId = gameRoom.players[0].userId;
        console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
        
        io.to(roomId).emit("new_host", { 
          newHostId: gameRoom.hostId,
          newHostUsername: gameRoom.players[0].username 
        });
      }

      // ✅ Save and notify
      gameRoom.updatedAt = new Date();
      await gameRoom.save();
      
      socket.leave(roomId);
      socket.data.userId = null;
      socket.data.roomId = null;
      
      io.to(roomId).emit("update_players", gameRoom.players);
      io.to(roomId).emit("game_phase", {
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players
      });
      
      if (sendRooms) await sendRooms();

      console.log(`✅ User ${leavingPlayer.username} successfully left room ${roomId}`);
    } catch (err) {
      console.error("❌ leave_room error:", err.message, err.stack);
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
      socket.emit("game_phase", {
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
        roomName: gameRoom.roomName
      });

      if (timerManager) {
        const timeLeft = timerManager.getTimeLeftForRoom(roomId);
        if (timeLeft !== null) {
          socket.emit("timer_update", { timeLeft });
        }
      }
    } catch (err) {
      console.error("❌ get_players error:", err.message);
      socket.emit("error", { message: "Failed to get players" });
    }
  });

  // ===== GET ROOM INFO EVENT =====
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
      console.log(`ℹ️ Room info sent for ${roomId}`);
    } catch (err) {
      console.error("❌ get_room_info error:", err.message);
      socket.emit("error", { message: "Failed to get room info" });
    }
  });

  // ===== DISCONNECT HANDLER =====
  const handleDisconnect = async (socket) => {
    const { userId, roomId } = socket.data || {};
    console.log(`🔌 User disconnecting: ${userId} from room ${roomId}`);
    
    if (!userId) return;

    try {
      // ✅ Find user's rooms
      const userRooms = await Game.find({ 
        "players.userId": userId,
        phase: { $in: ["waiting", "started", "night", "day"] }
      });

      for (const gameRoom of userRooms) {
        const playerIndex = gameRoom.players.findIndex(
          p => p.userId.toString() === userId.toString()
        );

        if (playerIndex !== -1) {
          const wasHost = gameRoom.hostId.toString() === userId.toString();
          console.log(`🔌 Removing user ${userId} from room ${gameRoom.roomId}`);

          // ✅ Remove player
          gameRoom.players.splice(playerIndex, 1);

          if (gameRoom.players.length === 0) {
            // ✅ Delete empty room
            await Game.deleteOne({ roomId: gameRoom.roomId });
            io.to(gameRoom.roomId).emit("room_closed");
            console.log(`🗑️ Deleted empty room ${gameRoom.roomId}`);
          } else {
            // ✅ Assign new host if needed
            if (wasHost) {
              gameRoom.hostId = gameRoom.players[0].userId;
              io.to(gameRoom.roomId).emit("new_host", { 
                newHostId: gameRoom.hostId,
                newHostUsername: gameRoom.players[0].username 
              });
              console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
            }

            gameRoom.updatedAt = new Date();
            await gameRoom.save();
            io.to(gameRoom.roomId).emit("update_players", gameRoom.players);
          }
        }
      }

      socket.leave(roomId);
      if (sendRooms) await sendRooms();

      console.log(`🔌 User ${userId} disconnected and cleaned up`);
    } catch (err) {
      console.error("❌ disconnect error:", err.message);
    }
  };

  // Return the disconnect handler for use in main socket handler
  return { handleDisconnect };
};