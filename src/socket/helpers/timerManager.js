// src/socket/helpers/timerManager.js - Enhanced with complete game end logic
import Game from "../../models/Game.js";
import { GAME_CONFIG } from "../../config/gameConfig.js";
import { 
  resetNightActions, 
  resetDayVotes, 
  processNightActions, 
  processDayVoting, 
  checkWinCondition, 
  handleGameEnd,
  resetGameForNewRound 
} from "./gameLogic.js";

const PHASE_DURATIONS = GAME_CONFIG.PHASE_DURATIONS;

export class TimerManager {
  constructor(io) {
    this.io = io;
    this.roomTimers = {};
  }

  startRoomTimer = async (roomId, durationInSeconds) => {
    if (!durationInSeconds) return;

    console.log(`⏱️ Timer started for ${roomId} for ${durationInSeconds} seconds`);

    if (this.roomTimers[roomId]?.interval) {
      clearInterval(this.roomTimers[roomId].interval);
    }

    this.roomTimers[roomId] = {
      timeLeft: durationInSeconds,
      interval: null,
    };

    this.roomTimers[roomId].interval = setInterval(async () => {
      const timer = this.roomTimers[roomId];
      if (!timer) return;

      if (timer.timeLeft <= 0) {
        await this.handlePhaseEnd(roomId);
        return;
      }

      this.io.to(roomId).emit("timer_update", { timeLeft: timer.timeLeft });
      timer.timeLeft--;
    }, 1000);
  };

  handlePhaseEnd = async (roomId) => {
    clearInterval(this.roomTimers[roomId].interval);
    delete this.roomTimers[roomId];

    this.io.to(roomId).emit("timer_end");

    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) return;

      console.log(`⏰ Phase ${gameRoom.phase} ended for room ${roomId}`);

      let nextPhase = null;
      let winner = null;
      
      switch (gameRoom.phase) {
        case "started":
          // Game just started, move to first night
          nextPhase = "night";
          resetNightActions(gameRoom);
          this.io.to(roomId).emit("phase_transition", {
            from: "started",
            to: "night",
            message: "🌙 Night falls... Special roles may now act."
          });
          break;
          
        case "night":
          // Process night actions first
          await processNightActions(gameRoom, this.io, roomId);
          
          // Check for win condition after night
          winner = checkWinCondition(gameRoom);
          if (winner) {
            await handleGameEnd(gameRoom, this.io, roomId, winner);
            return; // Game ended, no more phases
          }
          
          // Move to day phase
          nextPhase = "day";
          resetDayVotes(gameRoom);
          this.io.to(roomId).emit("phase_transition", {
            from: "night",
            to: "day",
            message: "☀️ Dawn breaks... Time for village discussion and voting."
          });
          break;
          
        case "day":
          // Process voting first
          const someoneWasLynched = await processDayVoting(gameRoom, this.io, roomId);
          
          // Check for win condition after voting
          winner = checkWinCondition(gameRoom);
          if (winner) {
            await handleGameEnd(gameRoom, this.io, roomId, winner);
            return; // Game ended, no more phases
          }
          
          // Move to next night
          nextPhase = "night";
          gameRoom.currentTurn += 1;
          resetNightActions(gameRoom);
          this.io.to(roomId).emit("phase_transition", {
            from: "day",
            to: "night",
            message: `🌙 Night ${gameRoom.currentTurn + 1} begins... Special roles act again.`,
            turn: gameRoom.currentTurn
          });
          break;
          
        case "ended":
          // Game is over, handle restart if requested
          console.log(`🏁 Game ${roomId} has ended`);
          return;
          
        default:
          console.error(`❌ Unknown phase: ${gameRoom.phase}`);
          return;
      }

