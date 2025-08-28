// 🚨 FIXED Server Timer Socket Events
// Add this to your src/socket/gameSocket.js or create src/socket/events/timerEvents.js

import Game from "../../models/Game.js";

export const setupTimerEvents = (socket, io, timerManager) => {
  console.log("⏰ Setting up timer socket events");

  // ✅ MANUAL TIMER START (Host Only)
  socket.on("start_timer", async ({ roomId, duration, hostId }) => {
    try {
      console.log(`⏰ Manual timer start request: room ${roomId}, duration ${duration}s, host ${hostId}`);
      
      // Input validation
      if (!roomId || !duration || duration <= 0) {
        socket.emit("error", { 
          message: "Invalid roomId or duration",
          code: "INVALID_TIMER_PARAMS"
        });
        return;
      }

      // Verify room exists
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { 
          message: "Room not found",
          code: "ROOM_NOT_FOUND"
        });
        return;
      }

      // Verify host permission
      if (hostId && gameRoom.hostId.toString() !== hostId.toString()) {
        socket.emit("error", { 
          message: "Only the room host can start the timer",
          code: "NOT_HOST"
        });
        return;
      }

      // Start the timer
      const success = await timerManager.startRoomTimer(roomId, duration);
      
      if (success) {
        // Notify the requesting client
        socket.emit("timer_started", { roomId, duration });
        
        // Notify all clients in the room
        io.to(roomId).emit("timer_update", { 
          roomId,
          timeLeft: duration,
          phase: gameRoom.phase,
          isActive: true
        });
        
        console.log(`✅ Manual timer started for room ${roomId}: ${duration}s`);
      } else {
        socket.emit("error", { 
          message: "Failed to start timer",
          code: "TIMER_START_FAILED"
        });
      }
      
    } catch (err) {
      console.error("❌ start_timer error:", err.message);
      socket.emit("error", { 
        message: "Failed to start timer",
        code: "INTERNAL_ERROR",
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    }
  });

  // ✅ GET TIMER STATUS
  socket.on("get_timer_status", async ({ roomId }) => {
    try {
      console.log(`🔍 Timer status request for room ${roomId}`);
      
      if (!roomId) {
        socket.emit("error", { 
          message: "Missing roomId",
          code: "MISSING_ROOM_ID"
        });
        return;
      }

      // Get current timer status
      const timeLeft = timerManager.getTimeLeftForRoom(roomId);
      const hasTimer = timeLeft !== null;

      // Get current game phase
      let phase = "unknown";
      try {
        const gameRoom = await Game.findOne({ roomId });
        phase = gameRoom?.phase || "unknown";
      } catch (phaseError) {
        console.warn(`⚠️ Could not get phase for room ${roomId}:`, phaseError.message);
      }

      // Send status to requesting client
      socket.emit("timer_status", {
        roomId,
        timeLeft: timeLeft || 0,
        hasTimer,
        phase,
        isActive: hasTimer && timeLeft > 0
      });

      console.log(`🔍 Timer status sent for room ${roomId}: ${timeLeft}s, phase: ${phase}, hasTimer: ${hasTimer}`);
      
    } catch (err) {
      console.error("❌ get_timer_status error:", err.message);
      socket.emit("error", { 
        message: "Failed to get timer status",
        code: "TIMER_STATUS_ERROR"
      });
    }
  });

  // ✅ CLEAR TIMER (Host/Admin Only)
  socket.on("clear_timer", async ({ roomId, adminId }) => {
    try {
      console.log(`🧹 Timer clear request: room ${roomId}, admin ${adminId}`);
      
      if (!roomId) {
        socket.emit("error", { 
          message: "Missing roomId",
          code: "MISSING_ROOM_ID"
        });
        return;
      }

      // Verify permissions if adminId provided
      if (adminId) {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { 
            message: "Room not found",
            code: "ROOM_NOT_FOUND"
          });
          return;
        }

        if (gameRoom.hostId.toString() !== adminId.toString()) {
          socket.emit("error", { 
            message: "Only the room host can clear the timer",
            code: "NOT_HOST"
          });
          return;
        }
      }

      // Clear the timer
      const cleared = timerManager.clearRoomTimer(roomId);
      
      if (cleared) {
        // Notify all clients in room
        io.to(roomId).emit("timer_cleared", { roomId });
        
        // Notify requesting client
        socket.emit("timer_clear_success", { roomId });
        
        console.log(`🧹 Timer cleared for room ${roomId}`);
      } else {
        socket.emit("error", { 
          message: "No timer found to clear",
          code: "NO_TIMER_FOUND"
        });
      }
      
    } catch (err) {
      console.error("❌ clear_timer error:", err.message);
      socket.emit("error", { 
        message: "Failed to clear timer",
        code: "TIMER_CLEAR_ERROR"
      });
    }
  });

  // ✅ PAUSE TIMER (Future feature)
  socket.on("pause_timer", async ({ roomId, hostId }) => {
    try {
      console.log(`⏸️ Timer pause request: room ${roomId}`);
      
      // TODO: Implement pause functionality in TimerManager
      socket.emit("error", { 
        message: "Timer pause feature not yet implemented",
        code: "FEATURE_NOT_IMPLEMENTED"
      });
      
    } catch (err) {
      console.error("❌ pause_timer error:", err.message);
      socket.emit("error", { 
        message: "Failed to pause timer",
        code: "TIMER_PAUSE_ERROR"
      });
    }
  });

  // ✅ RESUME TIMER (Future feature)
  socket.on("resume_timer", async ({ roomId, hostId }) => {
    try {
      console.log(`▶️ Timer resume request: room ${roomId}`);
      
      // TODO: Implement resume functionality in TimerManager
      socket.emit("error", { 
        message: "Timer resume feature not yet implemented",
        code: "FEATURE_NOT_IMPLEMENTED"
      });
      
    } catch (err) {
      console.error("❌ resume_timer error:", err.message);
      socket.emit("error", { 
        message: "Failed to resume timer",
        code: "TIMER_RESUME_ERROR"
      });
    }
  });

  // ✅ GET TIMER HEALTH/STATS (Admin/Debug)
  socket.on("get_timer_health", () => {
    try {
      const health = timerManager.healthCheck();
      
      socket.emit("timer_health", {
        activeTimers: health.activeTimers,
        memoryUsage: health.memoryUsage,
        healthy: health.healthy,
        timestamp: health.timestamp,
        timers: health.timers
      });
      
      console.log(`💊 Timer health sent to client ${socket.id}`);
      
    } catch (err) {
      console.error("❌ get_timer_health error:", err.message);
      socket.emit("error", { 
        message: "Failed to get timer health",
        code: "TIMER_HEALTH_ERROR"
      });
    }
  });

  // ✅ FORCE RESTART TIMER (Admin only - for recovery)
  socket.on("restart_timer", async ({ roomId, duration, adminId }) => {
    try {
      console.log(`🔄 Timer restart request: room ${roomId}, duration ${duration}s`);
      
      if (!roomId || !duration || duration <= 0) {
        socket.emit("error", { 
          message: "Invalid roomId or duration",
          code: "INVALID_PARAMS"
        });
        return;
      }

      // Verify admin permissions
      if (adminId) {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("error", { 
            message: "Room not found",
            code: "ROOM_NOT_FOUND"
          });
          return;
        }

        if (gameRoom.hostId.toString() !== adminId.toString()) {
          socket.emit("error", { 
            message: "Only the room host can restart the timer",
            code: "NOT_HOST"
          });
          return;
        }
      }

      // Force clear existing timer first
      timerManager.clearRoomTimer(roomId);
      
      // Start new timer
      const success = await timerManager.startRoomTimer(roomId, duration);
      
      if (success) {
        socket.emit("timer_restarted", { roomId, duration });
        io.to(roomId).emit("timer_update", { 
          roomId,
          timeLeft: duration,
          isActive: true
        });
        console.log(`🔄 Timer restarted for room ${roomId}: ${duration}s`);
      } else {
        socket.emit("error", { 
          message: "Failed to restart timer",
          code: "TIMER_RESTART_FAILED"
        });
      }
      
    } catch (err) {
      console.error("❌ restart_timer error:", err.message);
      socket.emit("error", { 
        message: "Failed to restart timer",
        code: "TIMER_RESTART_ERROR"
      });
    }
  });

  console.log("✅ Timer socket events setup completed");
};