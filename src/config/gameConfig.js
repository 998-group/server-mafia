// src/config/gameConfig.js - Game Configuration

export const GAME_CONFIG = {
  // ===== PLAYER LIMITS =====
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 10,

  // ===== PHASE DURATIONS (in milliseconds) =====
  PHASE_DURATIONS: {
    night: 60000,    // 1 minute
    day: 120000,     // 2 minutes  
    voting: 60000,   // 1 minute
    discussion: 90000 // 1.5 minutes
  },

  // ===== GAME MODES =====
  TEST_MODE: process.env.NODE_ENV !== 'production', // Shorter timers for testing
  
  // ===== ROLE CONFIGURATION =====
  ROLES: {
    VILLAGER: 'villager',
    MAFIA: 'mafia',
    DOCTOR: 'doctor',
    DETECTIVE: 'detective'
  },

  // ===== ROLE DISTRIBUTION RULES =====
  ROLE_DISTRIBUTION: {
    3: { mafia: 1, doctor: 1, detective: 0, villager: 1 },
    4: { mafia: 1, doctor: 1, detective: 0, villager: 2 },
    5: { mafia: 1, doctor: 1, detective: 1, villager: 2 },
    6: { mafia: 1, doctor: 1, detective: 1, villager: 3 },
    7: { mafia: 2, doctor: 1, detective: 1, villager: 3 },
    8: { mafia: 2, doctor: 1, detective: 1, villager: 4 },
    9: { mafia: 2, doctor: 1, detective: 1, villager: 5 },
    10: { mafia: 3, doctor: 1, detective: 1, villager: 5 }
  },

  // ===== VOTING RULES =====
  VOTING: {
    REQUIRE_MAJORITY: false,           // Simple plurality wins
    ALLOW_TIE_ELIMINATION: false,      // Ties result in no elimination
    ALLOW_SELF_VOTE: false,           // Players cannot vote for themselves
    SHOW_VOTE_COUNT: true,            // Show live vote counts
    ANONYMOUS_VOTING: false           // Show who voted for whom
  },

  // ===== NIGHT ACTION RULES =====
  NIGHT_ACTIONS: {
    MAFIA_MUST_KILL: false,           // Mafia can choose not to kill
    DOCTOR_SELF_HEAL: true,           // Doctor can heal themselves
    DETECTIVE_MULTIPLE_CHECKS: false, // Detective can only check one per night
    SIMULTANEOUS_ACTIONS: true       // All night actions happen simultaneously
  },

  // ===== GAME FLOW =====
  GAME_FLOW: {
    START_WITH_NIGHT: true,           // Game starts with night phase
    REVEAL_ROLES_ON_DEATH: true,      // Show role when player dies
    LAST_WORDS: false,                // Allow final statement before elimination
    DISCUSSION_BEFORE_VOTING: true   // Allow discussion phase before voting
  },

  // ===== WIN CONDITIONS =====
  WIN_CONDITIONS: {
    MAFIA_WIN_ON_EQUAL: true,         // Mafia wins when equal to villagers
    REVEAL_ALL_ROLES_ON_WIN: true,    // Show all roles when game ends
    ALLOW_DRAWS: false                // No draw conditions
  },

  // ===== ROOM SETTINGS =====
  ROOM: {
    AUTO_START_WHEN_READY: true,      // Start when all players ready
    KICK_INACTIVE_PLAYERS: false,     // Don't kick inactive players
    REJOIN_AFTER_DISCONNECT: true,    // Allow rejoining after disconnect
    SPECTATOR_MODE: false,            // No spectators allowed
    ROOM_EXPIRY_HOURS: 24            // Rooms expire after 24 hours
  },

  // ===== CHAT SETTINGS =====
  CHAT: {
    ALLOW_GLOBAL_CHAT: true,          // Global chat enabled
    ALLOW_ROOM_CHAT: true,            // Room chat enabled
    DEAD_PLAYERS_CHAT: false,         // Dead players cannot chat
    NIGHT_CHAT_DISABLED: true,       // No chat during night (except mafia)
    MAFIA_NIGHT_CHAT: true,          // Mafia can chat at night
    MAX_MESSAGE_LENGTH: 500          // Max characters per message
  },

  // ===== SECURITY SETTINGS =====
  SECURITY: {
    RATE_LIMIT_ACTIONS: true,         // Rate limit player actions
    VALIDATE_ALL_ACTIONS: true,       // Validate all game actions
    LOG_SUSPICIOUS_ACTIVITY: true,    // Log potential cheating
    PREVENT_ROLE_REVEALING: true     // Prevent players from revealing roles
  },

  // ===== DEBUGGING =====
  DEBUG: {
    LOG_ALL_ACTIONS: process.env.NODE_ENV !== 'production',
    VERBOSE_LOGGING: process.env.NODE_ENV !== 'production',
    EXPOSE_GAME_STATE: process.env.NODE_ENV !== 'production'
  }
};

