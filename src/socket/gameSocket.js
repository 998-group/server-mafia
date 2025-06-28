import Game from "../models/Game.js";

export const socketHandler = (io) => {
  const socketUserMap = new Map();

  const sendRooms = async () => {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    io.emit("update_rooms", rooms);
  };

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);

    // 🔹 REQUEST ROOMS
    socket.on("request_rooms", async () => {
      console.log("📥 Event: request_rooms");
      await sendRooms();
    });

    // 🔹 SEND MESSAGE
    socket.on("send_message", ({ roomId, message }) => {
      console.log("📥 Event: send_message");
      console.log("📩 Message received:", message);
      console.log("📍 Room ID:", roomId);

      io.to(String(roomId)).emit("receive_message", message);
      console.log("📤 Message sent to room:", roomId);
    });

    // 🔹 JOIN TEST ROOM
    socket.on("join_test", async (roomId) => {
      console.log("📥 Event: join_test");
      try {
        console.log("🧪 join_test roomId:", roomId);
        await socket.join(String(roomId));
        console.log("✅ test room joined:", roomId);
        io.to(roomId).emit("test_message", "Welcome to test room!");
      } catch (err) {
        console.error("❌ join_test error:", err);
      }
    });

    // 🔹 JOIN GAME ROOM
    socket.on("join_room", async ({ roomId, userId, username }) => {
      try {
        console.log("joined_game:", { userId, roomId });
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        const alreadyInRoom = gameRoom.players.some(
          (p) => p.userId.toString() === userId
        );
    
        if (!alreadyInRoom) {
          gameRoom.players.push({
            userId,
            username,
            isAlive: true,
            isReady: false,
          });
          await gameRoom.save();
        }
    
        socket.join(roomId);
        socket.emit("joined_room", gameRoom);
        io.to(roomId).emit("update_players", gameRoom.players);
      } catch (e) {
        console.error("❌ join_room error:", e.message);
      }
    });
    // 🔹 PLAYER READY
    socket.on("ready", async ({ roomId, userId }) => {
      console.log("📥 Event: ready");
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
          console.log("START GAME")
          io.to(roomId).emit("game_players", gameRoom);
          console.log("Game_Players")

        }
      } catch (e) {
        console.error("❌ ready error:", e);
      }
    });

    // 🔹 LEAVE ROOM
    socket.on("leave_room", async ({ roomId, userId }) => {
      console.log("📥 Event: leave_room");
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
        console.error("❌ leave_room error:", e);
      }
    });

    // 🔹 DISCONNECT
    socket.on("disconnect", async () => {
      console.log("📥 Event: disconnect");
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
        console.error("❌ disconnect error:", err);
      }
    });

    socket.on("get_players", async (data) => {
      console.log("data", data)
      const gameRoom = await Game.findOne({ roomId: data });
      console.log("gameRoom:", gameRoom)
      socket.emit("update_players", gameRoom.players);
    })
  });
};
