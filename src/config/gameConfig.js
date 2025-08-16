// src/config/gameConfig.js - Yangi fayl yaratish
export const GAME_CONFIG = {
  // ✅ Test mode flag
  TEST_MODE:
    process.env.NODE_ENV === "development" || process.env.TEST_MODE === "true",

  // ✅ Dynamic minimum players based on mode
  MIN_PLAYERS:
    process.env.NODE_ENV === "development" || process.env.TEST_MODE === "true"
      ? 2
      : 3,

  // Other game settings
  MAX_PLAYERS: 10,
  PHASE_DURATIONS: {
    night: 15, // 3 minutes
    day: 15, // 3 minutes
    ended: 10, // 10 seconds
    waiting: null,
  },
};

// Role distribution based on player count
export const getRoleDistribution = (playerCount, testMode = false) => {
  const minPlayers = testMode ? 2 : 3;

  return {
    mafia: (count) => {
      if (testMode && count === 2) return 1; // Test: 2 players = 1 mafia, 1 villager
      return Math.max(1, Math.floor(count / 4));
    },
    doctor: (count) => {
      if (testMode && count === 2) return 0; // Test: no doctor for 2 players
      return count >= minPlayers ? 1 : 0;
    },
    detective: (count) => {
      if (testMode && count === 2) return 0; // Test: no detective for 2 players
      return count >= 6 ? 1 : 0;
    },
  };
};
