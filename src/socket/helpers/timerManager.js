// src/socket/helpers/timerManager.js - COMPLETE CORRECT VERSION
import Game from "../../models/Game.js";
import { GAME_CONFIG } from "../../config/gameConfig.js";
import { 
  resetNightActions, 
  resetDayVotes, 
  processNightActions, 
  processDayVoting, 
  checkWinCondition, 
  resetGameForNewRound 
} from "./gameLogic.js";

const PHASE_DURATIONS = GAME_CONFIG.PHASE_DURATIONS;

export class TimerManager {
  constructor(io) {
    this.io = io;
    this.roomTimers = new Map(); // Using Map for better performance
    console.log("🎮 TimerManager initialized");
  }

  startRoomTimer = async (roomId, durationInSeconds) => {
    if (!durationInSeconds || durationInSeconds <= 0) {
      console.warn(`⚠️ Invalid duration for room ${roomId}: ${durationInSeconds}`);
      return false;
    }

    if (!roomId) {
      console.error("❌ roomId is required for startRoomTimer");
      return false;
    }

    console.log(`⏱️ Starting timer for room ${roomId}: ${durationInSeconds} seconds`);

    // Clear any existing timer for this room
    this.clearRoomTimer(roomId);

    // Create new timer object
    const timerData = {
      timeLeft: durationInSeconds,
      interval: null,
      startTime: Date.now(),
      duration: durationInSeconds
    };

    // Store timer data
    this.roomTimers.set(roomId, timerData);

    // Start the interval
    timerData.interval = setInterval(async () => {
      const currentTimer = this.roomTimers.get(roomId);
      
      if (!currentTimer) {
        console.warn(`⚠️ Timer disappeared for room ${roomId}`);
        return;
      }

      // Check if time is up
      if (currentTimer.timeLeft <= 0) {
        console.log(`⏰ Timer finished for room ${roomId}`);
        await this.handlePhaseEnd(roomId);
        return;
      }

      // Send timer update to clients
      this.io.to(roomId).emit("timer_update", { 
        timeLeft: currentTimer.timeLeft,
        phase: await this.getCurrentPhase(roomId)
      });

      // Decrease time
      currentTimer.timeLeft--;
      
    }, 1000);

    console.log(`✅ Timer started successfully for room ${roomId}`);
    return true;
  };

