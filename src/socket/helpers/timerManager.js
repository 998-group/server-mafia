// src/socket/helpers/timerManager.js - Minimal backend fix for Timer
import Game from "../../models/Game.js";
import { GAME_CONFIG } from "../../config/gameConfig.js";
import { checkWinConditions } from "./gameLogic.js";

class TimerManager {
  constructor(io) {
    this.io = io;
    this.timers = new Map(); // roomId -> timer info
    this.intervals = new Map(); // roomId -> interval ID
    console.log('⏱️ Timer Manager initialized');
  }

  // ===== START ROOM TIMER =====
  startRoomTimer(roomId, duration) {
    try {
      if (!roomId || !duration || duration <= 0) {
        console.error('❌ Invalid timer parameters:', { roomId, duration });
        return false;
      }

      // ✅ Clear existing timer
      this.clearRoomTimer(roomId);

      const startTime = Date.now();
      const endTime = startTime + duration;

      // ✅ Store timer info
      this.timers.set(roomId, {
        startTime,
        endTime,
        duration,
        roomId
      });

      // ✅ Create countdown interval (every second)
      const intervalId = setInterval(() => {
        this.updateTimer(roomId);
      }, 1000);

      this.intervals.set(roomId, intervalId);

      // ✅ Set main timer
      const timerId = setTimeout(async () => {
        await this.handleTimerExpiry(roomId);
      }, duration);

      // ✅ Store timeout ID in timer info
      const timerInfo = this.timers.get(roomId);
      if (timerInfo) {
        timerInfo.timerId = timerId;
        this.timers.set(roomId, timerInfo);
      }

      console.log(`⏱️ Timer started for room ${roomId}: ${Math.floor(duration/1000)}s`);
      
      // ✅ Notify clients immediately
      this.io.to(roomId).emit("timer_started", {
        duration,
        timeLeft: Math.floor(duration / 1000), // Send in seconds
        endTime
      });

      // ✅ Send first update
      this.updateTimer(roomId);

      return true;
    } catch (err) {
      console.error('❌ Error starting timer:', err.message);
      return false;
    }
  }

  // ===== UPDATE TIMER =====
  updateTimer(roomId) {
    try {
      const timerInfo = this.timers.get(roomId);
      if (!timerInfo) return;

      const now = Date.now();
      const timeLeft = Math.max(0, timerInfo.endTime - now);
      const timeLeftSeconds = Math.floor(timeLeft / 1000);

      // ✅ Send update to room (in seconds)
      this.io.to(roomId).emit("timer_update", {
        timeLeft: timeLeftSeconds,
        totalDuration: Math.floor(timerInfo.duration / 1000),
        roomId
      });

      // ✅ Log every 10 seconds
      if (timeLeftSeconds % 10 === 0 || timeLeftSeconds <= 5) {
        console.log(`⏱️ Room ${roomId}: ${timeLeftSeconds}s left`);
      }

      // ✅ Clear interval if time is up
      if (timeLeft <= 0) {
        const intervalId = this.intervals.get(roomId);
        if (intervalId) {
          clearInterval(intervalId);
          this.intervals.delete(roomId);
        }
      }
    } catch (err) {
      console.error('❌ Error updating timer:', err.message);
    }
  }