// ===== ENVIRONMENT-SPECIFIC OVERRIDES =====
if (GAME_CONFIG.TEST_MODE) {
  // Shorter timers for testing
  GAME_CONFIG.PHASE_DURATIONS = {
    night: 10000,     // 10 seconds
    day: 15000,       // 15 seconds
    voting: 10000,    // 10 seconds
    discussion: 10000 // 10 seconds
  };
  
  console.log('🧪 Game running in TEST MODE with shorter timers');
}

// ===== VALIDATION FUNCTIONS =====
export const validateConfig = () => {
  const errors = [];

  // Validate player limits
  if (GAME_CONFIG.MIN_PLAYERS < 3) {
    errors.push('MIN_PLAYERS must be at least 3');
  }
  
  if (GAME_CONFIG.MAX_PLAYERS > 20) {
    errors.push('MAX_PLAYERS should not exceed 20');
  }
  
  if (GAME_CONFIG.MIN_PLAYERS >= GAME_CONFIG.MAX_PLAYERS) {
    errors.push('MIN_PLAYERS must be less than MAX_PLAYERS');
  }

  // Validate phase durations
  Object.entries(GAME_CONFIG.PHASE_DURATIONS).forEach(([phase, duration]) => {
    if (duration < 5000) {
      errors.push(`${phase} duration too short (minimum 5 seconds)`);
    }
    if (duration > 600000) {
      errors.push(`${phase} duration too long (maximum 10 minutes)`);
    }
  });

  // Validate role distributions
  Object.entries(GAME_CONFIG.ROLE_DISTRIBUTION).forEach(([playerCount, roles]) => {
    const total = Object.values(roles).reduce((sum, count) => sum + count, 0);
    if (total !== parseInt(playerCount)) {
      errors.push(`Role distribution for ${playerCount} players doesn't add up`);
    }
  });

  if (errors.length > 0) {
    console.error('❌ Game configuration errors:', errors);
    throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
  }

  console.log('✅ Game configuration validated successfully');
  return true;
};

// ===== HELPER FUNCTIONS =====
export const getPhaseTimeout = (phase) => {
  return GAME_CONFIG.PHASE_DURATIONS[phase] || GAME_CONFIG.PHASE_DURATIONS.day;
};

export const getRoleDistribution = (playerCount) => {
  return GAME_CONFIG.ROLE_DISTRIBUTION[playerCount] || null;
};

export const isTestMode = () => {
  return GAME_CONFIG.TEST_MODE;
};

export const getMaxPlayers = () => {
  return GAME_CONFIG.MAX_PLAYERS;
};

export const getMinPlayers = () => {
  return GAME_CONFIG.MIN_PLAYERS;
};

// ===== VALIDATE ON IMPORT =====
try {
  validateConfig();
} catch (err) {
  console.error('❌ Failed to load game configuration:', err.message);
  process.exit(1);
}

export default GAME_CONFIG;