      // Update game phase
      if (nextPhase) {
        gameRoom.phase = nextPhase;
        await gameRoom.save();

        // Emit phase change
        this.io.to(roomId).emit("phase_changed", {
          phase: nextPhase,
          turn: gameRoom.currentTurn,
          timestamp: new Date().toISOString()
        });

        // Start timer for next phase
        const nextDuration = this.getPhaseDuration(nextPhase);
        if (nextDuration > 0) {
          await this.startRoomTimer(roomId, nextDuration);
        }
      }

    } catch (err) {
      console.error("❌ handlePhaseEnd error:", err.message);
      this.io.to(roomId).emit("error", { 
        message: "Failed to process phase end" 
      });
    }
  };

  // Get phase duration from config
  getPhaseDuration = (phase) => {
    switch (phase) {
      case "night":
        return PHASE_DURATIONS?.NIGHT || 60; // 1 minute default
      case "day":
        return PHASE_DURATIONS?.DAY || 120; // 2 minutes default
      case "started":
        return PHASE_DURATIONS?.STARTED || 10; // 10 seconds to show roles
      default:
        return 0;
    }
  };

  // Manual phase skip (for host)
  skipPhase = async (roomId, hostId) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      if (gameRoom.hostId.toString() !== hostId.toString()) {
        throw new Error("Only host can skip phases");
      }

      console.log(`⏭️ Host ${hostId} skipped phase ${gameRoom.phase} in room ${roomId}`);
      
      // Clear current timer
      if (this.roomTimers[roomId]) {
        clearInterval(this.roomTimers[roomId].interval);
        delete this.roomTimers[roomId];
      }

      // Process phase end immediately
      await this.handlePhaseEnd(roomId);
      
    } catch (err) {
      console.error("❌ skipPhase error:", err.message);
      throw err;
    }
  };

  // Force game end (for host)
  forceGameEnd = async (roomId, hostId, winner = null) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      if (gameRoom.hostId.toString() !== hostId.toString()) {
        throw new Error("Only host can force game end");
      }

      console.log(`🛑 Host ${hostId} forced game end in room ${roomId}`);
      
      // Clear timer
      this.clearRoomTimer(roomId);
      
      // Determine winner if not specified
      if (!winner) {
        winner = checkWinCondition(gameRoom) || "draw";
      }

      await handleGameEnd(gameRoom, this.io, roomId, winner);
      
    } catch (err) {
      console.error("❌ forceGameEnd error:", err.message);
      throw err;
    }
  };

  // Restart game (for host)
  restartGame = async (roomId, hostId) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      if (gameRoom.hostId.toString() !== hostId.toString()) {
        throw new Error("Only host can restart game");
      }

      console.log(`🔄 Host ${hostId} restarted game in room ${roomId}`);
      
      // Clear any existing timer
      this.clearRoomTimer(roomId);
      
      // Reset game state
      resetGameForNewRound(gameRoom);
      await gameRoom.save();

      // Notify all players
      this.io.to(roomId).emit("game_restarted", {
        message: "🔄 Game has been restarted by the host.",
        roomId: gameRoom.roomId,
        players: gameRoom.players
      });

      this.io.to(roomId).emit("phase_changed", {
        phase: "waiting",
        turn: 0
      });
      
    } catch (err) {
      console.error("❌ restartGame error:", err.message);
      throw err;
    }
  };

  // Utility methods
  getTimeLeftForRoom = (roomId) => {
    return this.roomTimers[roomId]?.timeLeft || null;
  };

  clearRoomTimer = (roomId) => {
    if (this.roomTimers[roomId]) {
      clearInterval(this.roomTimers[roomId].interval);
      delete this.roomTimers[roomId];
      console.log(`🧹 Timer cleared for room ${roomId}`);
    }
  };

  clearAllTimers = () => {
    Object.keys(this.roomTimers).forEach(roomId => {
      this.clearRoomTimer(roomId);
    });
    console.log("🧹 All timers cleared");
  };

  // Check if room has active timer
  hasActiveTimer = (roomId) => {
    return !!this.roomTimers[roomId];
  };

  // Get all active rooms with timers
  getActiveRooms = () => {
    return Object.keys(this.roomTimers);
  };
}