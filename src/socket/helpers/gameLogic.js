// src/socket/helpers/gameLogic.js - Complete Game Logic with generateRoles

// ===== GENERATE ROLES FUNCTION =====
export const generateRoles = (playerCount) => {
  const roles = [];
  const mafiaCount = Math.max(1, Math.floor(playerCount / 4));
  
  console.log(`🎭 Generating roles for ${playerCount} players (${mafiaCount} mafia)`);
  
  // Add mafia
  for (let i = 0; i < mafiaCount; i++) {
    roles.push("mafia");
  }
  
  // Add special roles (if enough players)
  if (playerCount >= 4) roles.push("doctor");
  if (playerCount >= 6) roles.push("detective");
  
  // Fill rest with villagers
  while (roles.length < playerCount) {
    roles.push("villager");
  }
  
  // Shuffle roles
  const shuffledRoles = roles.sort(() => Math.random() - 0.5);
  console.log(`🎲 Role distribution:`, shuffledRoles);
  
  return shuffledRoles;
};

// ===== WIN CONDITION CHECKER =====
export const checkWinCondition = (gameRoom) => {
  const alivePlayers = gameRoom.players.filter(p => p.isAlive);
  const aliveMafia = alivePlayers.filter(p => p.gameRole === "mafia");
  const aliveVillagers = alivePlayers.filter(p => p.gameRole !== "mafia");

  console.log(`🎯 Win Check: ${aliveMafia.length} mafia, ${aliveVillagers.length} villagers alive`);

  // Mafia wins if they equal or outnumber villagers
  if (aliveMafia.length >= aliveVillagers.length && aliveMafia.length > 0) {
    console.log("🏆 Mafia wins!");
    return "mafia";
  }

  // Villagers win if all mafia are eliminated
  if (aliveMafia.length === 0) {
    console.log("🏆 Villagers win!");
    return "villagers";
  }

  // Game continues
  return null;
};

// ===== PROCESS NIGHT ACTIONS =====
export const processNightActions = async (gameRoom, io, roomId) => {
  console.log("🌙 Processing night actions...");

  // Process mafia kill
  if (gameRoom.mafiaTarget) {
    const target = gameRoom.players.find(
      p => p.userId.toString() === gameRoom.mafiaTarget.toString()
    );
    
    if (target && target.isAlive) {
      // Check if target was healed
      if (gameRoom.doctorTarget && 
          gameRoom.doctorTarget.toString() === gameRoom.mafiaTarget.toString()) {
        // Target was saved by doctor
        io.to(roomId).emit("night_result", {
          type: "save",
          message: `${target.username} was attacked but saved by the doctor!`,
          targetId: target.userId.toString(),
          targetUsername: target.username
        });
        console.log(`🩺 ${target.username} was saved from mafia attack`);
      } else {
        // Target dies
        target.isAlive = false;
        io.to(roomId).emit("night_result", {
          type: "kill",
          message: `${target.username} was eliminated during the night.`,
          targetId: target.userId.toString(),
          targetUsername: target.username
        });
        console.log(`💀 ${target.username} was killed by mafia`);
      }
    }
  } else {
    // No one was targeted
    io.to(roomId).emit("night_result", {
      type: "nokill",
      message: "The night was peaceful. No one was harmed."
    });
  }

  // Reset night actions
  gameRoom.mafiaTarget = null;
  gameRoom.doctorTarget = null;
  gameRoom.hasMafiaKilled = false;
  gameRoom.hasDoctorHealed = false;
  gameRoom.hasDetectiveChecked = false;

  await gameRoom.save();
};

