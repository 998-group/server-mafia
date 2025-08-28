// src/socket/helpers/gameLogic.js - COMPLETE VERSION
import { GAME_CONFIG, getRoleDistribution } from "../../config/gameConfig.js";

// ✅ EXISTING - Keep your generateRoles function
export const generateRoles = (playerCount) => {
  const roles = [];
  const roleDistribution = getRoleDistribution(playerCount, GAME_CONFIG.TEST_MODE);
  
  const mafiaCount = roleDistribution.mafia(playerCount);
  const doctorCount = roleDistribution.doctor(playerCount);
  const detectiveCount = roleDistribution.detective(playerCount);

  console.log(`🎭 Assigning roles for ${playerCount} players (Test: ${GAME_CONFIG.TEST_MODE})`);
  console.log(`📊 Roles: ${mafiaCount} mafia, ${doctorCount} doctor, ${detectiveCount} detective`);

  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  if (doctorCount) roles.push("doctor");
  if (detectiveCount) roles.push("detective");
  while (roles.length < playerCount) roles.push("peaceful");

  return roles.sort(() => Math.random() - 0.5);
};

// ✅ EXISTING - Keep your checkWinCondition function
export const checkWinCondition = (gameRoom) => {
  console.log(`🔍 Checking win condition for room ${gameRoom.roomId}`);
  
  const alivePlayers = gameRoom.players.filter(p => p.isAlive);
  const aliveMafia = alivePlayers.filter(p => p.gameRole === "mafia");
  const aliveInnocents = alivePlayers.filter(p => 
    p.gameRole === "doctor" || 
    p.gameRole === "detective" || 
    p.gameRole === "peaceful" ||
    p.gameRole === "villager"
  );
  
  console.log(`👥 Alive players: ${alivePlayers.length} total`);
  console.log(`🔫 Alive mafia: ${aliveMafia.length}`);
  console.log(`👼 Alive innocents: ${aliveInnocents.length}`);
  
  // WIN CONDITION 1: All mafia eliminated = Innocents win
  if (aliveMafia.length === 0) {
    console.log(`🏆 INNOCENTS WIN: All mafia eliminated`);
    return {
      winner: "innocent",
      reason: "all_mafia_eliminated",
      survivors: aliveInnocents.length,
      details: {
        aliveMafia: aliveMafia.map(p => ({ userId: p.userId, username: p.username })),
        aliveInnocents: aliveInnocents.map(p => ({ userId: p.userId, username: p.username, role: p.gameRole }))
      }
    };
  }
  
  // WIN CONDITION 2: Mafia >= Innocents = Mafia wins
  if (aliveMafia.length >= aliveInnocents.length) {
    console.log(`🏆 MAFIA WIN: ${aliveMafia.length} mafia >= ${aliveInnocents.length} innocents`);
    return {
      winner: "mafia",
      reason: "mafia_majority",
      survivors: aliveMafia.length,
      details: {
        aliveMafia: aliveMafia.map(p => ({ userId: p.userId, username: p.username })),
        aliveInnocents: aliveInnocents.map(p => ({ userId: p.userId, username: p.username, role: p.gameRole }))
      }
    };
  }
  
  // No win condition met - game continues
  console.log(`🎮 Game continues: ${aliveMafia.length} mafia vs ${aliveInnocents.length} innocents`);
  return null;
};

// ✅ EXISTING - Keep your resetNightActions function
export const resetNightActions = (gameRoom) => {
  gameRoom.hasMafiaKilled = false;
  gameRoom.hasDoctorHealed = false;
  gameRoom.hasDetectiveChecked = false;
  gameRoom.mafiaTarget = null;
  gameRoom.doctorTarget = null;
  gameRoom.mafiaVotes = []; // NEW: kechadagi ovozlar tozalanadi
  gameRoom.players.forEach(p => { p.isHealed = false; });
};

// ✅ EXISTING - Keep your resetDayVotes function
export const resetDayVotes = (gameRoom) => {
  gameRoom.players.forEach(p => {
    p.votes = 0;
    p.hasVoted = false;
  });
};

