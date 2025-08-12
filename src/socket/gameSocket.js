// src/socket/gameSocket.js - Refactored & Clean
import Game from "../models/Game.js";
import { GAME_CONFIG } from "../config/gameConfig.js";
import { TimerManager } from "./helpers/timerManager.js";
import { setupRoomEvents } from "./events/roomEvents.js";
import { setupGameEvents } from "./events/gameEvents.js";
import { setupMessageEvents } from "./events/messageEvents.js";

export const socketHandler = (io) => {
  // Initialize timer manager
  const timerManager = new TimerManager(io);

  console.log(`🎮 Game Socket Handler initialized`);
  console.log(`🧪 Test Mode: ${GAME_CONFIG.TEST_MODE ? 'ON' : 'OFF'}`);
  console.log(`👥 Min Players: ${GAME_CONFIG.MIN_PLAYERS}`);

  // ===== HELPER FUNCTIONS =====
  const sendRooms = async () => {
    try {
      const rooms = await Game.find({ players: { $not: { $size: 0 } } })
        .sort({ createdAt: -1 })
        .limit(100);
      io.emit("update_rooms", rooms);
    } catch (err) {
      console.error("❌ sendRooms error:", err.message);
    }
  };

  const handleDisconnect = async (socket) => {
    const { userId, roomId } = socket.data || {};
    console.log(`🔌 Disconnected: ${socket.id}, userId: ${userId}, roomId: ${roomId}`);
    
    if (!userId || !roomId) return;

    try {
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) return;

      const wasHost = gameRoom.hostId.toString() === userId.toString();

      gameRoom.players = gameRoom.players.filter(
        (p) => p.userId.toString() !== userId.toString()
      );

      if (gameRoom.players.length === 0) {
        // Delete empty room
        await Game.deleteOne({ roomId });
        io.to(roomId).emit("room_closed");
        timerManager.clearRoomTimer(roomId);
        console.log(`🗑️ Empty room ${roomId} deleted`);
      } else {
        // If host disconnected, assign new host
        if (wasHost && gameRoom.players.length > 0) {
          gameRoom.hostId = gameRoom.players[0].userId;
          io.to(roomId).emit("new_host", { 
            newHostId: gameRoom.hostId,
            newHostUsername: gameRoom.players[0].username 
          });
          console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
        }

        await gameRoom.save();
        io.to(roomId).emit("update_players", gameRoom.players);
      }

      socket.leave(roomId);
      await sendRooms();

      console.log(`🔌 User ${userId} disconnected from room ${roomId}`);
    } catch (err) {
      console.error("❌ disconnect error:", err.message);
    }
  };

  // ===== SOCKET CONNECTION HANDLER =====
  io.on("connection", (socket) => {
    console.log(`🔌 Connected: ${socket.id}`);
    socket.emit("your_socket_id", socket.id);

    // ===== SETUP EVENT HANDLERS =====
    setupRoomEvents(socket, io, timerManager, sendRooms);
    setupGameEvents(socket, io, timerManager);
    setupMessageEvents(socket, io);

    // ===== ROOM MANAGEMENT EVENTS =====
    socket.on("request_rooms", async () => {
      await sendRooms();
    });

    socket.on("get_room_info", async ({ roomId }) => {
      try {
        if (!roomId) {
          socket.emit("error", { message: "Missing roomId" });
          return;
        }

        const gameRoom = await Game.findOne({ roomId })
          .populate("players.userId", "username avatar")
          .populate("hostId", "username avatar");

        if (!gameRoom) {
          socket.emit("error", { message: "Room not found" });
          return;
        }

        socket.emit("room_info", gameRoom);
      } catch (err) {
        console.error("❌ get_room_info error:", err.message);
        socket.emit("error", { message: "Failed to get room info" });
      }
    });

    // ===== CONFIG EVENTS =====
    socket.on("get_game_config", () => {
      socket.emit("game_config", {
        TEST_MODE: GAME_CONFIG.TEST_MODE,
        MIN_PLAYERS: GAME_CONFIG.MIN_PLAYERS,
        MAX_PLAYERS: GAME_CONFIG.MAX_PLAYERS,
      });
    });

    // ===== DISCONNECT EVENT =====
    socket.on("disconnect", () => {
      handleDisconnect(socket);
    });

    // ===== ERROR HANDLING =====
    socket.on("error", (error) => {
      console.error("❌ Socket error:", error);
      socket.emit("error", { message: "Socket error occurred" });
    });
  });

  // ===== CLEANUP ON PROCESS EXIT =====
  process.on('SIGINT', () => {
    console.log('🛑 Cleaning up timers...');
    timerManager.clearAllTimers();
    process.exit(0);
  });

  console.log('🚀 Socket.IO game handler initialized');
};