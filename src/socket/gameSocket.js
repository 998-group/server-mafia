// src/socket/gameSocket.js - COMPLETE INTEGRATION WITH TIMER
import Game from "../models/Game.js";
import { GAME_CONFIG } from "../config/gameConfig.js";
import { TimerManager } from "./helpers/timerManager.js";
import { setupRoomEvents } from "./events/roomEvents.js";
import { setupGameEvents } from "./events/gameEvents.js";
import { setupMessageEvents } from "./events/messageEvents.js";

export const socketHandler = (io) => {
  // Initialize timer manager
  const timerManager = new TimerManager(io);

  console.log(`🎮 Game Socket Handler initialized`);
  console.log(`🧪 Test Mode: ${GAME_CONFIG.TEST_MODE ? 'ON' : 'OFF'}`);
  console.log(`👥 Min Players: ${GAME_CONFIG.MIN_PLAYERS}`);
  console.log(`⏰ Phase Durations:`, GAME_CONFIG.PHASE_DURATIONS);

  // ===== HELPER FUNCTIONS =====
  const sendRooms = async () => {
    try {
      const rooms = await Game.find({ players: { $not: { $size: 0 } } })
        .sort({ createdAt: -1 })
        .limit(100);
      io.emit("update_rooms", rooms);
      console.log(`📡 Sent ${rooms.length} rooms to all clients`);
    } catch (err) {
      console.error("❌ sendRooms error:", err.message);
    }
  };

  const handleDisconnect = async (socket) => {
    const { userId, roomId } = socket.data || {};
    console.log(`🔌 User disconnecting: ${socket.id}, userId: ${userId}, roomId: ${roomId}`);
    
    if (!userId) return;

    try {
      // Find user's game room
      const gameRoom = await Game.findOne({
        "players.userId": userId
      });

      if (!gameRoom) {
        console.log(`🔍 No active room found for disconnecting user ${userId}`);
        return;
      }

      const actualRoomId = gameRoom.roomId;
      const wasHost = gameRoom.hostId.toString() === userId.toString();

      // Remove player from room
      gameRoom.players = gameRoom.players.filter(
        (p) => p.userId.toString() !== userId.toString()
      );

      console.log(`👤 Removed user ${userId} from room ${actualRoomId}. Players left: ${gameRoom.players.length}`);

      if (gameRoom.players.length === 0) {
        // Delete empty room and clear timer
        await Game.deleteOne({ roomId: actualRoomId });
        timerManager.clearRoomTimer(actualRoomId);
        io.to(actualRoomId).emit("room_closed", { reason: "empty" });
        console.log(`🗑️ Empty room ${actualRoomId} deleted and timer cleared`);
      } else {
        // If host disconnected, assign new host
        if (wasHost) {
          const newHost = gameRoom.players[0];
          gameRoom.hostId = newHost.userId;
          console.log(`👑 New host assigned: ${newHost.username} in room ${actualRoomId}`);
          
          io.to(actualRoomId).emit("new_host", {
            newHostId: newHost.userId.toString(),
            newHostUsername: newHost.username
          });
        }

        // Save changes and update clients
        await gameRoom.save();
        io.to(actualRoomId).emit("update_players", gameRoom.players);
        io.to(actualRoomId).emit("player_left", {
          userId: userId,
          playersCount: gameRoom.players.length
        });
      }

      // Send updated room list
      await sendRooms();

    } catch (err) {
      console.error(`❌ Error handling disconnect for user ${userId}:`, err.message);
    }
  };

  // ===== SOCKET CONNECTION HANDLER =====
  io.on("connection", (socket) => {
    console.log(`🔗 New client connected: ${socket.id}`);

    // Setup event handlers
    setupRoomEvents(socket, io, timerManager);
    setupGameEvents(socket, io, timerManager);
    setupMessageEvents(socket, io);

    // ===== TIMER-SPECIFIC EVENTS =====
    
    // Manual timer start (admin/host only)
    socket.on("start_timer", async ({ roomId, duration, hostId }) => {
      try {
        console.log(`⏰ Manual timer start request: room ${roomId}, duration ${duration}s`);
        
        if (!roomId || !duration || duration <= 0) {
          socket.emit("error", { message: "Invalid roomId or duration" });
          return;
        }

        // Verify host permission
        if (hostId) {
          const gameRoom = await Game.findOne({ roomId });
          if (!gameRoom) {
            socket.emit("error", { message: "Room not found" });
            return;
          }

          if (gameRoom.hostId.toString() !== hostId.toString()) {
            socket.emit("error", { message: "Only host can manually start timer" });
            return;
          }
        }

        const success = await timerManager.startRoomTimer(roomId, duration);
        if (success) {
          socket.emit("timer_started", { roomId, duration });
          console.log(`✅ Manual timer started for room ${roomId}`);
        } else {
          socket.emit("error", { message: "Failed to start timer" });
        }
      } catch (err) {
        console.error("❌ start_timer error:", err.message);
        socket.emit("error", { message: "Failed to start timer" });
      }
    });

    // Get timer status
    socket.on("get_timer_status", ({ roomId }) => {
      try {
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        const timeLeft = timerManager.getTimeLeftForRoom(roomId);
        socket.emit("timer_status", {
          roomId,
          timeLeft,
          hasTimer: timeLeft !== null
        });

        console.log(`🔍 Timer status sent for room ${roomId}: ${timeLeft}s`);
      } catch (err) {
        console.error("❌ get_timer_status error:", err.message);
        socket.emit("error", { message: "Failed to get timer status" });
      }
    });

    // Force clear timer (admin only)
    socket.on("clear_timer", async ({ roomId, adminId }) => {
      try {
        console.log(`🧹 Timer clear request: room ${roomId}`);
        
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        // Add admin verification here if needed
        const cleared = timerManager.clearRoomTimer(roomId);
        
        if (cleared) {
          io.to(roomId).emit("timer_cleared", { roomId });
          socket.emit("timer_clear_success", { roomId });
          console.log(`🧹 Timer cleared for room ${roomId}`);
        } else {
          socket.emit("error", { message: "No timer to clear" });
        }
      } catch (err) {
        console.error("❌ clear_timer error:", err.message);
        socket.emit("error", { message: "Failed to clear timer" });
      }
    });

    // Get timer health/stats (monitoring)
    socket.on("get_timer_health", () => {
      try {
        const health = timerManager.healthCheck();
        const stats = timerManager.getStats();
        
        socket.emit("timer_health", {
          ...health,
          stats
        });
        
        console.log(`💊 Timer health sent to client ${socket.id}`);
      } catch (err) {
        console.error("❌ get_timer_health error:", err.message);
        socket.emit("error", { message: "Failed to get timer health" });
      }
    });

    // ===== GENERAL SOCKET EVENTS =====
    
    // Get all rooms
    socket.on("get_rooms", async () => {
      await sendRooms();
    });

    // Join specific room for updates
    socket.on("join_room_channel", ({ roomId }) => {
      if (roomId) {
        socket.join(roomId);
        console.log(`📡 Socket ${socket.id} joined room channel ${roomId}`);
      }
    });

    // Leave room channel
    socket.on("leave_room_channel", ({ roomId }) => {
      if (roomId) {
        socket.leave(roomId);
        console.log(`📡 Socket ${socket.id} left room channel ${roomId}`);
      }
    });

    // User identification for disconnect handling
    socket.on("identify_user", ({ userId, roomId }) => {
      socket.data = { userId, roomId };
      console.log(`🆔 Socket ${socket.id} identified as user ${userId} in room ${roomId}`);
    });

    // Ping/pong for connection monitoring
    socket.on("ping", () => {
      socket.emit("pong", { timestamp: Date.now() });
    });

    // ===== DISCONNECT HANDLER =====
    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      handleDisconnect(socket);
    });

    // ===== ERROR HANDLER =====
    socket.on("error", (error) => {
      console.error(`❌ Socket error for ${socket.id}:`, error);
    });
  });

  // ===== SERVER-LEVEL TIMER MANAGEMENT =====
  
  // Graceful shutdown - clear all timers
  const gracefulShutdown = () => {
    console.log("🛑 Graceful shutdown initiated - clearing all timers");
    const clearedCount = timerManager.clearAllTimers();
    console.log(`🧹 Cleared ${clearedCount} timers during shutdown`);
  };

  // Register shutdown handlers
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Periodic health check (every 5 minutes)
  setInterval(() => {
    const health = timerManager.healthCheck();
    const stats = timerManager.getStats();
    
    console.log(`📊 Periodic Timer Health Check:`, {
      activeTimers: health.activeTimers,
      memoryMB: health.memoryUsage.heapUsed,
      healthy: health.healthy
    });

    // Clean up orphaned timers (rooms that no longer exist)
    if (stats.totalTimers > 0) {
      stats.rooms.forEach(async (roomId) => {
        try {
          const gameRoom = await Game.findOne({ roomId });
          if (!gameRoom) {
            console.log(`🧹 Cleaning up orphaned timer for room ${roomId}`);
            timerManager.clearRoomTimer(roomId);
          }
        } catch (err) {
          console.error(`❌ Error checking room ${roomId}:`, err.message);
        }
      });
    }
  }, 5 * 60 * 1000); // 5 minutes

  // Send initial room list
  sendRooms();

  console.log("✅ Socket handler setup completed with timer integration");
};