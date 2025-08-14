import Game from "../models/Game.js";

import {
  handleRoomEvents,
  handleGameEvents,
  handleChatEvents,
  handleRoleEvents
} from "./index.js";

export const socketHandler = (io) => {
  const roomTimers = {};

  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);
    socket.emit("your_socket_id", socket.id);

    // Инициализация обработчиков
    handleRoomEvents(io, socket, roomTimers);
    handleGameEvents(io, socket, roomTimers);
    handleChatEvents(io, socket);
    handleRoleEvents(io, socket);

    socket.on("disconnect", async () => {
      const { userId, roomId } = socket.data || {};
      if (!userId || !roomId) return;

      try {
        const gameRoom = await Game.findOne({ roomId });
        if (!gameRoom) return;

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId });
          io.to(roomId).emit("room_closed");

          if (roomTimers[roomId]) {
            clearInterval(roomTimers[roomId].interval);
            delete roomTimers[roomId];
          }
        } else {
          await gameRoom.save();
          io.to(roomId).emit("update_players", gameRoom.players);
        }

        socket.leave(roomId);
        await sendRooms(io);

        console.log(`🔌 User ${userId} disconnected from room ${roomId}`);
      } catch (err) {
        console.error("❌ disconnect error:", err.message);
      }
    });
  });
};

async function sendRooms(io) {
  try {
    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    io.emit("update_rooms", rooms);
  } catch (err) {
    console.error("❌ sendRooms error:", err.message);
  }
}
