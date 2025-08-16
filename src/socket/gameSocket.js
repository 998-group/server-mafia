// src/socket/gameSocket.js - Complete Main Socket Handler
import Game from "../models/Game.js";
import User from "../models/User.js";
import { GAME_CONFIG } from "../config/gameConfig.js";
import { setupRoomEvents } from "./events/roomEvents.js";
import { setupGameEvents } from "./events/gameEvents.js";
import { setupMessageEvents } from "./events/messageEvents.js";
import TimerManager from "./helpers/timerManager.js";

export const socketHandler = (io) => {
  console.log('🔄 Initializing Socket.IO game handler...');

  // ✅ Initialize timer manager
  const timerManager = new TimerManager(io);

  // ===== ROOM MANAGEMENT FUNCTION =====
  const sendRooms = async () => {
    try {
      const rooms = await Game.find({
        phase: { $in: ["waiting", "started", "night", "day", "voting"] }
      })
      .select('roomId roomName players phase hostId currentTurn createdAt')
      .lean();

      const formattedRooms = rooms.map(room => ({
        roomId: room.roomId,
        roomName: room.roomName,
        playerCount: room.players ? room.players.length : 0,
        maxPlayers: GAME_CONFIG.MAX_PLAYERS,
        phase: room.phase,
        hostId: room.hostId,
        currentTurn: room.currentTurn,
        createdAt: room.createdAt,
        canJoin: room.phase === "waiting" && 
                 room.players && 
                 room.players.length < GAME_CONFIG.MAX_PLAYERS
      }));

      io.emit("rooms_updated", formattedRooms);
      console.log(`📡 Sent ${formattedRooms.length} active rooms to all clients`);
    } catch (err) {
      console.error('❌ Error sending rooms:', err.message);
    }
  };

  // ===== CLEANUP DISCONNECTED PLAYERS =====
  const handlePlayerDisconnect = async (socket) => {
    try {
      const userId = socket.data?.userId;
      const roomId = socket.data?.roomId;

      if (!userId || !roomId) {
        console.log(`🔌 Socket ${socket.id} disconnected (no user/room data)`);
        return;
      }

      console.log(`🔌 User ${userId} disconnecting from room ${roomId}`);

      // ✅ Find and update game room
      const gameRoom = await Game.findOne({ roomId });
      if (gameRoom) {
        const playerIndex = gameRoom.players.findIndex(
          p => p.userId.toString() === userId
        );

        if (playerIndex > -1) {
          const leavingPlayer = gameRoom.players[playerIndex];
          
          // ✅ Handle based on game phase
          if (gameRoom.phase === GAME_CONFIG.PHASES.WAITING) {
            // Remove player completely if game hasn't started
            gameRoom.players.splice(playerIndex, 1);
            
            // ✅ Assign new host if needed
            if (gameRoom.hostId.toString() === userId && gameRoom.players.length > 0) {
              gameRoom.hostId = gameRoom.players[0].userId;
              io.to(roomId).emit("new_host_assigned", { 
                newHostId: gameRoom.hostId,
                newHostUsername: gameRoom.players[0].username 
              });
              console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
            }
          } else {
            // Keep player in game but mark as disconnected for ongoing games
            leavingPlayer.isConnected = false;
            leavingPlayer.disconnectedAt = new Date();
          }

          gameRoom.updatedAt = new Date();
          await gameRoom.save();
          
          // ✅ Notify remaining players
          io.to(roomId).emit("update_players", gameRoom.players);
          io.to(roomId).emit("player_disconnected", {
            message: `${leavingPlayer.username} ${gameRoom.phase === 'waiting' ? 'left' : 'disconnected'}`,
            username: leavingPlayer.username,
            playerCount: gameRoom.players.length,
            phase: gameRoom.phase
          });

          // ✅ Check if room should be deleted
          if (gameRoom.players.length === 0) {
            await Game.deleteOne({ roomId });
            console.log(`🗑️ Empty room ${roomId} deleted`);
          }
        }
      }

      // ✅ Clean up socket
      if (roomId) {
        socket.leave(roomId);
      }
      
      // ✅ Update rooms list
      await sendRooms();

      console.log(`🔌 User ${userId} disconnected and cleaned up`);
    } catch (err) {
      console.error("❌ disconnect error:", err.message);
    }
  };

  // ===== SOCKET CONNECTION HANDLER =====
  io.on("connection", (socket) => {
    console.log(`🔌 New connection: ${socket.id}`);
    
    // ✅ Send socket ID to client
    socket.emit("your_socket_id", socket.id);

    // ===== SETUP EVENT HANDLERS =====
    try {
      setupRoomEvents(socket, io, timerManager, sendRooms);
      setupGameEvents(socket, io, timerManager);
      setupMessageEvents(socket, io);
      
      console.log(`✅ Event handlers set up for socket ${socket.id}`);
    } catch (err) {
      console.error(`❌ Error setting up event handlers for ${socket.id}:`, err.message);
    }

    // ===== ROOM MANAGEMENT EVENTS =====
    socket.on("request_rooms", async () => {
      try {
        await sendRooms();
        console.log(`📡 Rooms requested by ${socket.id}`);
      } catch (err) {
        console.error(`❌ request_rooms error for ${socket.id}:`, err.message);
        socket.emit("error", { message: "Failed to get rooms" });
      }
    });

    socket.on("get_room_info", async ({ roomId }) => {
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

        socket.emit("room_info", {
          roomId: gameRoom.roomId,
          roomName: gameRoom.roomName,
          players: gameRoom.players,
          phase: gameRoom.phase,
          hostId: gameRoom.hostId,
          currentTurn: gameRoom.currentTurn,
          playerCount: gameRoom.players.length,
          maxPlayers: GAME_CONFIG.MAX_PLAYERS,
          canJoin: gameRoom.phase === "waiting" && gameRoom.players.length < GAME_CONFIG.MAX_PLAYERS
        });

        console.log(`ℹ️ Room info sent for room ${roomId} to ${socket.id}`);
      } catch (err) {
        console.error(`❌ get_room_info error for ${socket.id}:`, err.message);
        socket.emit("error", { message: "Failed to get room info" });
      }
    });

    // ===== USER MANAGEMENT EVENTS =====
    socket.on("register_user", async ({ userId, username }) => {
      try {
        if (!userId) {
          socket.emit("error", { message: "Missing userId" });
          return;
        }

        // Store user data in socket
        socket.data.userId = userId;
        socket.data.username = username;

        console.log(`👤 User registered: ${username} (${userId}) on socket ${socket.id}`);
        
        socket.emit("user_registered", { 
          userId, 
          username, 
          socketId: socket.id 
        });
      } catch (err) {
        console.error(`❌ register_user error for ${socket.id}:`, err.message);
        socket.emit("error", { message: "Failed to register user" });
      }
    });

    // ===== HEARTBEAT/PING EVENTS =====
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: Date.now() });
    });

    socket.on("heartbeat", ({ userId, roomId }) => {
      // Update last seen for user
      if (socket.data) {
        socket.data.lastSeen = new Date();
      }
      
      socket.emit("heartbeat_ack", { 
        timestamp: Date.now(),
        userId,
        roomId 
      });
    });

    // ===== RECONNECTION HANDLING =====
    socket.on("reconnect_to_game", async ({ userId, roomId }) => {
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

        const player = gameRoom.players.find(p => p.userId.toString() === userId);
        if (!player) {
          socket.emit("error", { message: "Player not found in room" });
          return;
        }

        // ✅ Reconnect player
        player.isConnected = true;
        player.disconnectedAt = null;
        await gameRoom.save();

        // ✅ Join socket room
        socket.join(roomId);
        socket.data.userId = userId;
        socket.data.roomId = roomId;

        // ✅ Send current game state
        socket.emit("reconnected_to_game", {
          roomId: gameRoom.roomId,
          roomName: gameRoom.roomName,
          players: gameRoom.players,
          phase: gameRoom.phase,
          hostId: gameRoom.hostId,
          currentTurn: gameRoom.currentTurn
        });

        // ✅ Send role if game started
        if (player.gameRole) {
          socket.emit("role_assigned", {
            role: player.gameRole,
            title: GAME_CONFIG.ROLE_DESCRIPTIONS[player.gameRole]?.title
          });
        }

        // ✅ Notify other players
        socket.to(roomId).emit("player_reconnected", {
          message: `${player.username} reconnected`,
          username: player.username
        });

        console.log(`🔄 User ${player.username} reconnected to room ${roomId}`);
      } catch (err) {
        console.error(`❌ reconnect_to_game error for ${socket.id}:`, err.message);
        socket.emit("error", { message: "Failed to reconnect to game" });
      }
    });

    // ===== ADMIN/DEBUG EVENTS =====
    socket.on("admin_get_server_stats", async () => {
      try {
        const totalRooms = await Game.countDocuments();
        const activeRooms = await Game.countDocuments({
          phase: { $in: ["waiting", "started", "night", "day", "voting"] }
        });
        const totalConnections = io.engine.clientsCount;

        socket.emit("server_stats", {
          totalRooms,
          activeRooms,
          totalConnections,
          activeTimers: timerManager.timers.size,
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        console.error(`❌ admin_get_server_stats error:`, err.message);
        socket.emit("error", { message: "Failed to get server stats" });
      }
    });

    // ===== DISCONNECT HANDLER =====
    socket.on("disconnect", async (reason) => {
      console.log(`🔌 Socket ${socket.id} disconnected: ${reason}`);
      await handlePlayerDisconnect(socket);
    });

    // ===== ERROR HANDLING =====
    socket.on("error", (error) => {
      console.error(`❌ Socket error from ${socket.id}:`, error);
    });
  });

  // ===== PERIODIC ROOM SYNC =====
  setInterval(async () => {
    try {
      await sendRooms();
    } catch (err) {
      console.error('❌ Periodic room sync failed:', err.message);
    }
  }, 30000); // Every 30 seconds

  // ===== INITIAL ROOM SYNC =====
  setTimeout(async () => {
    try {
      await sendRooms();
      console.log('📡 Initial room sync completed');
    } catch (err) {
      console.error('❌ Initial room sync failed:', err.message);
    }
  }, 1000);

  // ===== CLEANUP ON PROCESS EXIT =====
  const cleanup = async () => {
    try {
      console.log('🛑 Cleaning up on exit...');
      
      // ✅ Clear all timers
      if (timerManager) {
        timerManager.clearAllTimers();
      }
      
      // ✅ Notify all connected clients
      io.emit("server_shutdown", {
        message: "Server is shutting down",
        timestamp: new Date().toISOString()
      });
      
      // ✅ Close all connections gracefully
      const sockets = await io.fetchSockets();
      for (const socket of sockets) {
        socket.disconnect(true);
      }
      
      // ✅ Close server
      io.close();
      
      console.log('✅ Cleanup completed');
    } catch (err) {
      console.error('❌ Cleanup error:', err.message);
    }
  };

  // ===== PROCESS EVENT HANDLERS =====
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    cleanup().then(() => process.exit(1));
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });

  console.log('🚀 Socket.IO game handler initialized successfully');
};