// src/socket/helpers/gameLogic.js - Game Logic Helper Functions

import { GAME_CONFIG } from "../../config/gameConfig.js";

// ===== ROLE GENERATION =====
export const generateRoles = (playerCount) => {
  try {
    console.log(`🎭 Generating roles for ${playerCount} players`);

    if (playerCount < 3) {
      throw new Error("Not enough players to start game");
    }

    const roles = [];
    
    // ✅ Role distribution based on player count
    let mafiaCount, doctorCount, detectiveCount, villagerCount;

    if (playerCount <= 4) {
      mafiaCount = 1;
      doctorCount = 1;
      detectiveCount = 0;
      villagerCount = playerCount - 2;
    } else if (playerCount <= 6) {
      mafiaCount = 1;
      doctorCount = 1;
      detectiveCount = 1;
      villagerCount = playerCount - 3;
    } else if (playerCount <= 8) {
      mafiaCount = 2;
      doctorCount = 1;
      detectiveCount = 1;
      villagerCount = playerCount - 4;
    } else {
      mafiaCount = Math.ceil(playerCount * 0.25); // 25% mafia
      doctorCount = 1;
      detectiveCount = 1;
      villagerCount = playerCount - mafiaCount - doctorCount - detectiveCount;
    }

    // ✅ Add roles to array
    for (let i = 0; i < mafiaCount; i++) {
      roles.push("mafia");
    }
    for (let i = 0; i < doctorCount; i++) {
      roles.push("doctor");
    }
    for (let i = 0; i < detectiveCount; i++) {
      roles.push("detective");
    }
    for (let i = 0; i < villagerCount; i++) {
      roles.push("villager");
    }

    // ✅ Shuffle roles
    for (let i = roles.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }

    console.log(`🎭 Roles generated: ${mafiaCount} mafia, ${doctorCount} doctor, ${detectiveCount} detective, ${villagerCount} villagers`);
    
    return roles;
  } catch (err) {
    console.error("❌ Error generating roles:", err.message);
    throw err;
  }
};

// ===== ROLE VALIDATION =====
export const validateRole = (role, allowedRoles = ["villager", "mafia", "doctor", "detective"]) => {
  return allowedRoles.includes(role);
};

