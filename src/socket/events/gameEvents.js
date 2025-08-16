// src/socket/events/gameEvents.js - Complete Fixed Version

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
        isAlive: player.isAlive,
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
      });

      console.log(`🎭 Sent role ${player.gameRole} to ${player.username}`);
    } catch (err) {
      console.error("❌ get_my_role error:", err.message);
      socket.emit("error", { message: "Failed to get role" });
    }
  });

  // ===== MAFIA KILL EVENT =====
  socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
    try {
      console.log(
        `🔫 Mafia kill attempt: ${killerId} -> ${targetId} in room ${roomId}`
      );

      if (!roomId || !killerId || !targetId) {
        socket.emit("error", {
          message: "Missing roomId, killerId, or targetId",
        });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      // ✅ Validate killer is mafia
      const killer = gameRoom.players.find(
        (p) => p.userId.toString() === killerId.toString()
      );
      if (!killer || killer.gameRole !== "mafia" || !killer.isAlive) {
        socket.emit("error", { message: "You are not an alive mafia member" });
        return;
      }

      // ✅ Validate target exists and is alive
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", {
          message: "Invalid target or target is already dead",
        });
        return;
      }

      // ✅ Check if mafia already killed this turn
      if (gameRoom.hasMafiaKilled) {
        socket.emit("error", { message: "Mafia has already killed this turn" });
        return;
      }

      // ✅ Execute kill
      gameRoom.mafiaTarget = targetId;
      gameRoom.hasMafiaKilled = true;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      // ✅ Notify mafia members
      const mafiaMembers = gameRoom.players.filter(
        (p) => p.gameRole === "mafia" && p.isAlive
      );
      mafiaMembers.forEach((mafia) => {
        io.to(socket.id).emit("mafia_kill_success", {
          message: `Target ${target.username} selected for elimination`,
          targetName: target.username,
        });
      });

      console.log(
        `🔫 Mafia selected ${target.username} for kill in room ${roomId}`
      );
    } catch (err) {
      console.error("❌ mafia_kill error:", err.message);
      socket.emit("error", { message: "Failed to execute mafia kill" });
    }
  });

  // ===== DOCTOR HEAL EVENT =====
  socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
    try {
      console.log(
        `🩺 Doctor heal attempt: ${doctorId} -> ${targetId} in room ${roomId}`
      );

      if (!roomId || !doctorId || !targetId) {
        socket.emit("error", {
          message: "Missing roomId, doctorId, or targetId",
        });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      // ✅ Validate doctor
      const doctor = gameRoom.players.find(
        (p) => p.userId.toString() === doctorId.toString()
      );
      if (!doctor || doctor.gameRole !== "doctor" || !doctor.isAlive) {
        socket.emit("error", { message: "You are not an alive doctor" });
        return;
      }

      // ✅ Validate target exists and is alive
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", {
          message: "Invalid target or target is already dead",
        });
        return;
      }

      // ✅ Check if doctor already healed this turn
      if (gameRoom.hasDoctorHealed) {
        socket.emit("error", {
          message: "Doctor has already healed this turn",
        });
        return;
      }

      // ✅ Execute heal
      gameRoom.doctorTarget = targetId;
      gameRoom.hasDoctorHealed = true;
      target.isHealed = true;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      socket.emit("doctor_heal_success", {
        message: `You healed ${target.username}`,
        targetName: target.username,
      });

      console.log(`🩺 Doctor healed ${target.username} in room ${roomId}`);
    } catch (err) {
      console.error("❌ doctor_heal error:", err.message);
      socket.emit("error", { message: "Failed to execute doctor heal" });
    }
  });

  // ===== DETECTIVE CHECK EVENT =====
  socket.on("detective_check", async ({ roomId, detectiveId, targetId }) => {
    try {
      console.log(
        `🔍 Detective check: ${detectiveId} -> ${targetId} in room ${roomId}`
      );

      if (!roomId || !detectiveId || !targetId) {
        socket.emit("error", {
          message: "Missing roomId, detectiveId, or targetId",
        });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      // ✅ Validate detective
      const detective = gameRoom.players.find(
        (p) => p.userId.toString() === detectiveId.toString()
      );
      if (
        !detective ||
        detective.gameRole !== "detective" ||
        !detective.isAlive
      ) {
        socket.emit("error", { message: "You are not an alive detective" });
        return;
      }

      // ✅ Validate target exists and is alive
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", {
          message: "Invalid target or target is already dead",
        });
        return;
      }

      // ✅ Check if detective already investigated this turn
      if (gameRoom.hasDetectiveChecked) {
        socket.emit("error", {
          message: "Detective has already investigated this turn",
        });
        return;
      }

      // ✅ Execute check
      gameRoom.hasDetectiveChecked = true;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      // ✅ Return result
      const isMafia = target.gameRole === "mafia";
      socket.emit("detective_check_result", {
        targetName: target.username,
        isMafia: isMafia,
        message: `${target.username} is ${isMafia ? "MAFIA" : "INNOCENT"}`,
      });

      console.log(
        `🔍 Detective checked ${target.username}: ${
          isMafia ? "MAFIA" : "INNOCENT"
        }`
      );
    } catch (err) {
      console.error("❌ detective_check error:", err.message);
      socket.emit("error", { message: "Failed to execute detective check" });
    }
  });

  // ===== VOTING EVENTS =====
  socket.on("vote_player", async ({ roomId, voterId, targetId }) => {
    try {
      console.log(`🗳️ Vote: ${voterId} -> ${targetId} in room ${roomId}`);

      if (!roomId || !voterId || !targetId) {
        socket.emit("error", {
          message: "Missing roomId, voterId, or targetId",
        });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "day") {
        socket.emit("error", { message: "Invalid game or not day phase" });
        return;
      }

      // ✅ Validate voter
      const voter = gameRoom.players.find(
        (p) => p.userId.toString() === voterId.toString()
      );
      if (!voter || !voter.isAlive) {
        socket.emit("error", {
          message: "You are not alive or not in the game",
        });
        return;
      }

      // ✅ Check if already voted
      if (voter.hasVoted) {
        socket.emit("error", { message: "You have already voted this round" });
        return;
      }

      // ✅ Validate target
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", {
          message: "Invalid target or target is already dead",
        });
        return;
      }

      // ✅ Can't vote for yourself
      if (voterId === targetId) {
        socket.emit("error", { message: "You cannot vote for yourself" });
        return;
      }

      // ✅ Execute vote
      voter.hasVoted = true;
      target.votes = (target.votes || 0) + 1;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      // ✅ Notify all players
      io.to(roomId).emit("vote_cast", {
        voterName: voter.username,
        targetName: target.username,
        totalVotes: target.votes,
      });

      io.to(roomId).emit("update_players", gameRoom.players);

      // ✅ Check if voting is complete
      const alivePlayers = gameRoom.players.filter((p) => p.isAlive);
      const votedPlayers = alivePlayers.filter((p) => p.hasVoted);

      if (votedPlayers.length === alivePlayers.length) {
        // All alive players have voted - process results
        setTimeout(async () => {
          await processVotingResults(roomId, io);
        }, 2000);
      }

      console.log(
        `🗳️ Vote cast: ${voter.username} -> ${target.username} (${target.votes} votes)`
      );
    } catch (err) {
      console.error("❌ vote_player error:", err.message);
      socket.emit("error", { message: "Failed to cast vote" });
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

      const timeLeft = timerManager
        ? timerManager.getTimeLeftForRoom(roomId)
        : null;

      socket.emit("game_status", {
        roomId: gameRoom.roomId,
        roomName: gameRoom.roomName,
        timeLeft: timeLeft !== null ? Math.floor(timeLeft) : null,
        phase: gameRoom.phase,
        winner: gameRoom.winner,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
        hostId: gameRoom.hostId,
        timestamp: new Date().toISOString(),
      });

      console.log(
        `🔎 get_game_status: Room ${roomId} | Phase: ${
          gameRoom.phase
        } | TimeLeft: ${timeLeft !== null ? Math.floor(timeLeft) : "N/A"}s`
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
        "players.userId": userId,
      });

      if (!gameRoom) {
        socket.emit("error", { message: "User not in any game" });
        return;
      }

      socket.emit("game_players", {
        players: gameRoom.players,
        phase: gameRoom.phase,
        roomId: gameRoom.roomId,
        timestamp: new Date().toISOString(),
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
    if (timerManager) {
      timerManager.startRoomTimer(roomId, duration);
      console.log(`⏱️ Timer started for room ${roomId}: ${duration}ms`);
    }
  });

  // ===== VOICE/CHAT EVENTS =====
  socket.on("add_voice", async ({ roomId, selected, user }) => {
    try {
      if (!roomId || !selected || !user) {
        socket.emit("error", { message: "Missing roomId, selected, or user" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Find the player who is voting
      const voter = gameRoom.players.find(
        (p) => p.userId.toString() === user.toString()
      );
      if (!voter || !voter.isAlive) {
        socket.emit("error", {
          message: "You are not alive or not in the game",
        });
        return;
      }

      // ✅ Find the target player
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === selected.toString()
      );
      if (!target) {
        socket.emit("error", { message: "Target player not found" });
        return;
      }

      // ✅ Add voice (this could be for voting or other voice-based actions)
      if (!target.voice) target.voice = [];
      if (!target.voice.includes(user)) {
        target.voice.push(user);
      }

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      io.to(roomId).emit("update_players", gameRoom.players);

      console.log(
        `🗣️ User ${voter.username} added voice for ${target.username} in room ${roomId}`
      );
    } catch (err) {
      console.error("❌ add_voice error:", err.message);
      socket.emit("error", { message: "Failed to add voice" });
    }
  });

  socket.on("remove_voice", async ({ roomId, userId, user }) => {
    try {
      if (!roomId || !userId || !user) {
        socket.emit("error", { message: "Missing roomId, userId, or user" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Find the target player and remove voice
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === userId.toString()
      );
      if (target && target.voice) {
        target.voice = target.voice.filter(
          (v) => v.toString() !== user.toString()
        );
      }

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      io.to(roomId).emit("update_players", gameRoom.players);

      console.log(
        `🔇 User ${user} removed voice from ${userId} in room ${roomId}`
      );
    } catch (err) {
      console.error("❌ remove_voice error:", err.message);
      socket.emit("error", { message: "Failed to remove voice" });
    }
  });

  // ===== GAME MANAGEMENT EVENTS =====
  socket.on("skip_phase", async ({ roomId, hostId }) => {
    try {
      if (!roomId || !hostId) {
        socket.emit("error", { message: "Missing roomId or hostId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Verify host permissions
      if (gameRoom.hostId.toString() !== hostId.toString()) {
        socket.emit("error", { message: "Only the host can skip phases" });
        return;
      }

      if (timerManager) {
        await timerManager.skipPhase(roomId, hostId);
      }

      socket.emit("phase_skipped", {
        message: "Phase skipped successfully",
        roomId,
      });

      console.log(`⏭️ Phase skipped by host ${hostId} in room ${roomId}`);
    } catch (err) {
      console.error("❌ skip_phase error:", err.message);
      socket.emit("error", { message: err.message || "Failed to skip phase" });
    }
  });

  socket.on("force_game_end", async ({ roomId, hostId, winner }) => {
    try {
      if (!roomId || !hostId) {
        socket.emit("error", { message: "Missing roomId or hostId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Verify host permissions
      if (gameRoom.hostId.toString() !== hostId.toString()) {
        socket.emit("error", {
          message: "Only the host can force end the game",
        });
        return;
      }

      // ✅ End the game
      gameRoom.phase = "ended";
      gameRoom.winner = winner || "Host ended game";
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      io.to(roomId).emit("game_ended", {
        winner: gameRoom.winner,
        message: "Game ended by host",
        players: gameRoom.players,
      });

      if (timerManager) {
        timerManager.clearRoomTimer(roomId);
      }

      socket.emit("game_force_ended", {
        message: "Game ended by host",
        roomId,
        winner: gameRoom.winner,
      });

      console.log(`🛑 Game force ended by host ${hostId} in room ${roomId}`);
    } catch (err) {
      console.error("❌ force_game_end error:", err.message);
      socket.emit("error", {
        message: err.message || "Failed to force end game",
      });
    }
  });

  socket.on("restart_game", async ({ roomId, hostId }) => {
    try {
      if (!roomId || !hostId) {
        socket.emit("error", { message: "Missing roomId or hostId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Verify host permissions
      if (gameRoom.hostId.toString() !== hostId.toString()) {
        socket.emit("error", { message: "Only the host can restart the game" });
        return;
      }

      // ✅ Reset game state
      gameRoom.phase = "waiting";
      gameRoom.currentTurn = 1;
      gameRoom.winner = null;
      gameRoom.hasMafiaKilled = false;
      gameRoom.hasDoctorHealed = false;
      gameRoom.hasDetectiveChecked = false;
      gameRoom.mafiaTarget = null;
      gameRoom.doctorTarget = null;

      // ✅ Reset all players
      gameRoom.players.forEach((player) => {
        player.isReady = false;
        player.isAlive = true;
        player.isHealed = false;
        player.hasVoted = false;
        player.votes = 0;
        player.gameRole = null;
        player.voice = [];
      });

      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      if (timerManager) {
        timerManager.clearRoomTimer(roomId);
      }

      io.to(roomId).emit("game_restarted", {
        message: "Game has been restarted",
        players: gameRoom.players,
        phase: gameRoom.phase,
      });

      io.to(roomId).emit("update_players", gameRoom.players);
      io.to(roomId).emit("game_phase", {
        phase: gameRoom.phase,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
      });

      socket.emit("game_restarted_confirm", {
        message: "Game restarted successfully",
        roomId,
      });

      console.log(`🔄 Game restarted by host ${hostId} in room ${roomId}`);
    } catch (err) {
      console.error("❌ restart_game error:", err.message);
      socket.emit("error", {
        message: err.message || "Failed to restart game",
      });
    }
  });
};

// ===== HELPER FUNCTIONS =====
async function processVotingResults(roomId, io) {
  try {
    const gameRoom = await Game.findOne({ roomId });
    if (!gameRoom) return;

    // ✅ Find player with most votes
    const alivePlayers = gameRoom.players.filter((p) => p.isAlive);
    const votedPlayers = alivePlayers.filter((p) => (p.votes || 0) > 0);

    if (votedPlayers.length === 0) {
      // No one was voted out
      io.to(roomId).emit("voting_result", {
        message: "No one was eliminated - no votes cast",
        eliminatedPlayer: null,
      });
    } else {
      // Find player with highest votes
      const maxVotes = Math.max(...votedPlayers.map((p) => p.votes));
      const playersWithMaxVotes = votedPlayers.filter(
        (p) => p.votes === maxVotes
      );

      if (playersWithMaxVotes.length > 1) {
        // Tie - no elimination
        io.to(roomId).emit("voting_result", {
          message: `Voting tied between ${playersWithMaxVotes
            .map((p) => p.username)
            .join(", ")} - no elimination`,
          eliminatedPlayer: null,
          tiedPlayers: playersWithMaxVotes.map((p) => p.username),
        });
      } else {
        // Eliminate player with most votes
        const eliminatedPlayer = playersWithMaxVotes[0];
        eliminatedPlayer.isAlive = false;

        io.to(roomId).emit("voting_result", {
          message: `${eliminatedPlayer.username} was eliminated by vote`,
          eliminatedPlayer: {
            username: eliminatedPlayer.username,
            role: eliminatedPlayer.gameRole,
          },
        });

        console.log(
          `⚖️ ${eliminatedPlayer.username} eliminated by vote in room ${roomId}`
        );
      }
    }

    // ✅ Reset voting for next round
    gameRoom.players.forEach((player) => {
      player.hasVoted = false;
      player.votes = 0;
    });

    gameRoom.updatedAt = new Date();
    await gameRoom.save();

    io.to(roomId).emit("update_players", gameRoom.players);

    // ✅ Check win conditions
    setTimeout(() => {
      checkWinConditions(roomId, io);
    }, 3000);
  } catch (err) {
    console.error("❌ processVotingResults error:", err.message);
  }
}

async function checkWinConditions(roomId, io) {
  try {
    const gameRoom = await Game.findOne({ roomId });
    if (!gameRoom) return;

    const alivePlayers = gameRoom.players.filter((p) => p.isAlive);
    const aliveMafia = alivePlayers.filter((p) => p.gameRole === "mafia");
    const aliveVillagers = alivePlayers.filter((p) => p.gameRole !== "mafia");

    let winner = null;
    let message = "";

    if (aliveMafia.length === 0) {
      winner = "villagers";
      message = "Villagers win! All mafia have been eliminated.";
    } else if (aliveMafia.length >= aliveVillagers.length) {
      winner = "mafia";
      message = "Mafia wins! They equal or outnumber the villagers.";
    }

    if (winner) {
      gameRoom.phase = "ended";
      gameRoom.winner = winner;
      gameRoom.updatedAt = new Date();
      await gameRoom.save();

      io.to(roomId).emit("game_ended", {
        winner,
        message,
        players: gameRoom.players,
        finalStats: {
          totalPlayers: gameRoom.players.length,
          alivePlayers: alivePlayers.length,
          mafiaCount: aliveMafia.length,
          villagerCount: aliveVillagers.length,
        },
      });

      console.log(`🏆 Game ended in room ${roomId}: ${winner} wins!`);
    }
  } catch (err) {
    console.error("❌ checkWinConditions error:", err.message);
  }
}
