// src/config/gameConfig.js - Complete Game Configuration
export const GAME_CONFIG = {
  // ===== PHASE DURATIONS (in milliseconds) =====
  PHASE_DURATIONS: {
    night: 60000,      // 1 minute - Night phase for special roles
    day: 120000,       // 2 minutes - Day phase for discussion
    voting: 60000,     // 1 minute - Voting phase
    started: 5000,     // 5 seconds - Transition delay after game starts
    preparation: 3000  // 3 seconds - Role assignment preparation
  },

  // ===== PLAYER LIMITS =====
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 15,

  // ===== ROLE CONFIGURATION =====
  ROLES: {
    MAFIA_RATIO: 0.25,     // 25% of players will be mafia
    DOCTOR_COUNT: 1,       // Always 1 doctor
    DETECTIVE_COUNT: 1,    // Always 1 detective (if enough players)
    MIN_PLAYERS_FOR_DETECTIVE: 5  // Need at least 5 players for detective
  },

  // ===== GAME PHASES =====
  PHASES: {
    WAITING: 'waiting',
    STARTED: 'started',
    NIGHT: 'night',
    DAY: 'day',
    VOTING: 'voting',
    ENDED: 'ended'
  },

  // ===== PLAYER ROLES =====
  PLAYER_ROLES: {
    VILLAGER: 'villager',
    MAFIA: 'mafia',
    DOCTOR: 'doctor',
    DETECTIVE: 'detective'
  },

  // ===== WIN CONDITIONS =====
  WIN_CONDITIONS: {
    MAFIA_WINS: 'mafia',
    VILLAGERS_WIN: 'villagers'
  },

  // ===== ROLE DESCRIPTIONS =====
  ROLE_DESCRIPTIONS: {
    villager: {
      title: "You are a VILLAGER. Find and eliminate all mafia members.",
      description: "Vote out the mafia to win",
      objective: "Eliminate all mafia members",
      nightAction: "Sleep and wait for day phase",
      dayAction: "Discuss and vote to eliminate suspects"
    },
    mafia: {
      title: "You are a MAFIA member. Kill villagers at night and blend in during the day.",
      description: "Eliminate all villagers to win",
      objective: "Eliminate all villagers",
      nightAction: "Choose a player to eliminate",
      dayAction: "Blend in and avoid suspicion"
    },
    doctor: {
      title: "You are the DOCTOR. Heal players at night to save them from attacks.",
      description: "Save the innocent, win with villagers",
      objective: "Keep villagers alive",
      nightAction: "Choose a player to heal",
      dayAction: "Discuss and vote with villagers"
    },
    detective: {
      title: "You are the DETECTIVE. Investigate players at night to discover their roles.",
      description: "Find the mafia, win with villagers",
      objective: "Identify the mafia",
      nightAction: "Choose a player to investigate",
      dayAction: "Use your knowledge to guide votes"
    }
  },

  // ===== ROLE IMAGES =====
  ROLE_IMAGES: {
    villager: "https://cdn-icons-png.flaticon.com/512/3135/3135715.png",
    mafia: "https://cdn-icons-png.flaticon.com/512/3062/3062634.png",
    doctor: "https://cdn-icons-png.flaticon.com/512/2785/2785482.png",
    detective: "https://cdn-icons-png.flaticon.com/512/3110/3110270.png"
  },

  // ===== SOCKET EVENTS =====
  SOCKET_EVENTS: {
    // Room events
    CREATE_ROOM: 'create_room',
    JOIN_ROOM: 'join_room',
    LEAVE_ROOM: 'leave_room',
    JOINED_ROOM: 'joined_room',
    UPDATE_PLAYERS: 'update_players',
    
    // Game events
    START_GAME: 'start_game',
    GAME_STARTED: 'game_started',
    PHASE_CHANGED: 'phase_changed',
    GAME_ENDED: 'game_ended',
    RESTART_GAME: 'restart_game',
    
    // Action events
    VOTE_PLAYER: 'vote_player',
    MAFIA_KILL: 'mafia_kill',
    DOCTOR_HEAL: 'doctor_heal',
    DETECTIVE_CHECK: 'check_player',
    
    // Result events
    NIGHT_RESULT: 'night_result',
    INVESTIGATION_RESULT: 'investigation_result',
    PLAYER_ELIMINATED: 'player_eliminated',
    
    // Timer events
    TIMER_UPDATE: 'timer_update',
    TIMER_STARTED: 'timer_started',
    
    // Status events
    GET_GAME_STATUS: 'get_game_status',
    GAME_STATUS: 'game_status',
    ERROR: 'error'
  },

  // ===== GAME SETTINGS =====
  SETTINGS: {
    ALLOW_SPECTATORS: false,
    REVEAL_ROLES_ON_DEATH: true,
    ALLOW_DEAD_CHAT: false,
    AUTO_START_TIMER: true,
    SHOW_VOTE_COUNTS: true,
    ANONYMOUS_VOTING: false
  },

  // ===== ERROR MESSAGES =====
  ERROR_MESSAGES: {
    ROOM_NOT_FOUND: "Room not found",
    USER_NOT_FOUND: "User not found",
    NOT_ENOUGH_PLAYERS: "Need at least 3 players to start",
    GAME_ALREADY_STARTED: "Game already started",
    ONLY_HOST_CAN_START: "Only host can start the game",
    PLAYER_NOT_ALIVE: "You are not alive",
    WRONG_PHASE: "Action not allowed in this phase",
    ALREADY_VOTED: "You have already voted",
    INVALID_TARGET: "Invalid target",
    PERMISSION_DENIED: "Permission denied"
  },

  // ===== SUCCESS MESSAGES =====
  SUCCESS_MESSAGES: {
    ROOM_CREATED: "Room created successfully",
    JOINED_ROOM: "Joined room successfully",
    GAME_STARTED: "Game has started!",
    VOTE_CAST: "Vote cast successfully",
    ACTION_COMPLETED: "Action completed successfully"
  }
};

