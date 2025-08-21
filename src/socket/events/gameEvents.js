// src/socket/events/gameEvents.js
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
        isAlive: player.isAlive
      });

      console.log(`🎭 Sent role ${player.gameRole} to ${player.username}`);
    } catch (err) {
      console.error("❌ get_my_role error:", err.message);
      socket.emit("error", { message: "Failed to get role" });
    }
  });

  // ===== DOCTOR HEAL EVENT =====
  socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const doctor = gameRoom.players.find(p => p.userId.toString() === doctorId.toString());
      const target = gameRoom.players.find(p => p.userId.toString() === targetId.toString());

      if (!doctor || !target) {
        socket.emit("error", { message: "Invalid doctor or target" });
        return;
      }
      if (doctor.gameRole !== "doctor" || !doctor.isAlive) {
        socket.emit("error", { message: "Healer must be an alive doctor" });
        return;
      }
      if (!target.isAlive) {
        socket.emit("error", { message: "Target is already dead" });
        return;
      }
      if (gameRoom.hasDoctorHealed) {
        socket.emit("error", { message: "Doctor has already healed this night" });
        return;
      }

      // ❗ faqat flaglarni qo‘yamiz, hozircha hech kimni tiriltirmaymiz/o‘ldirmaymiz
      gameRoom.doctorTarget = targetId;
      gameRoom.hasDoctorHealed = true;
      target.isHealed = true;
      target.isAlive = true

      await gameRoom.save();

      // faqat doctor'ga tasdiq
      socket.emit("doctor_heal_confirmed", {
        targetId,
        targetUsername: target.username,
      });
      console.log("Heald", target)
      console.log(`🩺 Doctor healed (flag): ${target.username} (ID: ${targetId})`);
    } catch (err) {
      console.error("❌ doctor_heal error:", err.message);
      socket.emit("error", { message: "Failed to process heal" });
    }
  });

  // ===== MAFIA KILL EVENT =====
  socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      console.log("Game", gameRoom)
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const killer = gameRoom.players.find(p => p.userId.toString() === killerId.toString());
      const target = gameRoom.players.find(p => p.userId.toString() === targetId.toString());

      if (!killer || !target) {
        socket.emit("error", { message: "Invalid killer or target" });
        return;
      }

      if (killer.gameRole !== "mafia" || !killer.isAlive) {
        socket.emit("error", { message: "Killer must be an alive mafia" });
        return;
      }

      if (!target.isAlive) {
        socket.emit("error", { message: "Target is already dead" });
        return;
      }

      if (gameRoom.hasMafiaKilled) {
        socket.emit("error", { message: "Mafia has already killed this night" });
        return;
      }

      // 🔹 faqat targetni saqlaymiz
      gameRoom.mafiaTarget = targetId;
      target.isAlive = false
      gameRoom.hasMafiaKilled = true;
      await gameRoom.save();

      // faqat mafiya o‘zlariga xabar
      const mafiaPlayers = gameRoom.players.filter(p => p.gameRole === "mafia" && p.isAlive);
      mafiaPlayers.forEach(mafiaPlayer => {
        io.to(mafiaPlayer.socketId).emit("mafia_kill_confirmed", {
          targetId,
          targetUsername: target.username,
        });
      });
      console.log("KIlled", target)
      console.log(`💀 Mafia selected target (night): ${target.username} (ID: ${targetId})`);
    } catch (err) {
      console.error("❌ mafia_kill error:", err.message);
      socket.emit("error", { message: "Failed to process kill" });
    }
  });





  // ===== DETECTIVE CHECK EVENT =====
  socket.on("check_player", async ({ roomId, checkerId, targetUserId }) => {
    try {
      if (!roomId || !checkerId || !targetUserId) {
        socket.emit("error", { message: "Missing roomId, checkerId, or targetUserId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const checker = gameRoom.players.find(
        (p) => p.userId.toString() === checkerId.toString()
      );
      if (!checker || checker.gameRole !== "detective" || !checker.isAlive) {
        socket.emit("error", { message: "Checker must be an alive detective" });
        return;
      }

      if (gameRoom.hasDetectiveChecked) {
        socket.emit("error", { message: "Detective has already checked this night" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId.toString()
      );
      console.log("target", target)
      if (!target || !target.isAlive) {
        socket.emit("error", { message: "Target must be alive" });
        return;
      }

      if (checkerId === targetUserId) {
        socket.emit("error", { message: "Cannot check yourself" });
        return;
      }

      gameRoom.hasDetectiveChecked = true;
      await gameRoom.save();

      socket.emit("check_result", {
        targetUserId,
        targetUsername: target.username,
        role: target.gameRole === "mafia" ? "mafia" : "innocent",
      });

      console.log(`🔍 Detective ${checker.username} checked ${target.username}`);
    } catch (err) {
      console.error("❌ check_player error:", err.message);
      socket.emit("error", { message: "Failed to check player" });
    }
  });

  // ===== VOTE PLAYER EVENT =====
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
        (p) => p.userId.toString() === voterId.toString()
      );
      if (!voter || !voter.isAlive) {
        socket.emit("error", { message: "Voter must be alive" });
        return;
      }

      if (voter.hasVoted) {
        socket.emit("error", { message: "You have already voted" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId.toString()
      );
      if (!target || !target.isAlive) {
        socket.emit("error", { message: "Target must be alive" });
        return;
      }

      if (voterId === targetUserId) {
        socket.emit("error", { message: "Cannot vote for yourself" });
        return;
      }

      target.votes = (target.votes || 0) + 1;
      voter.hasVoted = true;
      await gameRoom.save();

      io.to(roomId).emit("player_voted", {
        voterId,
        voterUsername: voter.username,
        targetUserId,
        targetUsername: target.username,
        votes: target.votes,
      });

      console.log(`✅ Player ${voter.username} voted for ${target.username}`);
    } catch (err) {
      console.error("❌ vote_player error:", err.message);
      socket.emit("error", { message: "Failed to process vote" });
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

      const timeLeft = timerManager.getTimeLeftForRoom(roomId);
      socket.emit("game_status", {
        timeLeft: timeLeft !== null ? Math.floor(timeLeft) : null,
        phase: gameRoom.phase,
        winner: gameRoom.winner,
        currentTurn: gameRoom.currentTurn,
        players: gameRoom.players,
        hostId: gameRoom.hostId,
      });

      console.log(
        `🔎 get_game_status: Room ${roomId} | Phase: ${gameRoom.phase} | TimeLeft: ${timeLeft !== null ? Math.floor(timeLeft) : "N/A"
        }s`
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
        "players.userId": userId
      });

      if (!gameRoom) {
        socket.emit("error", { message: "User not in any game" });
        return;
      }

      socket.emit("game_players", {
        players: gameRoom.players,
        phase: gameRoom.phase,
        roomId: gameRoom.roomId,
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
    timerManager.startRoomTimer(roomId, duration);
  });

  // ===== VOICE/CHAT EVENTS =====
  socket.on("add_voice", async ({ roomId, selected, user }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      console.log(`🗣️ User ${user} added voice for ${selected} in room ${roomId}`);

      await gameRoom.save();
      io.to(roomId).emit("update_players", gameRoom.players);
    } catch (err) {
      console.error("❌ add_voice error:", err.message);
      socket.emit("error", { message: "Failed to add voice" });
    }
  });

  socket.on("remove_voice", async ({ roomId, userId, user }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      console.log(`🔇 User ${user} removed voice from ${userId} in room ${roomId}`);

      await gameRoom.save();
      io.to(roomId).emit("update_players", gameRoom.players);
    } catch (err) {
      console.error("❌ remove_voice error:", err.message);
      socket.emit("error", { message: "Failed to remove voice" });
    }
  });
};