// ✅ EXISTING - Keep your processNightActions function
export const processNightActions = (gameRoom, io, roomId) => {
  console.log(`🌙 Processing night actions for room ${roomId}`);
  
  // 1) Process Mafia Votes -> count by target
  const votes = gameRoom.mafiaVotes || [];
  let deathOccurred = false;
  let killedPlayer = null;
  
  if (votes.length === 0) {
    // No votes cast -> no one dies
    io.to(roomId).emit("night_result", { 
      message: "Tunda hech kim o'ldirilmadi.",
      reason: "no_mafia_vote"
    });
  } else {
    // Count votes by target
    const countMap = new Map();
    for (const v of votes) {
      const key = v.target.toString();
      countMap.set(key, (countMap.get(key) || 0) + 1);
    }

    // Find target(s) with most votes
    let maxVotes = 0;
    let leaders = [];
    for (const [targetId, count] of countMap.entries()) {
      if (count > maxVotes) {
        maxVotes = count;
        leaders = [targetId];
      } else if (count === maxVotes) {
        leaders.push(targetId);
      }
    }

    // Handle ties with random selection
    const chosenTargetId = leaders.length === 1
      ? leaders[0]
      : leaders[Math.floor(Math.random() * leaders.length)];

    // Set for compatibility
    gameRoom.mafiaTarget = chosenTargetId;

    // Check if doctor saved the target
    const wasSaved = gameRoom.doctorTarget && 
                     gameRoom.doctorTarget.toString() === chosenTargetId.toString();

    const targetPlayer = gameRoom.players.find(p => 
      p.userId.toString() === chosenTargetId.toString()
    );

    if (targetPlayer && targetPlayer.isAlive) {
      if (wasSaved) {
        // Player was saved by doctor
        io.to(roomId).emit("player_saved", {
          targetId: chosenTargetId,
          targetUsername: targetPlayer.username,
          message: "Someone was saved by the doctor!"
        });
      } else {
        // Player was killed
        targetPlayer.isAlive = false;
        killedPlayer = targetPlayer;
        deathOccurred = true;
        
        io.to(roomId).emit("player_killed", {
          targetId: chosenTargetId,
          targetUsername: targetPlayer.username,
          cause: "mafia_kill"
        });
        
        // Send death notification for UI components
        io.to(roomId).emit("player_death", {
          deadPlayerId: chosenTargetId,
          deadPlayerUsername: targetPlayer.username,
          deadPlayerRole: targetPlayer.gameRole,
          cause: "mafia_kill",
          timestamp: new Date()
        });
      }
    }
  }

  // 2) Process Detective Check (if exists)
  if (gameRoom.detectiveTarget) {
    const detective = gameRoom.players.find(p => 
      p.gameRole === "detective" && p.isAlive
    );
    const target = gameRoom.players.find(p => 
      p.userId.toString() === gameRoom.detectiveTarget.toString()
    );
    
    if (detective && target) {
      // Send result only to detective via private message
      io.to(roomId).emit("detective_result", {
        detectiveId: detective.userId,
        targetId: gameRoom.detectiveTarget,
        targetUsername: target.username,
        targetRole: target.gameRole === "mafia" ? "mafia" : "innocent",
        isPrivate: true
      });
    }
  }

  // 3) Reset night action flags
  resetNightActions(gameRoom);

  // 4) Check win condition if death occurred
  if (deathOccurred) {
    const winner = checkWinCondition(gameRoom);
    if (winner) {
      return gameEndHandler(gameRoom, io, roomId, winner);
    }
  }

  return "continue";
};

// ✅ EXISTING - Keep your processDayVoting function
export const processDayVoting = (gameRoom, io, roomId) => {
  console.log(`☀️ Processing day votes for room ${roomId}`);
  
  const alivePlayers = gameRoom.players.filter(p => p.isAlive);
  const maxVotes = Math.max(...alivePlayers.map(p => p.votes || 0));
  
  let eliminatedPlayer = null;
  let deathOccurred = false;
  
  if (maxVotes === 0) {
    // No votes cast - no elimination
    io.to(roomId).emit("no_elimination", {
      message: "No votes were cast. No elimination.",
      reason: "no_votes"
    });
  } else {
    const playersWithMaxVotes = alivePlayers.filter(p => (p.votes || 0) === maxVotes);
    
    if (playersWithMaxVotes.length === 1) {
      // Single player with most votes - eliminate them
      eliminatedPlayer = playersWithMaxVotes[0];
      eliminatedPlayer.isAlive = false;
      deathOccurred = true;
      
      io.to(roomId).emit("player_eliminated", {
        targetId: eliminatedPlayer.userId.toString(),
        targetUsername: eliminatedPlayer.username,
        targetRole: eliminatedPlayer.gameRole,
        votes: maxVotes,
        cause: "day_vote"
      });
      
      // Send death notification for UI components
      io.to(roomId).emit("player_death", {
        deadPlayerId: eliminatedPlayer.userId.toString(),
        deadPlayerUsername: eliminatedPlayer.username,
        deadPlayerRole: eliminatedPlayer.gameRole,
        cause: "day_elimination",
        votes: maxVotes,
        timestamp: new Date()
      });
      
    } else if (playersWithMaxVotes.length > 1) {
      // Tie situation - no elimination
      io.to(roomId).emit("vote_tie", {
        message: `Tie between ${playersWithMaxVotes.length} players. No elimination.`,
        tiedPlayers: playersWithMaxVotes.map(p => ({
          userId: p.userId,
          username: p.username,
          votes: p.votes
        })),
        reason: "tie"
      });
    }
  }
  
  // Reset day votes for next round
  resetDayVotes(gameRoom);
  
  // Check win condition if death occurred
  if (deathOccurred) {
    const winner = checkWinCondition(gameRoom);
    if (winner) {
      return gameEndHandler(gameRoom, io, roomId, winner, eliminatedPlayer);
    }
  }
  
  return "continue";
};

