import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map(); // socket.id => { userId, roomId }

  // 🔁 Helper: Yangi xonalarni barcha foydalanuvchilarga yuborish
  const sendRooms = async () => {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    io.emit("update_rooms", rooms);
  };

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // Client yangi xonalarni so'rasa
    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    // Xonaga qo'shilish
    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        console.log("joined_game:", {userId , roomId} )
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;


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

        socket.join(roomId);
        socketUserMap.set(socket.id, { userId, roomId });
        io.to(roomId).emit("update_players", gameRoom.players);
        socket.emit("joined_room", gameRoom);
        await sendRooms();
        console.log(gameRoom)
        console.log(`✅ ${username} joined room ${roomId}`);
      } catch (err) {
        console.error("❌ join_room error:", err.message);
      }
    });

    // Foydalanuvchi tayyorligini bildiradi
    socket.on("ready", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId
        );
        if (!player) return;

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
        if (allReady) {
          io.to(roomId).emit("start_game");
        }
      } catch (e) {
        console.error("❌ ready error:", e.message);
      }
    });

    // Foydalanuvchi chiqadi
    socket.on("leave_room", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        socketUserMap.delete(socket.id);
        await sendRooms();

        console.log(`🚪 ${userId} left ${roomId}`);
      } catch (e) {
        console.error("❌ leave_room error:", e.message);
      }
    });

    // Foydalanuvchi ulanmagan holda chiqadi
    socket.on("disconnect", async () => {
      const session = socketUserMap.get(socket.id);
      if (!session) return;

      const { userId, roomId } = session;

      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        socketUserMap.delete(socket.id);
        await sendRooms();

        console.log(`❌ Disconnected: ${userId}`);
      } catch (err) {
        console.error("❌ disconnect error:", err.message);
      }
    });
  });
};
