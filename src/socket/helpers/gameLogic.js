// src/socket/helpers/gameLogic.js
import { GAME_CONFIG, getRoleDistribution } from "../../config/gameConfig.js";

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

// ENHANCED: Complete checkWinCondition with detailed logic
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


export const resetNightActions = (gameRoom) => {
  gameRoom.hasMafiaKilled = false;
  gameRoom.hasDoctorHealed = false;
  gameRoom.hasDetectiveChecked = false;
  gameRoom.mafiaTarget = null;
  gameRoom.doctorTarget = null;
  gameRoom.mafiaVotes = []; // NEW: kechadagi ovozlar tozalanadi
  gameRoom.players.forEach(p => { p.isHealed = false; });
};

export const resetDayVotes = (gameRoom) => {
  gameRoom.players.forEach(p => {
    p.votes = 0;
    p.hasVoted = false;
  });
};


// FIXED: Complete processNightActions function
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
      gameRoom.phase = "ended";
      gameRoom.winner = winner;
      gameRoom.endedAt = new Date();
      
      // Send game end notification
      io.to(roomId).emit("game_ended", {
        winner: winner,
        reason: deathOccurred ? "elimination" : "standard",
        finalPlayers: gameRoom.players.map(p => ({
          userId: p.userId,
          username: p.username,
          role: p.gameRole,
          isAlive: p.isAlive
        }))
      });
      
      return "game_ended";
    }
  }

  return "continue";
};

// FIXED: Complete processDayVoting function
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
      gameRoom.phase = "ended";
      gameRoom.winner = winner;
      gameRoom.endedAt = new Date();
      
      // Send game end notification
      io.to(roomId).emit("game_ended", {
        winner: winner,
        reason: "elimination",
        eliminatedPlayer: {
          userId: eliminatedPlayer.userId,
          username: eliminatedPlayer.username,
          role: eliminatedPlayer.gameRole
        },
        finalPlayers: gameRoom.players.map(p => ({
          userId: p.userId,
          username: p.username,
          role: p.gameRole,
          isAlive: p.isAlive
        }))
      });
      
      return "game_ended";
    }
  }
  
  return "continue";
};
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