// ✅ EXISTING - Keep your resetGameForNewRound function
export const resetGameForNewRound = (gameRoom) => {
  gameRoom.winner = null;
  gameRoom.currentTurn = 0;
  gameRoom.players.forEach((p) => {
    p.isReady = false;
    p.isAlive = true;
    p.gameRole = null;
    p.votes = 0;
    p.isHealed = false;
    p.hasVoted = false;
  });
};

// ✅ MISSING - Add these functions that your timer system needs:

// Game End Handler
export const gameEndHandler = async (gameRoom, io, roomId, winner, eliminatedPlayer = null) => {
  console.log(`🏆 Game ended in room ${roomId}: ${winner.winner} wins`);
  
  // Set game state
  gameRoom.phase = "ended";
  gameRoom.winner = winner;
  gameRoom.endedAt = new Date();
  
  try {
    await gameRoom.save();
  } catch (saveError) {
    console.error(`❌ Failed to save game end state for room ${roomId}:`, saveError.message);
  }
  
  // Prepare final game data
  const gameEndData = {
    winner: winner.winner,
    reason: winner.reason,
    survivors: winner.survivors,
    details: winner.details,
    finalPlayers: gameRoom.players.map(p => ({
      userId: p.userId,
      username: p.username,
      role: p.gameRole,
      isAlive: p.isAlive,
      isWinner: winner.winner === "innocent" 
        ? (p.gameRole !== "mafia")
        : (p.gameRole === "mafia")
    })),
    gameStats: calculateGameStats(gameRoom),
    eliminatedPlayer: eliminatedPlayer ? {
      userId: eliminatedPlayer.userId,
      username: eliminatedPlayer.username,
      role: eliminatedPlayer.gameRole
    } : null
  };
  
  // Send game end notification
  io.to(roomId).emit("game_ended", gameEndData);
  
  // Update phase for all clients
  io.to(roomId).emit("game_phase", {
    phase: gameRoom.phase,
    winner: gameRoom.winner,
    roomId: gameRoom.roomId,
    endedAt: gameRoom.endedAt
  });
  
  // Update players list
  io.to(roomId).emit("update_players", gameRoom.players);
  
  console.log(`✅ Game end handled for room ${roomId} - ${winner.winner} wins`);
  return "game_ended";
};

// Calculate Game Statistics
export const calculateGameStats = (gameRoom) => {
  const startTime = gameRoom.createdAt;
  const endTime = new Date();
  const duration = endTime - startTime;
  
  const totalPlayers = gameRoom.players.length;
  const survivorCount = gameRoom.players.filter(p => p.isAlive).length;
  const deathCount = totalPlayers - survivorCount;
  
  const mafiaPlayers = gameRoom.players.filter(p => p.gameRole === "mafia");
  const innocentPlayers = gameRoom.players.filter(p => p.gameRole !== "mafia");
  
  return {
    gameDuration: Math.floor(duration / 1000), // seconds
    totalTurns: gameRoom.currentTurn || 0,
    totalPlayers: totalPlayers,
    survivors: survivorCount,
    deaths: deathCount,
    mafiaCount: mafiaPlayers.length,
    innocentCount: innocentPlayers.length,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    durationFormatted: formatDuration(duration)
  };
};

