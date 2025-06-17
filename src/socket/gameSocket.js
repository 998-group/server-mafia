import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map(); // socket.id => { userId, roomId }

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        if (!roomId || !userId) {
          console.log("❌ join_room: Missing roomId or userId");
          return;
        }

        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          console.log("❌ Room not found:", roomId);
          return;
        }

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );
        if (!alreadyInRoom) {
          gameRoom.players.push({
            userId,
            username: username || `User${userId.slice(-4)}`,
            isAlive: true,
            isReady: false,
          });
          await gameRoom.save();
        }

        const antiDuplicate = gameRoom.players.every(
          (user) => user._id === userId
        );

        if (!antiDuplicate) {
          socket.join(roomId);
          socketUserMap.set(socket.id, { userId, roomId });
          io.to(roomId).emit("update_players", gameRoom.players);
          socket.emit("joined_room", gameRoom);
          console.log(`✅ ${username} (${userId}) joined ${roomId}`);
        }
      } catch (err) {
        console.error("❌ join_room error:", err.message);
      }
    });

    socket.on("ready", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          console.log("❌ Room not found:", roomId);
          socket.emit("notification", {
            type: "error",
            message: "Room not found",
          });
          return;
        }

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId
        );
        console.log("👤 Ready:", player);
        if (!player) {
          console.log("❌ Player not found:", userId);
          socket.emit("notification", {
            type: "error",
            message: "Player not found",
          });
          return;
        }

        player.isReady = !player.isReady;
        await gameRoom.save();

        socket.emit("notification", {
          type: "success",
          message: "You are " + (player.isReady ? "ready" : "not ready"),
        });

        io.to(roomId).emit("update_players", gameRoom.players);

        if (gameRoom.players.every((p) => p.isReady)) {
          if (gameRoom.players.length >= 2) {
            io.to(roomId).emit("start_game");
          }
        }
      } catch (e) {
        console.error("❌ ready error:", e.message);
      }
    });

    socket.on("leave_room", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );
        await gameRoom.save();

        socket.leave(roomId);
        io.to(roomId).emit("update_players", gameRoom.players);
        console.log(`🚪 ${userId} left ${roomId}`);
      } catch (e) {
        console.error("❌ leave_room error:", e.message);
      }
    });

    socket.on("disconnect", async () => {
      const session = socketUserMap.get(socket.id);
      if (!session) return;

      const { userId, roomId } = session;
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) return;

      gameRoom.players = gameRoom.players.filter(
        (p) => p.userId.toString() !== userId
      );
      await gameRoom.save();

      socket.leave(roomId);
      io.to(roomId).emit("update_players", gameRoom.players);
      socketUserMap.delete(socket.id);

      console.log(`❌ Disconnected: ${userId} from ${roomId}`);
    });
  });
};