// ===== PROCESS DAY VOTING =====
export const processDayVoting = async (gameRoom, io, roomId) => {
  console.log("☀️ Processing day voting...");

  const alivePlayers = gameRoom.players.filter(p => p.isAlive);
  
  if (alivePlayers.length === 0) return false;

  // Find player with most votes
  const maxVotes = Math.max(...alivePlayers.map(p => p.votes || 0));
  
  if (maxVotes === 0) {
    // No votes cast
    io.to(roomId).emit("voting_result", {
      type: "novotes",
      message: "No votes were cast. The day ends peacefully."
    });
    return false;
  }

  const playersWithMaxVotes = alivePlayers.filter(p => (p.votes || 0) === maxVotes);
  
  if (playersWithMaxVotes.length === 1) {
    // Clear lynch
    const lynched = playersWithMaxVotes[0];
    lynched.isAlive = false;
    
    io.to(roomId).emit("voting_result", {
      type: "lynch",
      message: `${lynched.username} was lynched by the village with ${maxVotes} votes.`,
      targetId: lynched.userId.toString(),
      targetUsername: lynched.username,
      votes: maxVotes,
      role: lynched.gameRole // Reveal role after death
    });
    
    console.log(`⚰️ ${lynched.username} (${lynched.gameRole}) was lynched`);
    return true;
  } else {
    // Tie vote
    const tiedNames = playersWithMaxVotes.map(p => p.username).join(", ");
    io.to(roomId).emit("voting_result", {
      type: "tie",
      message: `Vote tied between ${tiedNames}. No one was lynched.`,
      tiedPlayers: playersWithMaxVotes.map(p => ({
        id: p.userId.toString(),
        username: p.username,
        votes: p.votes
      }))
    });
    
    console.log(`🤝 Vote tied: ${tiedNames}`);
    return false;
  }
};

// ===== RESET FUNCTIONS =====
export const resetNightActions = (gameRoom) => {
  gameRoom.hasMafiaKilled = false;
  gameRoom.hasDoctorHealed = false;
  gameRoom.hasDetectiveChecked = false;
  gameRoom.mafiaTarget = null;
  gameRoom.doctorTarget = null;
  
  gameRoom.players.forEach(player => {
    player.isHealed = false;
  });
  
  console.log("🌙 Night actions reset");
};

export const resetDayVotes = (gameRoom) => {
  gameRoom.players.forEach(player => {
    player.votes = 0;
    player.hasVoted = false;
  });
  
  console.log("☀️ Day votes reset");
};

// ===== GAME END HANDLER =====
export const handleGameEnd = async (gameRoom, io, roomId, winner) => {
  console.log(`🏁 Game ended! Winner: ${winner}`);

  gameRoom.phase = "ended";
  gameRoom.winner = winner;
  gameRoom.endedAt = new Date();
  
  // Calculate game statistics
  const gameStats = calculateGameStats(gameRoom);
  
  // Emit game end event
  io.to(roomId).emit("game_ended", {
    winner,
    message: winner === "mafia" ? 
      "🔥 Mafia wins! They have taken control of the village." :
      "🎉 Villagers win! All mafia members have been eliminated.",
    gameStats,
    finalPlayers: gameRoom.players.map(p => ({
      id: p.userId.toString(),
      username: p.username,
      role: p.gameRole,
      isAlive: p.isAlive,
      isWinner: (winner === "mafia" && p.gameRole === "mafia") ||
               (winner === "villagers" && p.gameRole !== "mafia")
    })),
    gameId: gameRoom.roomId,
    duration: Date.now() - gameRoom.createdAt.getTime()
  });

  await gameRoom.save();
  
  // Auto-restart option after 30 seconds
  setTimeout(() => {
    io.to(roomId).emit("restart_option", {
      message: "Game will restart in 30 seconds. Players can leave or stay for next round."
    });
  }, 5000);
};

// ===== GAME STATISTICS =====
export const calculateGameStats = (gameRoom) => {
  const totalPlayers = gameRoom.players.length;
  const survivors = gameRoom.players.filter(p => p.isAlive);
  const casualties = gameRoom.players.filter(p => !p.isAlive);
  
  return {
    totalPlayers,
    survivors: survivors.length,
    casualties: casualties.length,
    turns: gameRoom.currentTurn,
    mafiaCount: gameRoom.players.filter(p => p.gameRole === "mafia").length,
    villagerCount: gameRoom.players.filter(p => p.gameRole !== "mafia").length,
    survivalRate: Math.round((survivors.length / totalPlayers) * 100)
  };
};

// ===== RESTART GAME =====
export const resetGameForNewRound = (gameRoom) => {
  gameRoom.winner = null;
  gameRoom.phase = "waiting";
  gameRoom.currentTurn = 0;
  gameRoom.endedAt = null;
  
  // Reset all player states
  gameRoom.players.forEach((player) => {
    player.isReady = false;
    player.isAlive = true;
    player.gameRole = null;
    player.votes = 0;
    player.isHealed = false;
    player.hasVoted = false;
  });
  
  // Reset night actions
  gameRoom.hasMafiaKilled = false;
  gameRoom.hasDoctorHealed = false;
  gameRoom.hasDetectiveChecked = false;
  gameRoom.mafiaTarget = null;
  gameRoom.doctorTarget = null;
  
  console.log("🔄 Game reset for new round");
};