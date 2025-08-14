// src/socket/events/gameEvents.js - Enhanced with detailed logging
import Game from "../../models/Game.js";
import { GAME_CONFIG } from "../../config/gameConfig.js";

export const setupGameEvents = (socket, io, timerManager) => {

  // ===== GET MY ROLE EVENT =====
  socket.on("get_my_role", async ({ userId, roomId }) => {
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

      const player = gameRoom.players.find(
        (p) => p.userId.toString() === userId.toString()
      );

      if (!player) {
        socket.emit("error", { message: "Player not found in room" });
        return;
      }

      socket.emit("your_role", { 
        role: player.gameRole || "unknown",
        username: player.username,
        isAlive: player.isAlive 
      });

      console.log(`🎭 Sent role ${player.gameRole} to ${player.username}`);
    } catch (err) {
      console.error("❌ get_my_role error:", err.message);
      socket.emit("error", { message: "Failed to get role" });
    }
  });

  // ===== MAFIA KILL EVENT (Enhanced with logging) =====
  socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const killer = gameRoom.players.find(
        (p) => p.userId.toString() === killerId.toString()
      );
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );

      if (!killer || !target) {
        socket.emit("error", { message: "Invalid killer or target" });
        return;
      }

      if (killer.gameRole !== "mafia" || !killer.isAlive) {
        socket.emit("error", { message: "Killer must be an alive mafia" });
        return;
      }

      if (!target.isAlive) {
        socket.emit("error", { message: "Target is already dead" });
        return;
      }

      if (gameRoom.hasMafiaKilled) {
        socket.emit("error", { message: "Mafia has already killed this night" });
        return;
      }

      // Set the kill target (will be processed at end of night)
      gameRoom.mafiaTarget = targetId;
      gameRoom.hasMafiaKilled = true;
      await gameRoom.save();

      // Send confirmation to killer (PRIVATE)
      socket.emit("mafia_kill_confirmed", {
        targetId,
        targetUsername: target.username,
      });

      // Send generic log to all players (PUBLIC - no names for non-mafia)
      io.to(roomId).emit("mafia_kill_result", {
        targetUsername: target.username,
        killerId,
        timestamp: new Date().toISOString()
      });

      console.log(`🔫 Mafia kill: ${killer.username} targeted ${target.username}`);
    } catch (err) {
      console.error("❌ mafia_kill error:", err.message);
      socket.emit("error", { message: "Failed to process kill" });
    }
  });

  // ===== DOCTOR HEAL EVENT (Enhanced with logging) =====
  socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const doctor = gameRoom.players.find(
        (p) => p.userId.toString() === doctorId.toString()
      );
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );

      if (!doctor || !target) {
        socket.emit("error", { message: "Invalid doctor or target" });
        return;
      }

      if (doctor.gameRole !== "doctor" || !doctor.isAlive) {
        socket.emit("error", { message: "Healer must be an alive doctor" });
        return;
      }

      if (!target.isAlive) {
        socket.emit("error", { message: "Target is already dead" });
        return;
      }

      if (gameRoom.hasDoctorHealed) {
        socket.emit("error", { message: "Doctor has already healed this night" });
        return;
      }

      gameRoom.doctorTarget = targetId;
      gameRoom.hasDoctorHealed = true;
      target.isHealed = true;
      await gameRoom.save();

      // Send confirmation to doctor (PRIVATE)
      socket.emit("doctor_heal_confirmed", {
        targetId,
        targetUsername: target.username,
        doctorId,
        timestamp: new Date().toISOString()
      });

      // Send generic log to all players (PUBLIC - no names shown)
      io.to(roomId).emit("night_protection", {
        message: "Someone was protected tonight",
        timestamp: new Date().toISOString()
      });

      console.log(`🩺 Doctor heal: ${doctor.username} healed ${target.username}`);
    } catch (err) {
      console.error("❌ doctor_heal error:", err.message);
      socket.emit("error", { message: "Failed to process heal" });
    }
  });

  // ===== DETECTIVE CHECK EVENT (Enhanced with logging) =====
  socket.on("check_player", async ({ roomId, checkerId, targetUserId }) => {
    try {
      if (!roomId || !checkerId || !targetUserId) {
        socket.emit("error", { message: "Missing roomId, checkerId, or targetUserId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const checker = gameRoom.players.find(
        (p) => p.userId.toString() === checkerId.toString()
      );
      if (!checker || checker.gameRole !== "detective" || !checker.isAlive) {
        socket.emit("error", { message: "Checker must be an alive detective" });
        return;
      }

      if (gameRoom.hasDetectiveChecked) {
        socket.emit("error", { message: "Detective has already checked this night" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", { message: "Target must be alive" });
        return;
      }

      if (checkerId === targetUserId) {
        socket.emit("error", { message: "Cannot check yourself" });
        return;
      }

      gameRoom.hasDetectiveChecked = true;
      await gameRoom.save();

      // Send result only to detective (PRIVATE)
      socket.emit("check_result", {
        targetUserId,
        targetUsername: target.username,
        role: target.gameRole === "mafia" ? "mafia" : "innocent",
        checkerId,
        timestamp: new Date().toISOString()
      });

      console.log(`🔍 Detective ${checker.username} checked ${target.username} - Result: ${target.gameRole}`);
    } catch (err) {
      console.error("❌ check_player error:", err.message);
      socket.emit("error", { message: "Failed to check player" });
    }
  });

  // ===== VOTE PLAYER EVENT (Enhanced with logging) =====
  socket.on("vote_player", async ({ roomId, voterId, targetUserId }) => {
    try {
      if (!roomId || !voterId || !targetUserId) {
        socket.emit("error", { message: "Missing roomId, voterId, or targetUserId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "day") {
        socket.emit("error", { message: "Invalid game or not day phase" });
        return;
      }

      const voter = gameRoom.players.find(
        (p) => p.userId.toString() === voterId.toString()
      );
      if (!voter || !voter.isAlive) {
        socket.emit("error", { message: "Voter must be alive" });
        return;
      }

      if (voter.hasVoted) {
        socket.emit("error", { message: "You have already voted" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", { message: "Target must be alive" });
        return;
      }

      if (voterId === targetUserId) {
        socket.emit("error", { message: "Cannot vote for yourself" });
        return;
      }

      target.votes = (target.votes || 0) + 1;
      voter.hasVoted = true;
      await gameRoom.save();

      // Send voting log to all players (PUBLIC - names shown)
      io.to(roomId).emit("player_voted", {
        voterId,
        voterUsername: voter.username,
        targetUserId,
        targetUsername: target.username,
        votes: target.votes,
        timestamp: new Date().toISOString()
      });

      console.log(`✅ Voting: ${voter.username} voted for ${target.username} (${target.votes} votes)`);
    } catch (err) {
      console.error("❌ vote_player error:", err.message);
      socket.emit("error", { message: "Failed to process vote" });
    }
  });

  // ===== PHASE CHANGE EVENT (Enhanced with logging) =====
  socket.on("phase_change", async ({ roomId, newPhase }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const oldPhase = gameRoom.phase;
      gameRoom.phase = newPhase;

      // Reset night actions when entering new night
      if (newPhase === 'night') {
        gameRoom.hasMafiaKilled = false;
        gameRoom.hasDoctorHealed = false;
        gameRoom.hasDetectiveChecked = false;
        gameRoom.mafiaTarget = null;
        gameRoom.doctorTarget = null;
        
        // Reset player voting status
        gameRoom.players.forEach(player => {
          player.hasVoted = false;
          player.votes = 0;
          player.isHealed = false;
        });
      }

      await gameRoom.save();

      // Send phase change to all players (PUBLIC)
      io.to(roomId).emit("phase_changed", {
        oldPhase,
        phase: newPhase,
        timestamp: new Date().toISOString(),
        currentTurn: gameRoom.currentTurn
      });

      console.log(`🔄 Phase changed: ${oldPhase} → ${newPhase} in room ${roomId}`);
    } catch (err) {
      console.error("❌ phase_change error:", err.message);
      socket.emit("error", { message: "Failed to change phase" });
    }
  });

  // ===== GAME STATUS EVENTS =====
  socket.on("get_game_status", async ({ roomId }) => {
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

      const timeLeft = timerManager.getTimeLeftForRoom(roomId);
      socket.emit("game_status", {
        timeLeft: timeLeft !== null ? Math.floor(timeLeft) : null,
        phase: gameRoom.phase,
        winner: gameRoom.winner,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
        hostId: gameRoom.hostId,
        timestamp: new Date().toISOString()
      });

      console.log(
        `🔎 get_game_status: Room ${roomId} | Phase: ${gameRoom.phase} | TimeLeft: ${
          timeLeft !== null ? Math.floor(timeLeft) : "N/A"
        }s`
      );
    } catch (err) {
      console.error("❌ get_game_status error:", err.message);
      socket.emit("error", { message: "Failed to get game status" });
    }
  });

  socket.on("get_game_players", async (userId) => {
    try {
      if (!userId) {
        socket.emit("error", { message: "Missing userId" });
        return;
      }

      const gameRoom = await Game.findOne({ 
        "players.userId": userId 
      });

      if (!gameRoom) {
        socket.emit("error", { message: "User not in any game" });
        return;
      }

      socket.emit("game_players", {
        players: gameRoom.players,
        phase: gameRoom.phase,
        roomId: gameRoom.roomId,
        timestamp: new Date().toISOString()
      });

      console.log(`👥 Sent game players to user ${userId}`);
    } catch (err) {
      console.error("❌ get_game_players error:", err.message);
      socket.emit("error", { message: "Failed to get game players" });
    }
  });

  // ===== TIMER EVENTS =====
  socket.on("start_timer", ({ roomId, duration }) => {
    if (!roomId || !duration || duration <= 0) {
      socket.emit("error", { message: "Invalid roomId or duration" });
      return;
    }
    timerManager.startRoomTimer(roomId, duration);
  });

  // ===== VOICE/CHAT EVENTS =====
  socket.on("add_voice", async ({ roomId, selected, user }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      console.log(`🗣️ User ${user} added voice for ${selected} in room ${roomId}`);
      
      await gameRoom.save();
      io.to(roomId).emit("update_players", gameRoom.players);
    } catch (err) {
      console.error("❌ add_voice error:", err.message);
      socket.emit("error", { message: "Failed to add voice" });
    }
  });

  socket.on("remove_voice", async ({ roomId, userId, user }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      console.log(`🔇 User ${user} removed voice from ${userId} in room ${roomId}`);
      
      await gameRoom.save();
      io.to(roomId).emit("update_players", gameRoom.players);
    } catch (err) {
      console.error("❌ remove_voice error:", err.message);
      socket.emit("error", { message: "Failed to remove voice" });
    }
  });
};


// ===== GAME END MANAGEMENT EVENTS =====
socket.on("skip_phase", async ({ roomId, hostId }) => {
  try {
    if (!roomId || !hostId) {
      socket.emit("error", { message: "Missing roomId or hostId" });
      return;
    }

    await timerManager.skipPhase(roomId, hostId);
    
    socket.emit("phase_skipped", {
      message: "Phase skipped successfully",
      roomId
    });

    console.log(`⏭️ Phase skipped by host ${hostId} in room ${roomId}`);
  } catch (err) {
    console.error("❌ skip_phase error:", err.message);
    socket.emit("error", { message: err.message });
  }
});

socket.on("force_game_end", async ({ roomId, hostId, winner }) => {
  try {
    if (!roomId || !hostId) {
      socket.emit("error", { message: "Missing roomId or hostId" });
      return;
    }

    await timerManager.forceGameEnd(roomId, hostId, winner);
    
    socket.emit("game_force_ended", {
      message: "Game ended by host",
      roomId,
      winner
    });

    console.log(`🛑 Game force ended by host ${hostId} in room ${roomId}`);
  } catch (err) {
    console.error("❌ force_game_end error:", err.message);
    socket.emit("error", { message: err.message });
  }
});

socket.on("restart_game", async ({ roomId, hostId }) => {
  try {
    if (!roomId || !hostId) {
      socket.emit("error", { message: "Missing roomId or hostId" });
      return;
    }

    await timerManager.restartGame(roomId, hostId);
    
    socket.emit("game_restarted_confirm", {
      message: "Game restarted successfully",
      roomId
    });

    console.log(`🔄 Game restarted by host ${hostId} in room ${roomId}`);
  } catch (err) {
    console.error("❌ restart_game error:", err.message);
    socket.emit("error", { message: err.message });
  }
});

// ===== WIN CONDITION CHECK EVENT =====
socket.on("check_win_condition", async ({ roomId }) => {
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

    const winner = checkWinCondition(gameRoom);
    
    socket.emit("win_condition_result", {
      winner,
      alivePlayers: gameRoom.players.filter(p => p.isAlive).length,
      aliveMafia: gameRoom.players.filter(p => p.isAlive && p.gameRole === "mafia").length,
      aliveVillagers: gameRoom.players.filter(p => p.isAlive && p.gameRole !== "mafia").length
    });

    console.log(`🎯 Win condition checked for room ${roomId}: ${winner || 'Game continues'}`);
  } catch (err) {
    console.error("❌ check_win_condition error:", err.message);
    socket.emit("error", { message: "Failed to check win condition" });
  }
});

// ===== GAME STATISTICS EVENT =====
socket.on("get_game_stats", async ({ roomId }) => {
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

    const stats = calculateGameStats(gameRoom);
    
    socket.emit("game_statistics", {
      roomId,
      phase: gameRoom.phase,
      turn: gameRoom.currentTurn,
      winner: gameRoom.winner,
      stats,
      players: gameRoom.players.map(p => ({
        id: p.userId.toString(),
        username: p.username,
        role: gameRoom.phase === "ended" ? p.gameRole : "hidden", // Only show roles after game ends
        isAlive: p.isAlive,
        votes: p.votes || 0
      }))
    });

    console.log(`📊 Game stats sent for room ${roomId}`);
  } catch (err) {
    console.error("❌ get_game_stats error:", err.message);
    socket.emit("error", { message: "Failed to get game statistics" });
  }
});