// Validate Night Action
export const validateNightAction = (gameRoom, actorId, targetId, actionType) => {
  console.log(`🔍 Validating ${actionType} from ${actorId} to ${targetId} in room ${gameRoom.roomId}`);
  
  const actor = gameRoom.players.find(p => p.userId.toString() === actorId.toString());
  const target = gameRoom.players.find(p => p.userId.toString() === targetId.toString());
  
  // Basic validation
  if (!actor) {
    return { valid: false, error: "Actor not found in game" };
  }
  
  if (!target) {
    return { valid: false, error: "Target not found in game" };
  }
  
  if (!actor.isAlive) {
    return { valid: false, error: "Actor is not alive" };
  }
  
  if (!target.isAlive) {
    return { valid: false, error: "Target is not alive" };
  }
  
  if (gameRoom.phase !== "night") {
    return { valid: false, error: "Not night phase" };
  }
  
  // Action-specific validation
  switch (actionType) {
    case "mafia_kill":
    case "mafia_vote":
      if (actor.gameRole !== "mafia") {
        return { valid: false, error: "Actor is not mafia" };
      }
      if (target.gameRole === "mafia") {
        return { valid: false, error: "Cannot target fellow mafia member" };
      }
      // Note: Multiple mafia can vote, so we don't check hasMafiaKilled here
      break;
      
    case "doctor_heal":
      if (actor.gameRole !== "doctor") {
        return { valid: false, error: "Actor is not doctor" };
      }
      if (gameRoom.hasDoctorHealed) {
        return { valid: false, error: "Doctor has already healed this night" };
      }
      break;
      
    case "detective_check":
      if (actor.gameRole !== "detective") {
        return { valid: false, error: "Actor is not detective" };
      }
      if (gameRoom.hasDetectiveChecked) {
        return { valid: false, error: "Detective has already investigated this night" };
      }
      break;
      
    default:
      return { valid: false, error: `Unknown action type: ${actionType}` };
  }
  
  console.log(`✅ Validation passed for ${actionType} from ${actor.username} to ${target.username}`);
  return { valid: true };
};

// Validate Day Vote
export const validateDayVote = (gameRoom, voterId, targetId) => {
  console.log(`🗳️ Validating day vote from ${voterId} to ${targetId} in room ${gameRoom.roomId}`);
  
  const voter = gameRoom.players.find(p => p.userId.toString() === voterId.toString());
  const target = gameRoom.players.find(p => p.userId.toString() === targetId.toString());
  
  // Basic validation
  if (!voter) {
    return { valid: false, error: "Voter not found in game" };
  }
  
  if (!target) {
    return { valid: false, error: "Target not found in game" };
  }
  
  if (!voter.isAlive) {
    return { valid: false, error: "Voter is not alive" };
  }
  
  if (!target.isAlive) {
    return { valid: false, error: "Cannot vote for dead player" };
  }
  
  if (gameRoom.phase !== "day") {
    return { valid: false, error: "Not day phase" };
  }
  
  if (voter.hasVoted) {
    return { valid: false, error: "Voter has already voted" };
  }
  
  if (voterId.toString() === targetId.toString()) {
    return { valid: false, error: "Cannot vote for yourself" };
  }
  
  console.log(`✅ Day vote validation passed for ${voter.username} voting ${target.username}`);
  return { valid: true };
};

// Send Death Notification (comprehensive)
export const sendDeathNotification = (io, roomId, deadPlayer, cause, additionalData = {}) => {
  console.log(`💀 Sending death notification: ${deadPlayer.username} (${cause}) in room ${roomId}`);
  
  const deathData = {
    deadPlayerId: deadPlayer.userId.toString(),
    deadPlayerUsername: deadPlayer.username,
    deadPlayerRole: deadPlayer.gameRole,
    cause: cause, // "mafia_kill", "day_elimination", etc.
    timestamp: new Date(),
    ...additionalData
  };
  
  // Send death notification
  io.to(roomId).emit("player_death", deathData);
  
  // Send specific event based on cause
  switch (cause) {
    case "mafia_kill":
      io.to(roomId).emit("player_killed", deathData);
      break;
    case "day_elimination":
      io.to(roomId).emit("player_eliminated", deathData);
      break;
    default:
      break;
  }
  
  console.log(`✅ Death notification sent for ${deadPlayer.username}`);
};

// Helper function to format duration
const formatDuration = (milliseconds) => {
  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

// Get Game Phase Info (for timer display)
export const getPhaseInfo = (phase) => {
  switch (phase) {
    case "waiting":
      return { label: "Waiting for Players", duration: 0 };
    case "started":
      return { label: "Game Starting", duration: GAME_CONFIG.PHASE_DURATIONS?.started || 10 };
    case "night":
      return { label: "Night Phase", duration: GAME_CONFIG.PHASE_DURATIONS?.night || 60 };
    case "day":
      return { label: "Day Phase", duration: GAME_CONFIG.PHASE_DURATIONS?.day || 120 };
    case "ended":
      return { label: "Game Over", duration: 0 };
    default:
      return { label: "Unknown Phase", duration: 0 };
  }
};

// Export all functions
console.log("✅ Complete gameLogic.js loaded with all functions");