// ===== UTILITY FUNCTIONS =====
export const GameUtils = {
  // Get role distribution for given player count
  getRoleDistribution: (playerCount) => {
    if (playerCount < GAME_CONFIG.MIN_PLAYERS) {
      throw new Error(`Need at least ${GAME_CONFIG.MIN_PLAYERS} players`);
    }

    const mafiaCount = Math.max(1, Math.floor(playerCount * GAME_CONFIG.ROLES.MAFIA_RATIO));
    const doctorCount = GAME_CONFIG.ROLES.DOCTOR_COUNT;
    const detectiveCount = playerCount >= GAME_CONFIG.ROLES.MIN_PLAYERS_FOR_DETECTIVE ? 
      GAME_CONFIG.ROLES.DETECTIVE_COUNT : 0;
    const villagerCount = playerCount - mafiaCount - doctorCount - detectiveCount;

    return {
      mafia: mafiaCount,
      doctor: doctorCount,
      detective: detectiveCount,
      villager: villagerCount,
      total: playerCount
    };
  },

  // Check if player count is valid
  isValidPlayerCount: (count) => {
    return count >= GAME_CONFIG.MIN_PLAYERS && count <= GAME_CONFIG.MAX_PLAYERS;
  },

  // Get phase duration in seconds
  getPhaseDurationSeconds: (phase) => {
    return Math.floor((GAME_CONFIG.PHASE_DURATIONS[phase] || 0) / 1000);
  },

  // Check if phase allows voting
  isVotingPhase: (phase) => {
    return phase === GAME_CONFIG.PHASES.DAY || phase === GAME_CONFIG.PHASES.VOTING;
  },

  // Check if phase allows night actions
  isNightPhase: (phase) => {
    return phase === GAME_CONFIG.PHASES.NIGHT;
  },

  // Get role description
  getRoleDescription: (role) => {
    return GAME_CONFIG.ROLE_DESCRIPTIONS[role] || GAME_CONFIG.ROLE_DESCRIPTIONS.villager;
  },

  // Get role image
  getRoleImage: (role) => {
    return GAME_CONFIG.ROLE_IMAGES[role] || GAME_CONFIG.ROLE_IMAGES.villager;
  }
};

export default GAME_CONFIG;