// ===== GAME STATE VALIDATION =====
export const validateGameState = (gameRoom) => {
  try {
    if (!gameRoom) return false;
    
    // ✅ Check required fields
    if (!gameRoom.roomId || !gameRoom.players || !Array.isArray(gameRoom.players)) {
      return false;
    }

    // ✅ Check player count
    const playerCount = gameRoom.players.length;
    if (playerCount < GAME_CONFIG.MIN_PLAYERS || playerCount > GAME_CONFIG.MAX_PLAYERS) {
      return false;
    }

    // ✅ Check phase validity
    const validPhases = ["waiting", "started", "night", "day", "voting", "ended"];
    if (!validPhases.includes(gameRoom.phase)) {
      return false;
    }

    // ✅ Validate players
    for (const player of gameRoom.players) {
      if (!player.userId || !player.username) {
        return false;
      }
      
      // ✅ Check role if game started
      if (gameRoom.phase !== "waiting" && !validateRole(player.gameRole)) {
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error("❌ Error validating game state:", err.message);
    return false;
  }
};

// ===== WIN CONDITION CHECKER =====
export const checkWinConditions = (players) => {
  try {
    const alivePlayers = players.filter(p => p.isAlive);
    const aliveMafia = alivePlayers.filter(p => p.gameRole === "mafia");
    const aliveVillagers = alivePlayers.filter(p => p.gameRole !== "mafia");

    console.log(`🏆 Win check: ${aliveMafia.length} mafia, ${aliveVillagers.length} villagers alive`);

    if (aliveMafia.length === 0) {
      return {
        winner: "villagers",
        message: "Villagers win! All mafia have been eliminated.",
        reason: "mafia_eliminated"
      };
    }

    if (aliveMafia.length >= aliveVillagers.length) {
      return {
        winner: "mafia",
        message: "Mafia wins! They equal or outnumber the villagers.",
        reason: "mafia_majority"
      };
    }

    return null; // Game continues
  } catch (err) {
    console.error("❌ Error checking win conditions:", err.message);
    return null;
  }
};

// ===== VOTE CALCULATOR =====
export const calculateVoteResults = (players) => {
  try {
    const alivePlayers = players.filter(p => p.isAlive);
    const votedPlayers = alivePlayers.filter(p => (p.votes || 0) > 0);
    
    if (votedPlayers.length === 0) {
      return {
        eliminated: null,
        reason: "no_votes",
        message: "No one was eliminated - no votes cast"
      };
    }

    // ✅ Find max votes
    const maxVotes = Math.max(...votedPlayers.map(p => p.votes));
    const playersWithMaxVotes = votedPlayers.filter(p => p.votes === maxVotes);
    
    if (playersWithMaxVotes.length > 1) {
      return {
        eliminated: null,
        reason: "tie",
        message: `Voting tied between ${playersWithMaxVotes.map(p => p.username).join(', ')}`,
        tiedPlayers: playersWithMaxVotes
      };
    }

    const eliminatedPlayer = playersWithMaxVotes[0];
    return {
      eliminated: eliminatedPlayer,
      reason: "majority_vote",
      message: `${eliminatedPlayer.username} was eliminated by vote`,
      votes: eliminatedPlayer.votes
    };
  } catch (err) {
    console.error("❌ Error calculating vote results:", err.message);
    return {
      eliminated: null,
      reason: "error",
      message: "Error processing votes"
    };
  }
};

// ===== PLAYER ACTIONS VALIDATOR =====
export const validatePlayerAction = (gameRoom, playerId, action, targetId = null) => {
  try {
    const player = gameRoom.players.find(p => p.userId.toString() === playerId.toString());
    
    if (!player) {
      return { valid: false, message: "Player not found" };
    }

    if (!player.isAlive) {
      return { valid: false, message: "Dead players cannot perform actions" };
    }

    // ✅ Validate action based on role and phase
    switch (action) {
      case "mafia_kill":
        if (player.gameRole !== "mafia") {
          return { valid: false, message: "Only mafia can kill" };
        }
        if (gameRoom.phase !== "night") {
          return { valid: false, message: "Killing only allowed during night" };
        }
        if (gameRoom.hasMafiaKilled) {
          return { valid: false, message: "Mafia has already acted this turn" };
        }
        break;

      case "doctor_heal":
        if (player.gameRole !== "doctor") {
          return { valid: false, message: "Only doctor can heal" };
        }
        if (gameRoom.phase !== "night") {
          return { valid: false, message: "Healing only allowed during night" };
        }
        if (gameRoom.hasDoctorHealed) {
          return { valid: false, message: "Doctor has already acted this turn" };
        }
        break;

      case "detective_check":
        if (player.gameRole !== "detective") {
          return { valid: false, message: "Only detective can investigate" };
        }
        if (gameRoom.phase !== "night") {
          return { valid: false, message: "Investigation only allowed during night" };
        }
        if (gameRoom.hasDetectiveChecked) {
          return { valid: false, message: "Detective has already acted this turn" };
        }
        break;

      case "vote":
        if (gameRoom.phase !== "day" && gameRoom.phase !== "voting") {
          return { valid: false, message: "Voting only allowed during day/voting phase" };
        }
        if (player.hasVoted) {
          return { valid: false, message: "You have already voted" };
        }
        if (targetId === playerId) {
          return { valid: false, message: "Cannot vote for yourself" };
        }
        break;

      default:
        return { valid: false, message: "Unknown action" };
    }

    // ✅ Validate target if required
    if (targetId) {
      const target = gameRoom.players.find(p => p.userId.toString() === targetId.toString());
      if (!target) {
        return { valid: false, message: "Target not found" };
      }
      if (!target.isAlive) {
        return { valid: false, message: "Cannot target dead players" };
      }
    }

    return { valid: true, message: "Action is valid" };
  } catch (err) {
    console.error("❌ Error validating player action:", err.message);
    return { valid: false, message: "Error validating action" };
  }
};

// ===== NIGHT ACTIONS PROCESSOR =====
export const processNightActions = (gameRoom) => {
  try {
    const results = [];
    let playerKilled = false;

    // ✅ Process mafia kill
    if (gameRoom.mafiaTarget) {
      const target = gameRoom.players.find(p => p.userId.toString() === gameRoom.mafiaTarget.toString());
      if (target && target.isAlive) {
        if (!target.isHealed) {
          target.isAlive = false;
          playerKilled = true;
          results.push({
            type: "kill",
            message: `${target.username} was eliminated by the mafia`,
            target: target.username,
            role: target.gameRole
          });
        } else {
          results.push({
            type: "saved",
            message: "Someone was attacked but saved by the doctor!",
            target: null
          });
        }
      }
    }

    // ✅ Reset heal status
    gameRoom.players.forEach(player => {
      player.isHealed = false;
    });

    // ✅ If no kill happened
    if (!playerKilled && !gameRoom.mafiaTarget) {
      results.push({
        type: "peaceful",
        message: "The night was peaceful",
        target: null
      });
    }

    return {
      results,
      playerKilled,
      summary: results.map(r => r.message).join('. ')
    };
  } catch (err) {
    console.error("❌ Error processing night actions:", err.message);
    return {
      results: [],
      playerKilled: false,
      summary: "Error processing night actions"
    };
  }
};

// ===== ROLE DESCRIPTIONS =====
export const getRoleDescription = (role) => {
  const descriptions = {
    villager: {
      name: "Villager",
      description: "A normal citizen trying to find and eliminate the mafia",
      abilities: ["Vote during the day"],
      winCondition: "Eliminate all mafia members"
    },
    mafia: {
      name: "Mafia",
      description: "A member of the criminal organization trying to take over the town",
      abilities: ["Kill one player each night", "Vote during the day"],
      winCondition: "Equal or outnumber the villagers"
    },
    doctor: {
      name: "Doctor",
      description: "A medical professional who can save lives",
      abilities: ["Heal one player each night (including yourself)", "Vote during the day"],
      winCondition: "Help villagers eliminate all mafia"
    },
    detective: {
      name: "Detective",
      description: "An investigator who can discover players' true identities",
      abilities: ["Investigate one player each night to learn their role", "Vote during the day"],
      winCondition: "Help villagers eliminate all mafia"
    }
  };

  return descriptions[role] || {
    name: "Unknown",
    description: "Unknown role",
    abilities: [],
    winCondition: "Unknown"
  };
};

// ===== PHASE DESCRIPTIONS =====
export const getPhaseDescription = (phase) => {
  const descriptions = {
    waiting: "Waiting for players to join and ready up",
    started: "Game has started, preparing for night phase",
    night: "Night time - special roles perform their actions",
    day: "Day time - all players discuss and prepare to vote",
    voting: "Voting phase - players vote to eliminate someone",
    ended: "Game has ended"
  };

  return descriptions[phase] || "Unknown phase";
};

// ===== GAME STATISTICS =====
export const calculateGameStats = (gameRoom) => {
  try {
    const stats = {
      totalPlayers: gameRoom.players.length,
      alivePlayers: gameRoom.players.filter(p => p.isAlive).length,
      deadPlayers: gameRoom.players.filter(p => !p.isAlive).length,
      currentTurn: gameRoom.currentTurn || 1,
      phase: gameRoom.phase,
      roles: {}
    };

    // ✅ Count players by role
    const roleCounts = {};
    const aliveRoleCounts = {};

    gameRoom.players.forEach(player => {
      const role = player.gameRole || 'unknown';
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      
      if (player.isAlive) {
        aliveRoleCounts[role] = (aliveRoleCounts[role] || 0) + 1;
      }
    });

    stats.roles = {
      total: roleCounts,
      alive: aliveRoleCounts
    };

    // ✅ Calculate team stats
    const mafiaAlive = stats.roles.alive.mafia || 0;
    const villagersAlive = stats.alivePlayers - mafiaAlive;
    
    stats.teams = {
      mafia: {
        alive: mafiaAlive,
        total: stats.roles.total.mafia || 0
      },
      villagers: {
        alive: villagersAlive,
        total: stats.totalPlayers - (stats.roles.total.mafia || 0)
      }
    };

    return stats;
  } catch (err) {
    console.error("❌ Error calculating game stats:", err.message);
    return {
      totalPlayers: 0,
      alivePlayers: 0,
      deadPlayers: 0,
      currentTurn: 1,
      phase: 'unknown',
      roles: { total: {}, alive: {} },
      teams: { mafia: { alive: 0, total: 0 }, villagers: { alive: 0, total: 0 } }
    };
  }
};

// ===== PLAYER PERMISSIONS =====
export const getPlayerPermissions = (player, gameRoom) => {
  try {
    const permissions = {
      canVote: false,
      canUseNightAction: false,
      canSpeak: false,
      canViewRole: false,
      canViewOtherRoles: false
    };

    if (!player || !player.isAlive) {
      return permissions;
    }

    // ✅ Basic permissions for alive players
    permissions.canSpeak = true;
    permissions.canViewRole = true;

    // ✅ Phase-based permissions
    switch (gameRoom.phase) {
      case 'day':
      case 'voting':
        permissions.canVote = !player.hasVoted;
        break;
        
      case 'night':
        if (player.gameRole === 'mafia' && !gameRoom.hasMafiaKilled) {
          permissions.canUseNightAction = true;
        }
        if (player.gameRole === 'doctor' && !gameRoom.hasDoctorHealed) {
          permissions.canUseNightAction = true;
        }
        if (player.gameRole === 'detective' && !gameRoom.hasDetectiveChecked) {
          permissions.canUseNightAction = true;
        }
        break;
    }

    // ✅ Special role permissions
    if (player.gameRole === 'mafia') {
      // Mafia can see other mafia members
      permissions.canViewOtherRoles = true;
    }

    return permissions;
  } catch (err) {
    console.error("❌ Error getting player permissions:", err.message);
    return {
      canVote: false,
      canUseNightAction: false,
      canSpeak: false,
      canViewRole: false,
      canViewOtherRoles: false
    };
  }
};

// ===== SANITIZE GAME DATA =====
export const sanitizeGameDataForPlayer = (gameRoom, playerId) => {
  try {
    const sanitizedRoom = {
      roomId: gameRoom.roomId,
      roomName: gameRoom.roomName,
      phase: gameRoom.phase,
      currentTurn: gameRoom.currentTurn,
      hostId: gameRoom.hostId,
      players: []
    };

    const requestingPlayer = gameRoom.players.find(p => p.userId.toString() === playerId.toString());
    const canSeeRoles = requestingPlayer && requestingPlayer.gameRole === 'mafia';

    // ✅ Sanitize player data
    sanitizedRoom.players = gameRoom.players.map(player => {
      const sanitizedPlayer = {
        userId: player.userId,
        username: player.username,
        isAlive: player.isAlive,
        isReady: player.isReady,
        hasVoted: player.hasVoted,
        votes: player.votes || 0
      };

      // ✅ Show role only to the player themselves or mafia (for other mafia)
      if (player.userId.toString() === playerId.toString()) {
        sanitizedPlayer.gameRole = player.gameRole;
        sanitizedPlayer.isHealed = player.isHealed;
      } else if (canSeeRoles && player.gameRole === 'mafia') {
        sanitizedPlayer.gameRole = player.gameRole;
      }

      return sanitizedPlayer;
    });

    return sanitizedRoom;
  } catch (err) {
    console.error("❌ Error sanitizing game data:", err.message);
    return null;
  }
};

// ===== ROOM CLEANUP HELPER =====
export const shouldCleanupRoom = (gameRoom) => {
  try {
    const now = new Date();
    const lastUpdate = new Date(gameRoom.updatedAt);
    const timeSinceUpdate = now - lastUpdate;
    
    // ✅ Clean up ended games after 1 hour
    if (gameRoom.phase === 'ended' && timeSinceUpdate > 60 * 60 * 1000) {
      return true;
    }
    
    // ✅ Clean up empty rooms
    if (!gameRoom.players || gameRoom.players.length === 0) {
      return true;
    }
    
    // ✅ Clean up stale waiting rooms after 2 hours
    if (gameRoom.phase === 'waiting' && timeSinceUpdate > 2 * 60 * 60 * 1000) {
      return true;
    }
    
    return false;
  } catch (err) {
    console.error("❌ Error checking room cleanup:", err.message);
    return false;
  }
};

// ===== EXPORT ALL FUNCTIONS =====
export default {
  generateRoles,
  validateRole,
  validateGameState,
  checkWinConditions,
  calculateVoteResults,
  validatePlayerAction,
  processNightActions,
  getRoleDescription,
  getPhaseDescription,
  calculateGameStats,
  getPlayerPermissions,
  sanitizeGameDataForPlayer,
  shouldCleanupRoom
};