  // ===== HANDLE TIMER EXPIRY =====
  async handleTimerExpiry(roomId) {
    try {
      console.log(`⏰ Timer expired for room ${roomId}`);
      
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.error(`❌ Room ${roomId} not found during timer expiry`);
        return;
      }

      // ✅ Clear timer first
      this.clearRoomTimer(roomId);

      // ✅ Handle phase transition
      switch (gameRoom.phase) {
        case 'night':
          await this.transitionToDay(gameRoom);
          break;
        case 'day':
          await this.transitionToVoting(gameRoom);
          break;
        case 'voting':
          await this.transitionToNight(gameRoom);
          break;
        default:
          console.log(`⚠️ Timer expired in unexpected phase: ${gameRoom.phase}`);
      }

    } catch (err) {
      console.error('❌ Error handling timer expiry:', err.message);
    }
  }

  // ===== PHASE TRANSITIONS =====
  async transitionToDay(gameRoom) {
    try {
      console.log(`🌙 → ☀️ Night to Day in room ${gameRoom.roomId}`);

      // Process night actions here if needed
      
      gameRoom.phase = 'day';
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      this.io.to(gameRoom.roomId).emit("phase_changed", {
        newPhase: 'day',
        phase: 'day',
        message: 'Day phase has begun. Discuss and vote!',
        players: gameRoom.players
      });

      // Start day timer (2 minutes)
      setTimeout(() => {
        this.startRoomTimer(gameRoom.roomId, 120000);
      }, 1000);

    } catch (err) {
      console.error('❌ Error transitioning to day:', err.message);
    }
  }

  async transitionToVoting(gameRoom) {
    try {
      console.log(`☀️ → 🗳️ Day to Voting in room ${gameRoom.roomId}`);
      
      gameRoom.phase = 'voting';
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      this.io.to(gameRoom.roomId).emit("phase_changed", {
        newPhase: 'voting',
        phase: 'voting',
        message: 'Voting phase has begun!',
        players: gameRoom.players
      });

      // Start voting timer (1 minute)
      setTimeout(() => {
        this.startRoomTimer(gameRoom.roomId, 60000);
      }, 1000);

    } catch (err) {
      console.error('❌ Error transitioning to voting:', err.message);
    }
  }

  async transitionToNight(gameRoom) {
    try {
      console.log(`🗳️ → 🌙 Voting to Night in room ${gameRoom.roomId}`);
      
      gameRoom.phase = 'night';
      gameRoom.currentTurn = (gameRoom.currentTurn || 1) + 1;
      
      // Reset votes
      gameRoom.players.forEach(player => {
        player.hasVoted = false;
        player.votes = 0;
      });

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      this.io.to(gameRoom.roomId).emit("phase_changed", {
        newPhase: 'night',
        phase: 'night',
        message: `Night ${gameRoom.currentTurn} has begun`,
        players: gameRoom.players
      });

      // Start night timer (1 minute)
      setTimeout(() => {
        this.startRoomTimer(gameRoom.roomId, 60000);
      }, 1000);

    } catch (err) {
      console.error('❌ Error transitioning to night:', err.message);
    }
  }

  // ===== GET TIME LEFT =====
  getTimeLeftForRoom(roomId) {
    const timerInfo = this.timers.get(roomId);
    if (!timerInfo) return null;
    
    const now = Date.now();
    const timeLeft = Math.max(0, timerInfo.endTime - now);
    return Math.floor(timeLeft / 1000); // Return seconds
  }

  // ===== CLEAR ROOM TIMER =====
  clearRoomTimer(roomId) {
    try {
      // Clear timeout
      const timerInfo = this.timers.get(roomId);
      if (timerInfo && timerInfo.timerId) {
        clearTimeout(timerInfo.timerId);
      }
      
      // Clear interval
      const intervalId = this.intervals.get(roomId);
      if (intervalId) {
        clearInterval(intervalId);
        this.intervals.delete(roomId);
      }
      
      // Remove timer info
      this.timers.delete(roomId);
      
      console.log(`⏱️ Timer cleared for room ${roomId}`);
      return true;
    } catch (err) {
      console.error('❌ Error clearing timer:', err.message);
      return false;
    }
  }

  // ===== CLEAR ALL TIMERS =====
  clearAllTimers() {
    try {
      for (const [roomId, intervalId] of this.intervals.entries()) {
        clearInterval(intervalId);
      }
      
      for (const [roomId, timerInfo] of this.timers.entries()) {
        if (timerInfo.timerId) {
          clearTimeout(timerInfo.timerId);
        }
      }
      
      this.intervals.clear();
      this.timers.clear();
      
      console.log('🧹 All timers cleared');
    } catch (err) {
      console.error('❌ Error clearing all timers:', err.message);
    }
  }
}

export default TimerManager;