import Game from "../models/Game.js";

export function handleGameEvents(io, socket, roomTimers) {
  socket.on("ready", async ({ roomId, userId }) => {
    try {
      if (!roomId || !userId) {
        socket.emit("error", { message: "Missing roomId or userId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const player = gameRoom.players.find(
        (p) => p.userId.toString() === userId
      );
      if (!player) {
        socket.emit("error", { message: "Player not found" });
        return;
      }

      player.isReady = !player.isReady;
      await gameRoom.save();

      socket.emit("notification", {
        type: "success",
        message: player.isReady ? "You are ready" : "You are not ready",
      });

      io.to(roomId).emit("update_players", gameRoom.players);

      const allReady =
        gameRoom.players.length >= 2 &&
        gameRoom.players.every((p) => p.isReady);

      if (allReady && gameRoom.phase === "waiting") {
        const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
        const roles = generateRoles(shuffled.length);
        shuffled.forEach((player, i) => {
          player.gameRole = roles[i];
          player.isAlive = true;
          player.isHealed = false;
          player.votes = 0;
        });

        gameRoom.phase = "started";
        gameRoom.hasMafiaKilled = false;
        gameRoom.hasDoctorHealed = false;
        await gameRoom.save();

        io.to(roomId).emit("start_game");
        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("game_phase", gameRoom);

        startRoomTimer(io, roomId, roomTimers, PHASE_DURATIONS.night);
      }
    } catch (err) {
      console.error("❌ ready error:", err.message);
      socket.emit("error", { message: "Failed to toggle ready status" });
    }
  });

  socket.on("get_players", async (roomId) => {
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

      socket.emit("update_players", gameRoom.players);
      socket.emit("game_phase", gameRoom);

      const timeLeft = getTimeLeftForRoom(roomTimers, roomId);
      if (timeLeft !== null) {
        socket.emit("timer_update", { timeLeft });
      }
    } catch (err) {
      console.error("❌ get_players error:", err.message);
      socket.emit("error", { message: "Failed to get players" });
    }
  });

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
        (p) => p.userId.toString() === voterId
      );
      if (!voter || !voter.isAlive) {
        socket.emit("error", { message: "Voter must be alive" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId
      );
      if (!target || !target.isAlive) {
        socket.emit("error", { message: "Target must be alive" });
        return;
      }

      target.votes = (target.votes || 0) + 1;
      await gameRoom.save();

      io.to(roomId).emit("player_voted", {
        targetUserId,
        votes: target.votes,
      });

      console.log(`✅ Player ${voterId} voted for ${targetUserId}`);
    } catch (err) {
      console.error("❌ vote_player error:", err.message);
      socket.emit("error", { message: "Failed to process vote" });
    }
  });
}

// Константы и вспомогательные функции
const PHASE_DURATIONS = {
  night: 180, // 3 minutes
  day: 180, // 3 minutes
  ended: 10, // 10 seconds
  waiting: null, // No timer for waiting phase
};

const ROLE_DISTRIBUTION = {
  mafia: (playerCount) => Math.max(1, Math.floor(playerCount / 4)),
  doctor: (playerCount) => (playerCount >= 3 ? 1 : 0),
  detective: (playerCount) => (playerCount >= 6 ? 1 : 0),
};

function generateRoles(playerCount) {
  const roles = [];
  const mafiaCount = ROLE_DISTRIBUTION.mafia(playerCount);
  const doctorCount = ROLE_DISTRIBUTION.doctor(playerCount);
  const detectiveCount = ROLE_DISTRIBUTION.detective(playerCount);

  for (let i = 0; i < mafiaCount; i++) roles.push("mafia");
  if (doctorCount) roles.push("doctor");
  if (detectiveCount) roles.push("detective");
  while (roles.length < playerCount) roles.push("peaceful");

  return roles.sort(() => Math.random() - 0.5);
}

function startRoomTimer(io, roomId, roomTimers, durationInSeconds) {
  if (!durationInSeconds) return;

  console.log(`⏱️ Timer started for ${roomId} for ${durationInSeconds} seconds`);

  if (roomTimers[roomId]?.interval) {
    clearInterval(roomTimers[roomId].interval);
  }

  roomTimers[roomId] = {
    timeLeft: durationInSeconds,
    interval: null,
  };

  roomTimers[roomId].interval = setInterval(async () => {
    const timer = roomTimers[roomId];
    if (!timer) return;

    if (timer.timeLeft <= 0) {
      clearInterval(timer.interval);
      delete roomTimers[roomId];

      io.to(roomId).emit("timer_end");

      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        let nextPhase = null;
        switch (gameRoom.phase) {
          case "started":
            nextPhase = "night";
            break;
          case "night":
            nextPhase = "day";
          case "night":
            nextPhase = "day";

            if (gameRoom.mafiaTarget) {
              const target = gameRoom.players.find(
                (p) => p.userId.toString() === gameRoom.mafiaTarget.toString()
              );

              if (target && target.isAlive) {
                if (target.isHealed) {
                  // ✅ Doctor davolagan odam o‘lmaydi
                  console.log(`🛡️ ${target.username} doctor tomonidan qutqarildi!`);
                  io.to(roomId).emit("player_saved", {
                    userId: target.userId,
                    username: target.username,
                  });
                } else {
                  // ❌ Doctor davolamagan bo‘lsa o‘ladi
                  target.isAlive = false;
                  console.log(`☀️ Day phase: ${target.username} ertalab o‘lik topildi (mafia)`);

                  io.to(roomId).emit("player_killed", {
                    userId: target.userId,
                    username: target.username,
                  });
                }
              }

              // ✅ Reset qilish
              gameRoom.mafiaTarget = null;
              gameRoom.hasMafiaKilled = false;
            }

            // Doctor & Detective flaglarni reset
            gameRoom.players.forEach(p => p.isHealed = false);
            gameRoom.hasDoctorHealed = false;
            gameRoom.hasDetectiveChecked = false;
            break;
          case "day":
            nextPhase = "ended";
            gameRoom.endedAt = new Date();
            break;
          case "ended":
            nextPhase = "waiting";
            gameRoom.winner = null;
            gameRoom.currentTurn = 0;
            gameRoom.players.forEach((p) => {
              p.isReady = false;
              p.isAlive = true;
              p.gameRole = null;
              p.votes = 0;
              p.isHealed = false;
            });
            break;
          default:
            console.warn(`⚠️ Unknown phase: ${gameRoom.phase}`);
            return;
        }

        gameRoom.phase = nextPhase;
        await gameRoom.save();

        io.to(roomId).emit("game_phase", gameRoom);
        io.to(roomId).emit("update_players", gameRoom.players);

        if (PHASE_DURATIONS[nextPhase]) {
          startRoomTimer(io, roomId, roomTimers, PHASE_DURATIONS[nextPhase]);
        }

        console.log(`✅ Phase changed to ${nextPhase} for room ${roomId}`);
      } catch (err) {
        console.error("❌ Timer phase switch error:", err.message);
        io.to(roomId).emit("error", { message: "Timer phase switch failed" });
      }

      return;
    }

    io.to(roomId).emit("timer_update", { timeLeft: timer.timeLeft });
    timer.timeLeft--;
  }, 1000);
}

function getTimeLeftForRoom(roomTimers, roomId) {
  return roomTimers[roomId]?.timeLeft ?? null;
}