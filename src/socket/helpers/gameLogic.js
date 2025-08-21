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

export const checkWinCondition = (gameRoom) => {
  const alivePlayers = gameRoom.players.filter(p => p.isAlive);
  const aliveMafia = alivePlayers.filter(p => p.gameRole === "mafia");
  const aliveInnocents = alivePlayers.filter(p => p.gameRole !== "mafia");

  if (aliveMafia.length === 0) {
    return "innocent";
  } else if (aliveMafia.length >= aliveInnocents.length) {
    return "mafia";
  }
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


export const processNightActions = (gameRoom, io, roomId) => {
  // 1) MafiaVotes -> count by target
  const votes = gameRoom.mafiaVotes || [];
  if (!votes.length) {
    // Hech kimga ovoz berilmagan -> hech kim o‘lmaydi
    io.to(roomId).emit("night_result", { message: "Tunda hech kim o'ldirilmadi." });
    return;
  }

  const countMap = new Map(); // targetId -> count
  for (const v of votes) {
    const key = v.target.toString();
    countMap.set(key, (countMap.get(key) || 0) + 1);
  }

  // 2) Eng ko‘p ovoz olgan (max count) target(lar)ni topamiz
  let max = 0;
  let leaders = [];
  for (const [tId, cnt] of countMap.entries()) {
    if (cnt > max) {
      max = cnt;
      leaders = [tId];
    } else if (cnt === max) {
      leaders.push(tId);
    }
  }

  // 3) Tenglik bo‘lsa random
  const chosenTargetId = leaders.length === 1
    ? leaders[0]
    : leaders[Math.floor(Math.random() * leaders.length)];

  // UI/retro-compat uchun saqlab qo'yish (ixtiyoriy)
  gameRoom.mafiaTarget = chosenTargetId;

  // 4) Doctor ustunlik: agar doctor ham shu chosenTargetId ni tanlagan bo‘lsa — saqlanadi
  if (gameRoom.doctorTarget && gameRoom.doctorTarget.toString() === chosenTargetId.toString()) {
    // Saqlab qolish e'loni (ertalab)
    io.to(roomId).emit("player_saved", {
      targetId: chosenTargetId,
      message: "Doktor kimnidir qutqarib qoldi!",
    });
    return; // hech kim o‘lmaydi
  }

  // 5) Targetni haqiqatan o‘ldiramiz (model ichida isAlive = false)
  const targetPlayer = gameRoom.players.find(p => p.userId.toString() === chosenTargetId.toString());
  if (targetPlayer && targetPlayer.isAlive) {
    targetPlayer.isAlive = false;
    io.to(roomId).emit("player_killed", {
      targetId: chosenTargetId,
      targetUsername: targetPlayer.username,
    });
  } else {
    io.to(roomId).emit("night_result", { message: "Tunda hech kim o'ldirilmadi." });
  }
};

export const processDayVoting = (gameRoom, io, roomId) => {
  const maxVotes = Math.max(...gameRoom.players.map(p => p.votes || 0));
  if (maxVotes > 0) {
    const playersWithMaxVotes = gameRoom.players.filter(p => (p.votes || 0) === maxVotes);
    if (playersWithMaxVotes.length === 1) {
      // Lynch the player with most votes
      playersWithMaxVotes[0].isAlive = false;
      io.to(roomId).emit("player_lynched", {
        targetId: playersWithMaxVotes[0].userId.toString(),
        targetUsername: playersWithMaxVotes[0].username,
        votes: maxVotes
      });
      return true; // Someone was lynched
    }
  }
  return false; // No one was lynched
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