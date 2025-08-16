import Game from "../models/Game.js";

export function handleRoleEvents(io, socket) {
  socket.on("mafia_kill", async ({ roomId, killerId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const killer = gameRoom.players.find(
        (p) => p.userId.toString() === killerId
      );
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId
      );

      if (!killer || !target) {
        socket.emit("error", { message: "Invalid killer or target" });
        return;
      }

      if (killer.gameRole !== "mafia" || !killer.isAlive) {
        socket.emit("error", { message: "Killer must be an alive mafia" });
        return;
      }

      if (gameRoom.hasMafiaKilled) {
        socket.emit("error", { message: "Mafia has already killed this night" });
        return;
      }

      if (target.isHealed) {
        target.isHealed = false;
      } else {
        target.isAlive = false;
      }

      gameRoom.hasMafiaKilled = true;
      await gameRoom.save();

      io.to(roomId).emit("player_killed", {
        killerId,
        targetId,
        targetUsername: target.username,
      });

      console.log(`💀 Mafia killed: ${target.username} (ID: ${targetId})`);
    } catch (err) {
      console.error("❌ mafia_kill error:", err.message);
      socket.emit("error", { message: "Failed to process kill" });
    }
  });

  socket.on("doctor_heal", async ({ roomId, doctorId, targetId }) => {
    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom || gameRoom.phase !== "night") {
        socket.emit("error", { message: "Invalid game or not night phase" });
        return;
      }

      const doctor = gameRoom.players.find(
        (p) => p.userId.toString() === doctorId
      );
      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetId
      );

      if (!doctor || !target) {
        socket.emit("error", { message: "Invalid doctor or target" });
        return;
      }

      if (doctor.gameRole !== "doctor" || !doctor.isAlive) {
        socket.emit("error", { message: "Doctor must be alive" });
        return;
      }

      if (gameRoom.hasDoctorHealed) {
        socket.emit("error", { message: "Doctor has already healed this night" });
        return;
      }

      target.isHealed = true;
      gameRoom.hasDoctorHealed = true;
      await gameRoom.save();

      io.to(roomId).emit("doctor_healed", {
        doctorId,
        targetId,
        message: "👨‍⚕️ Doctor healed someone!",
      });

      console.log(`Doctor (${doctor.username}) healed ${target.username}`);
    } catch (err) {
      console.error("❌ doctor_heal error:", err.message);
      socket.emit("error", { message: "Failed to process heal" });
    }
  });

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
        (p) => p.userId.toString() === checkerId
      );
      if (!checker || checker.gameRole !== "detective") {
        socket.emit("error", { message: "Checker must be a detective" });
        return;
      }

      const target = gameRoom.players.find(
        (p) => p.userId.toString() === targetUserId
      );
      if (!target) {
        socket.emit("error", { message: "Target not found" });
        return;
      }

      socket.emit("check_result", {
        targetUserId,
        role: target.gameRole,
      });

      console.log(`✅ Detective ${checkerId} checked ${targetUserId}`);
    } catch (err) {
      console.error("❌ check_player error:", err.message);
      socket.emit("error", { message: "Failed to check player" });
    }
  });
}