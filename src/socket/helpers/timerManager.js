// src/socket/helpers/timerManager.js
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

      let nextPhase = null;
      
      switch (gameRoom.phase) {
        case "started":
          nextPhase = "night";
          resetNightActions(gameRoom);
          break;
          
        case "night":
          processNightActions(gameRoom, this.io, roomId);
          nextPhase = "day";
          resetDayVotes(gameRoom);
          break;
          
        case "day":
          processDayVoting(gameRoom, this.io, roomId);
          
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
          resetGameForNewRound(gameRoom);
          break;
          
        default:
          console.warn(`⚠️ Unknown phase: ${gameRoom.phase}`);
          return;
      }

      gameRoom.phase = nextPhase;
      await gameRoom.save();

      this.io.to(roomId).emit("game_phase", gameRoom);
      this.io.to(roomId).emit("update_players", gameRoom.players);

      if (PHASE_DURATIONS[nextPhase]) {
        this.startRoomTimer(roomId, PHASE_DURATIONS[nextPhase]);
      }

      console.log(`✅ Phase changed to ${nextPhase} for room ${roomId}`);
    } catch (err) {
      console.error("❌ Timer phase switch error:", err.message);
      this.io.to(roomId).emit("error", { message: "Timer phase switch failed" });
    }
  };

  getTimeLeftForRoom = (roomId) => {
    return this.roomTimers[roomId]?.timeLeft ?? null;
  };

  clearRoomTimer = (roomId) => {
    if (this.roomTimers[roomId]) {
      clearInterval(this.roomTimers[roomId].interval);
      delete this.roomTimers[roomId];
    }
  };

  clearAllTimers = () => {
    Object.keys(this.roomTimers).forEach(roomId => {
      this.clearRoomTimer(roomId);
    });
  };
}