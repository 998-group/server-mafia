import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map(); // socket.id => { userId, roomId }

  // 🔁 Helper: Yangi xonalarni yuborish
  const sendRooms = async () => {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    console.log("rooms: ", rooms.length);
    io.emit("update_rooms", rooms);
  };

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
          await sendRooms();
        }
        await sendRooms();

        socket.join(roomId);
        socketUserMap.set(socket.id, { userId, roomId });

        io.to(roomId).emit("update_players", gameRoom.players);
        socket.emit("joined_room", gameRoom);
        console.log(`✅ ${username} (${userId}) joined ${roomId}`);
      } catch (err) {
        console.error("❌ join_room error:", err.message);
      }
    });

    socket.on("ready", async ({ roomId, userId }) => {
      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) {
          socket.emit("notification", {
            type: "error",
            message: "Room not found",
          });
          return;
        }

        const player = gameRoom.players.find(
          (p) => p.userId.toString() === userId
        );
        if (!player) {
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

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");
          console.log(`🗑 Room ${roomId} deleted because it's empty`);
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        await sendRooms();

        socket.leave(roomId);
        console.log(`🚪 ${userId} left ${roomId}`);
      } catch (e) {
        console.error("❌ leave_room error:", e.message);
      }
    });

    socket.on("disconnect", async () => {
      const session = socketUserMap.get(socket.id);
      if (!session) return;

      const { userId } = session;

      try {
        const games = await Game.find({ "players.userId": userId });

        for (const gameRoom of games) {
          gameRoom.players = gameRoom.players.filter(
            (p) => p.userId.toString() !== userId
          );

          if (gameRoom.players.length === 0) {
            await Game.deleteOne({ _id: gameRoom._id });
            io.to(gameRoom.roomId).emit("room_closed");
            console.log(
              `🗑 Room ${gameRoom.roomId} deleted because it's empty (disconnect)`
            );
          } else {
            await gameRoom.save();
            io.to(gameRoom.roomId).emit("update_players", gameRoom.players);
          }

          socket.leave(gameRoom.roomId);
        }

        await sendRooms();

        socketUserMap.delete(socket.id);
        console.log(`❌ Disconnected: ${userId}, removed from all rooms`);
      } catch (err) {
        console.error("❌ disconnect error:", err.message);
      }
    });
  });
};
