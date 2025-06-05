const rooms = {}; // roomId: { players: [], phase: 'waiting' | 'night' | 'day' }
// const Game = require('../models/Game.js');
import Game from "../models/Game.js";

export const socketHandler = (io) => {
  io.on("connection", (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);

    socket.on("join_room", async ({ roomId, userId }) => {
      try {
        socket.join(roomId);
        const gameRoom = await Game.findOne({ roomId });

        if (!gameRoom) {
          console.log("Room not found");
          return;
        }

        // Emit player joined
        io.to(roomId).emit("player_joined", { userId });
        console.log(`✅ Player ${userId} joined room ${roomId}`);
      } catch (err) {
        console.error("Error joining room:", err);
      }
    });
  });
};
