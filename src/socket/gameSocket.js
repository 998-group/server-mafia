// src/socket/gameSocket.js - Complete Fixed Version

import Game from "../models/Game.js";
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
        phase: { $in: ["waiting", "started", "night", "day"] }
      })
      .select('roomId roomName players phase hostId currentTurn createdAt')
      .lean();

      const formattedRooms = rooms.map(room => ({
        roomId: room.roomId,
        roomName: room.roomName,
        playerCount: room.players ? room.players.length : 0,
        maxPlayers: GAME_CONFIG.MAX_PLAYERS || 10,
        phase: room.phase,
        hostId: room.hostId,
        currentTurn: room.currentTurn || 1,
        createdAt: room.createdAt
      }));

      io.emit("update_rooms", formattedRooms);
      console.log(`📡 Sent ${formattedRooms.length} rooms to all clients`);
    } catch (err) {
      console.error("❌ sendRooms error:", err.message);
      io.emit("update_rooms", []);
    }
  };

  // ===== DISCONNECT HANDLER =====
  const handleDisconnect = async (socket) => {
    const { userId, roomId } = socket.data || {};
    console.log(`🔌 User disconnecting: ${userId} from room ${roomId}`);
    
    if (!userId) return;

    try {
      // ✅ Find all active rooms user is in
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
          const leavingPlayer = gameRoom.players[playerIndex];
          
          console.log(`🔌 Removing user ${leavingPlayer.username} from room ${gameRoom.roomId}`);

          // ✅ Remove player
          gameRoom.players.splice(playerIndex, 1);

          if (gameRoom.players.length === 0) {
            // ✅ Delete empty room
            await Game.deleteOne({ roomId: gameRoom.roomId });
            io.to(gameRoom.roomId).emit("room_closed", {
              message: "Room has been closed - no players remaining"
            });
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
            
            // ✅ Notify remaining players
            io.to(gameRoom.roomId).emit("update_players", gameRoom.players);
            io.to(gameRoom.roomId).emit("player_disconnected", {
              message: `${leavingPlayer.username} disconnected`,
              username: leavingPlayer.username
            });
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
    console.log(`🔌 Connected: ${socket.id}`);
    
    // ✅ Send socket ID to client
    socket.emit("your_socket_id", socket.id);

    // ===== SETUP EVENT HANDLERS =====
    try {
      const roomEventHandlers = setupRoomEvents(socket, io, timerManager, sendRooms);
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

        const gameRoom = await Game.findOne({ roomId })
          .populate("players.userId", "username avatar")
          .populate("hostId", "username avatar")
          .lean();

        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        // ✅ Format room info for client
        const roomInfo = {
          roomId: gameRoom.roomId,
          roomName: gameRoom.roomName,
          players: gameRoom.players,
          phase: gameRoom.phase,
          hostId: gameRoom.hostId,
          currentTurn: gameRoom.currentTurn,
          playerCount: gameRoom.players.length,
          maxPlayers: GAME_CONFIG.MAX_PLAYERS || 10,
          createdAt: gameRoom.createdAt
        };

        socket.emit("room_info", roomInfo);
        console.log(`ℹ️ Room info sent for ${roomId} to ${socket.id}`);
      } catch (err) {
        console.error("❌ get_room_info error:", err.message);
        socket.emit("error", { message: "Failed to get room info" });
      }
    });

    // ===== CONFIG EVENTS =====
    socket.on("get_game_config", () => {
      try {
        const config = {
          TEST_MODE: GAME_CONFIG.TEST_MODE || false,
          MIN_PLAYERS: GAME_CONFIG.MIN_PLAYERS || 3,
          MAX_PLAYERS: GAME_CONFIG.MAX_PLAYERS || 10,
          PHASE_DURATIONS: GAME_CONFIG.PHASE_DURATIONS || {
            night: 60000,
            day: 120000,
            voting: 60000
          },
          ROLES: GAME_CONFIG.ROLES || ["villager", "mafia", "doctor", "detective"]
        };
        
        socket.emit("game_config", config);
        console.log(`⚙️ Game config sent to ${socket.id}`);
      } catch (err) {
        console.error("❌ get_game_config error:", err.message);
        socket.emit("error", { message: "Failed to get game config" });
      }
    });

    // ===== HEALTH CHECK EVENT =====
    socket.on("ping", () => {
      socket.emit("pong", { 
        timestamp: new Date().toISOString(),
        socketId: socket.id 
      });
    });

    // ===== USER STATUS EVENTS =====
    socket.on("user_status", async ({ userId, status }) => {
      try {
        if (!userId) {
          socket.emit("error", { message: "Missing userId" });
          return;
        }

        // ✅ Update user status in all their rooms
        const userRooms = await Game.find({ 
          "players.userId": userId 
        });

        for (const room of userRooms) {
          const player = room.players.find(p => p.userId.toString() === userId.toString());
          if (player) {
            player.status = status || 'online';
            await room.save();
            
            io.to(room.roomId).emit("player_status_update", {
              userId,
              username: player.username,
              status: player.status
            });
          }
        }

        console.log(`👤 User ${userId} status updated to: ${status}`);
      } catch (err) {
        console.error("❌ user_status error:", err.message);
        socket.emit("error", { message: "Failed to update user status" });
      }
    });

    // ===== RECONNECTION HANDLING =====
    socket.on("reconnect_to_game", async ({ userId }) => {
      try {
        if (!userId) {
          socket.emit("error", { message: "Missing userId" });
          return;
        }

        // ✅ Find user's active game
        const activeGame = await Game.findOne({
          "players.userId": userId,
          phase: { $in: ["waiting", "started", "night", "day"] }
        });

        if (activeGame) {
          const player = activeGame.players.find(p => p.userId.toString() === userId.toString());
          
          socket.join(activeGame.roomId);
          socket.data.userId = userId;
          socket.data.roomId = activeGame.roomId;

          socket.emit("reconnected_to_game", {
            roomId: activeGame.roomId,
            roomName: activeGame.roomName,
            phase: activeGame.phase,
            players: activeGame.players,
            myRole: player ? player.gameRole : null,
            isAlive: player ? player.isAlive : false
          });

          console.log(`🔄 User ${userId} reconnected to game ${activeGame.roomId}`);
        } else {
          socket.emit("no_active_game", {
            message: "No active game found"
          });
        }
      } catch (err) {
        console.error("❌ reconnect_to_game error:", err.message);
        socket.emit("error", { message: "Failed to reconnect to game" });
      }
    });

    // ===== DISCONNECT EVENT =====
    socket.on("disconnect", (reason) => {
      console.log(`🔌 Socket ${socket.id} disconnected: ${reason}`);
      handleDisconnect(socket);
    });

    // ===== ERROR HANDLING =====
    socket.on("error", (error) => {
      console.error(`❌ Socket error from ${socket.id}:`, error);
      socket.emit("error", { message: "Socket error occurred" });
    });

    // ===== CONNECTION SUCCESS =====
    console.log(`✅ Socket ${socket.id} fully initialized`);
  });

  // ===== GLOBAL ERROR HANDLING =====
  io.engine.on("connection_error", (err) => {
    console.error("❌ Connection error:", err.req, err.code, err.message, err.context);
  });

  // ===== PERIODIC CLEANUP =====
  setInterval(async () => {
    try {
      // ✅ Clean up old finished games (older than 1 hour)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const deletedGames = await Game.deleteMany({
        phase: "ended",
        updatedAt: { $lt: oneHourAgo }
      });

      if (deletedGames.deletedCount > 0) {
        console.log(`🧹 Cleaned up ${deletedGames.deletedCount} old finished games`);
        await sendRooms();
      }

      // ✅ Clean up empty rooms (shouldn't happen, but safety check)
      const emptyRooms = await Game.find({
        $or: [
          { players: { $size: 0 } },
          { players: { $exists: false } }
        ]
      });

      if (emptyRooms.length > 0) {
        await Game.deleteMany({
          $or: [
            { players: { $size: 0 } },
            { players: { $exists: false } }
          ]
        });
        console.log(`🧹 Cleaned up ${emptyRooms.length} empty rooms`);
        await sendRooms();
      }

    } catch (err) {
      console.error("❌ Cleanup error:", err.message);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // ===== STARTUP ROOM SYNC =====
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
        message: "Server is shutting down"
      });
      
      // ✅ Close all connections
      io.close();
      
      console.log('✅ Cleanup completed');
    } catch (err) {
      console.error('❌ Cleanup error:', err.message);
    }
  };

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