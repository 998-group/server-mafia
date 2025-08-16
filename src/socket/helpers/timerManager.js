// src/socket/helpers/timerManager.js - Timer Management System

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

      // ✅ Create countdown interval
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

      console.log(`⏱️ Timer started for room ${roomId}: ${duration}ms`);
      
      // ✅ Notify clients immediately
      this.io.to(roomId).emit("timer_started", {
        duration,
        timeLeft: duration,
        endTime
      });

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

      // ✅ Send update to room
      this.io.to(roomId).emit("timer_update", {
        timeLeft: Math.floor(timeLeft / 1000),
        totalDuration: timerInfo.duration
      });

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

      // ✅ Clear timer
      this.clearRoomTimer(roomId);

      // ✅ Handle phase transition based on current phase
      switch (gameRoom.phase) {
        case 'night':
          await this.handleNightPhaseEnd(gameRoom);
          break;
        case 'day':
          await this.handleDayPhaseEnd(gameRoom);
          break;
        case 'voting':
          await this.handleVotingPhaseEnd(gameRoom);
          break;
        default:
          console.log(`⚠️ Timer expired in unexpected phase: ${gameRoom.phase}`);
      }

    } catch (err) {
      console.error('❌ Error handling timer expiry:', err.message);
    }
  }

  // ===== HANDLE NIGHT PHASE END =====
  async handleNightPhaseEnd(gameRoom) {
    try {
      console.log(`🌙 Night phase ending in room ${gameRoom.roomId}`);

      // ✅ Process night actions
      await this.processNightActions(gameRoom);

      // ✅ Transition to day phase
      gameRoom.phase = 'day';
      gameRoom.hasMafiaKilled = false;
      gameRoom.hasDoctorHealed = false;
      gameRoom.hasDetectiveChecked = false;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      // ✅ Notify clients
      this.io.to(gameRoom.roomId).emit("phase_changed", {
        newPhase: 'day',
        message: 'Day phase has begun. Discuss and vote!',
        players: gameRoom.players
      });

      this.io.to(gameRoom.roomId).emit("update_players", gameRoom.players);

      // ✅ Start day timer
      const dayDuration = GAME_CONFIG.PHASE_DURATIONS?.day || 120000;
      this.startRoomTimer(gameRoom.roomId, dayDuration);

    } catch (err) {
      console.error('❌ Error handling night phase end:', err.message);
    }
  }

  // ===== HANDLE DAY PHASE END =====
  async handleDayPhaseEnd(gameRoom) {
    try {
      console.log(`☀️ Day phase ending in room ${gameRoom.roomId}`);

      // ✅ Transition to voting phase
      gameRoom.phase = 'voting';
      
      // ✅ Reset voting flags
      gameRoom.players.forEach(player => {
        player.hasVoted = false;
        player.votes = 0;
      });

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      // ✅ Notify clients
      this.io.to(gameRoom.roomId).emit("phase_changed", {
        newPhase: 'voting',
        message: 'Voting phase has begun. Cast your votes!',
        players: gameRoom.players
      });

      this.io.to(gameRoom.roomId).emit("update_players", gameRoom.players);

      // ✅ Start voting timer
      const votingDuration = GAME_CONFIG.PHASE_DURATIONS?.voting || 60000;
      this.startRoomTimer(gameRoom.roomId, votingDuration);

    } catch (err) {
      console.error('❌ Error handling day phase end:', err.message);
    }
  }

  // ===== HANDLE VOTING PHASE END =====
  async handleVotingPhaseEnd(gameRoom) {
    try {
      console.log(`🗳️ Voting phase ending in room ${gameRoom.roomId}`);

      // ✅ Process voting results
      await this.processVotingResults(gameRoom);

      // ✅ Check win conditions
      const winner = this.checkWinConditions(gameRoom);
      
      if (winner) {
        // ✅ Game ends
        gameRoom.phase = 'ended';
        gameRoom.winner = winner;
        gameRoom.updatedAt = new Date();
        await gameRoom.save();

        this.io.to(gameRoom.roomId).emit("game_ended", {
          winner,
          message: `${winner} wins the game!`,
          players: gameRoom.players
        });
      } else {
        // ✅ Continue to next night
        gameRoom.phase = 'night';
        gameRoom.currentTurn = (gameRoom.currentTurn || 1) + 1;
        
        // ✅ Reset night action flags
        gameRoom.hasMafiaKilled = false;
        gameRoom.hasDoctorHealed = false;
        gameRoom.hasDetectiveChecked = false;
        gameRoom.mafiaTarget = null;
        gameRoom.doctorTarget = null;
        
        gameRoom.updatedAt = new Date();
        await gameRoom.save();

        this.io.to(gameRoom.roomId).emit("phase_changed", {
          newPhase: 'night',
          currentTurn: gameRoom.currentTurn,
          message: 'Night falls. Special roles, make your moves!',
          players: gameRoom.players
        });

        // ✅ Start night timer
        const nightDuration = GAME_CONFIG.PHASE_DURATIONS?.night || 60000;
        this.startRoomTimer(gameRoom.roomId, nightDuration);
      }

    } catch (err) {
      console.error('❌ Error handling voting phase end:', err.message);
    }
  }

  // ===== PROCESS NIGHT ACTIONS =====
  async processNightActions(gameRoom) {
    try {
      const actions = [];

      // ✅ Process mafia kill
      if (gameRoom.mafiaTarget) {
        const target = gameRoom.players.find(p => p.userId.toString() === gameRoom.mafiaTarget.toString());
        if (target && target.isAlive) {
          // ✅ Check if target was healed
          if (!target.isHealed) {
            target.isAlive = false;
            actions.push(`${target.username} was eliminated by the mafia`);
          } else {
            actions.push(`Someone was attacked but saved by the doctor!`);
            target.isHealed = false; // Reset heal status
          }
        }
      }

      // ✅ Reset heal status for all players
      gameRoom.players.forEach(player => {
        player.isHealed = false;
      });

      // ✅ Notify about night actions
      if (actions.length > 0) {
        this.io.to(gameRoom.roomId).emit("night_actions_result", {
          actions,
          message: "Night actions have been processed"
        });
      } else {
        this.io.to(gameRoom.roomId).emit("night_actions_result", {
          actions: ["The night was peaceful"],
          message: "No one was harmed during the night"
        });
      }

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

    } catch (err) {
      console.error('❌ Error processing night actions:', err.message);
    }
  }

  // ===== PROCESS VOTING RESULTS =====
  async processVotingResults(gameRoom) {
    try {
      const alivePlayers = gameRoom.players.filter(p => p.isAlive);
      const votedPlayers = alivePlayers.filter(p => (p.votes || 0) > 0);
      
      if (votedPlayers.length === 0) {
        this.io.to(gameRoom.roomId).emit("voting_result", {
          message: "No one was eliminated - no votes cast",
          eliminatedPlayer: null
        });
        return;
      }

      // ✅ Find player with most votes
      const maxVotes = Math.max(...votedPlayers.map(p => p.votes));
      const playersWithMaxVotes = votedPlayers.filter(p => p.votes === maxVotes);
      
      if (playersWithMaxVotes.length > 1) {
        // ✅ Tie - no elimination
        this.io.to(gameRoom.roomId).emit("voting_result", {
          message: `Voting tied between ${playersWithMaxVotes.map(p => p.username).join(', ')} - no elimination`,
          eliminatedPlayer: null,
          tiedPlayers: playersWithMaxVotes.map(p => p.username)
        });
      } else {
        // ✅ Eliminate player with most votes
        const eliminatedPlayer = playersWithMaxVotes[0];
        eliminatedPlayer.isAlive = false;
        
        this.io.to(gameRoom.roomId).emit("voting_result", {
          message: `${eliminatedPlayer.username} was eliminated by vote`,
          eliminatedPlayer: {
            username: eliminatedPlayer.username,
            role: eliminatedPlayer.gameRole
          }
        });
      }

      // ✅ Reset voting for next round
      gameRoom.players.forEach(player => {
        player.hasVoted = false;
        player.votes = 0;
      });

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

    } catch (err) {
      console.error('❌ Error processing voting results:', err.message);
    }
  }

  // ===== CHECK WIN CONDITIONS =====
  checkWinConditions(gameRoom) {
    return checkWinConditions(gameRoom.players);
  }

  // ===== GET TIME LEFT =====
  getTimeLeftForRoom(roomId) {
    const timerInfo = this.timers.get(roomId);
    if (!timerInfo) return null;
    
    const now = Date.now();
    const timeLeft = Math.max(0, timerInfo.endTime - now);
    return Math.floor(timeLeft / 1000);
  }

  // ===== CLEAR ROOM TIMER =====
  clearRoomTimer(roomId) {
    try {
      // ✅ Clear timeout
      const timerInfo = this.timers.get(roomId);
      if (timerInfo && timerInfo.timerId) {
        clearTimeout(timerInfo.timerId);
      }
      
      // ✅ Clear interval
      const intervalId = this.intervals.get(roomId);
      if (intervalId) {
        clearInterval(intervalId);
        this.intervals.delete(roomId);
      }
      
      // ✅ Remove timer info
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
      console.log('🛑 Clearing all timers...');
      
      // ✅ Clear all timeouts
      for (const [roomId, timerInfo] of this.timers) {
        if (timerInfo.timerId) {
          clearTimeout(timerInfo.timerId);
        }
      }
      
      // ✅ Clear all intervals
      for (const [roomId, intervalId] of this.intervals) {
        clearInterval(intervalId);
      }
      
      // ✅ Clear maps
      this.timers.clear();
      this.intervals.clear();
      
      console.log('✅ All timers cleared');
    } catch (err) {
      console.error('❌ Error clearing all timers:', err.message);
    }
  }

  // ===== SKIP PHASE (HOST ONLY) =====
  async skipPhase(roomId, hostId) {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      if (gameRoom.hostId.toString() !== hostId.toString()) {
        throw new Error("Only the host can skip phases");
      }

      console.log(`⏭️ Host ${hostId} skipping phase in room ${roomId}`);
      
      // ✅ Clear current timer
      this.clearRoomTimer(roomId);
      
      // ✅ Trigger immediate phase end
      await this.handleTimerExpiry(roomId);
      
      return true;
    } catch (err) {
      console.error('❌ Error skipping phase:', err.message);
      throw err;
    }
  }
}

export default TimerManager;