  handlePhaseEnd = async (roomId) => {
    if (!roomId) {
      console.error("❌ roomId is required for handlePhaseEnd");
      return;
    }

    console.log(`🔄 Handling phase end for room ${roomId}`);
    
    // Clear the timer first to prevent race conditions
    this.clearRoomTimer(roomId);

    // Notify clients that timer ended
    this.io.to(roomId).emit("timer_end", { roomId });

    try {
      // Get current game state
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.warn(`⚠️ Game room ${roomId} not found during phase end`);
        return;
      }

      const currentPhase = gameRoom.phase;
      console.log(`🎮 Processing phase transition from ${currentPhase} in room ${roomId}`);

      let nextPhase = null;
      let gameEnded = false;
      
      switch (currentPhase) {
        case "started":
          // Game just started, transition to night
          nextPhase = "night";
          resetNightActions(gameRoom);
          console.log(`🌙 Starting night phase for room ${roomId}`);
          break;
          
        case "night":
          // Process night actions (mafia kill, doctor heal, detective check)
          console.log(`🌙 Processing night actions for room ${roomId}`);
          
          const nightResult = processNightActions(gameRoom, this.io, roomId);
          
          if (nightResult === "game_ended") {
            console.log(`🏆 Game ended during night processing in room ${roomId}`);
            gameEnded = true;
            nextPhase = "ended";
            gameRoom.phase = "ended";
            gameRoom.endedAt = new Date();
          } else {
            // Continue to day phase
            nextPhase = "day";
            resetDayVotes(gameRoom);
            console.log(`☀️ Starting day phase for room ${roomId}`);
          }
          break;
          
        case "day":
          // Process day voting and elimination
          console.log(`☀️ Processing day voting for room ${roomId}`);
          
          const dayResult = processDayVoting(gameRoom, this.io, roomId);
          
          if (dayResult === "game_ended") {
            console.log(`🏆 Game ended during day processing in room ${roomId}`);
            gameEnded = true;
            nextPhase = "ended";
            gameRoom.phase = "ended";
            gameRoom.endedAt = new Date();
          } else {
            // Check win condition after voting
            const winResult = checkWinCondition(gameRoom);
            if (winResult && winResult !== null) {
              console.log(`🏆 Win condition met in room ${roomId}: ${winResult}`);
              gameEnded = true;
              nextPhase = "ended";
              gameRoom.phase = "ended";
              gameRoom.winner = winResult;
              gameRoom.endedAt = new Date();
              
              // Send game end notification
              this.io.to(roomId).emit("game_ended", {
                winner: winResult,
                reason: "win_condition",
                finalPlayers: gameRoom.players.map(p => ({
                  userId: p.userId,
                  username: p.username,
                  role: p.gameRole,
                  isAlive: p.isAlive,
                  isWinner: (winResult === "mafia" && p.gameRole === "mafia") || 
                           (winResult === "innocent" && p.gameRole !== "mafia")
                }))
              });
            } else {
              // Continue to next night
              nextPhase = "night";
              resetNightActions(gameRoom);
              gameRoom.currentTurn = (gameRoom.currentTurn || 0) + 1;
              console.log(`🌙 Starting night phase turn ${gameRoom.currentTurn} for room ${roomId}`);
            }
          }
          break;
          
        case "ended":
          // Reset game for new round
          nextPhase = "waiting";
          resetGameForNewRound(gameRoom);
          console.log(`🔄 Game reset to waiting in room ${roomId}`);
          break;
          
        default:
          console.warn(`⚠️ Unknown phase: ${currentPhase} in room ${roomId}`);
          return;
      }

      // Update game state
      if (!gameEnded) {
        gameRoom.phase = nextPhase;
      }
      
      // Save to database
      await gameRoom.save();
      console.log(`💾 Game state saved for room ${roomId}: ${currentPhase} → ${nextPhase}`);

      // Emit updates to all clients in room
      this.io.to(roomId).emit("game_phase", {
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
        winner: gameRoom.winner,
        roomId: gameRoom.roomId
      });

      this.io.to(roomId).emit("update_players", gameRoom.players);

      // Start timer for next phase (if not ended or waiting)
      if (nextPhase && PHASE_DURATIONS[nextPhase] && nextPhase !== "waiting" && nextPhase !== "ended") {
        console.log(`⏰ Starting ${nextPhase} timer (${PHASE_DURATIONS[nextPhase]}s) for room ${roomId}`);
        setTimeout(() => {
          this.startRoomTimer(roomId, PHASE_DURATIONS[nextPhase]);
        }, 1000); // Small delay to ensure all events are processed
      } else {
        console.log(`🛑 No timer needed for phase ${nextPhase} in room ${roomId}`);
      }

      console.log(`✅ Phase transition completed: ${currentPhase} → ${nextPhase} for room ${roomId}`);
      
    } catch (error) {
      console.error(`❌ Error during phase transition for room ${roomId}:`, error);
      console.error(error.stack);
      
      // Notify clients of error
      this.io.to(roomId).emit("error", { 
        message: "Phase transition failed",
        roomId: roomId,
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal error'
      });

      // Try to recover by restarting current phase timer
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (gameRoom && PHASE_DURATIONS[gameRoom.phase]) {
          console.log(`🔄 Attempting to recover timer for room ${roomId}`);
          this.startRoomTimer(roomId, PHASE_DURATIONS[gameRoom.phase]);
        }
      } catch (recoveryError) {
        console.error(`❌ Recovery failed for room ${roomId}:`, recoveryError);
      }
    }
  };

  // Get time left for specific room
  getTimeLeftForRoom = (roomId) => {
    if (!roomId) {
      console.warn("⚠️ roomId is required for getTimeLeftForRoom");
      return null;
    }

    const timer = this.roomTimers.get(roomId);
    const timeLeft = timer?.timeLeft ?? null;
    
    if (timeLeft !== null) {
      console.log(`🔍 Time left for room ${roomId}: ${timeLeft}s`);
    }
    
    return timeLeft;
  };

  // Clear timer for specific room
  clearRoomTimer = (roomId) => {
    if (!roomId) {
      console.warn("⚠️ roomId is required for clearRoomTimer");
      return false;
    }

    const timer = this.roomTimers.get(roomId);
    
    if (timer) {
      // Clear the interval
      if (timer.interval) {
        clearInterval(timer.interval);
        console.log(`🧹 Interval cleared for room ${roomId}`);
      }
      
      // Remove from Map
      this.roomTimers.delete(roomId);
      console.log(`🗑️ Timer removed for room ${roomId}`);
      return true;
    } else {
      console.log(`🔍 No timer to clear for room ${roomId}`);
      return false;
    }
  };

  // Clear all timers (for server shutdown)
  clearAllTimers = () => {
    const roomIds = Array.from(this.roomTimers.keys());
    console.log(`🧹 Clearing all timers for ${roomIds.length} rooms:`, roomIds);
    
    let clearedCount = 0;
    roomIds.forEach(roomId => {
      if (this.clearRoomTimer(roomId)) {
        clearedCount++;
      }
    });
    
    console.log(`✅ Cleared ${clearedCount} timers`);
    return clearedCount;
  };

  // Get current phase for room (helper method)
  getCurrentPhase = async (roomId) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      return gameRoom?.phase || "unknown";
    } catch (error) {
      console.error(`❌ Error getting current phase for room ${roomId}:`, error);
      return "unknown";
    }
  };

  // Get all active timers (for debugging/monitoring)
  getActiveTimers = () => {
    const activeTimers = Array.from(this.roomTimers.entries()).map(([roomId, timer]) => ({
      roomId,
      timeLeft: timer.timeLeft,
      duration: timer.duration,
      startTime: timer.startTime,
      hasInterval: !!timer.interval,
      runningTime: Math.floor((Date.now() - timer.startTime) / 1000)
    }));
    
    console.log(`📊 Active timers: ${activeTimers.length}`, activeTimers);
    return activeTimers;
  };

  // Health check for monitoring
  healthCheck = () => {
    const timerCount = this.roomTimers.size;
    const memoryUsage = process.memoryUsage();
    const activeTimers = this.getActiveTimers();
    
    const healthData = {
      activeTimers: timerCount,
      memoryUsage: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
      },
      timers: activeTimers,
      healthy: timerCount < 100, // Health threshold
      timestamp: new Date().toISOString()
    };
    
    console.log(`💊 TimerManager Health Check:`, {
      activeTimers: healthData.activeTimers,
      memoryUsage: `${healthData.memoryUsage.heapUsed}MB`,
      healthy: healthData.healthy
    });
    
    return healthData;
  };

  // Force restart timer for room (admin function)
  restartTimerForRoom = async (roomId, duration) => {
    if (!roomId) {
      console.error("❌ roomId is required for restartTimerForRoom");
      return false;
    }

    console.log(`🔄 Force restarting timer for room ${roomId} with duration ${duration}s`);
    
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.warn(`⚠️ Room ${roomId} not found for timer restart`);
        return false;
      }

      const actualDuration = duration || PHASE_DURATIONS[gameRoom.phase];
      if (!actualDuration) {
        console.warn(`⚠️ No duration available for phase ${gameRoom.phase} in room ${roomId}`);
        return false;
      }

      return this.startRoomTimer(roomId, actualDuration);
    } catch (error) {
      console.error(`❌ Error restarting timer for room ${roomId}:`, error);
      return false;
    }
  };

  // Get timer statistics
  getStats = () => {
    const stats = {
      totalTimers: this.roomTimers.size,
      rooms: Array.from(this.roomTimers.keys()),
      averageTimeLeft: 0,
      oldestTimer: null,
      newestTimer: null
    };

    if (stats.totalTimers > 0) {
      const timers = Array.from(this.roomTimers.values());
      const now = Date.now();

      // Calculate average time left
      stats.averageTimeLeft = Math.round(
        timers.reduce((sum, timer) => sum + timer.timeLeft, 0) / stats.totalTimers
      );

      // Find oldest and newest timers
      const timersByAge = timers
        .map((timer, index) => ({
          ...timer,
          roomId: Array.from(this.roomTimers.keys())[index],
          age: now - timer.startTime
        }))
        .sort((a, b) => b.age - a.age);

      stats.oldestTimer = {
        roomId: timersByAge[0].roomId,
        age: Math.round(timersByAge[0].age / 1000) // seconds
      };

      stats.newestTimer = {
        roomId: timersByAge[timersByAge.length - 1].roomId,
        age: Math.round(timersByAge[timersByAge.length - 1].age / 1000) // seconds
      };
    }

    return stats;
  };
}