import Game from "../models/Game.js";
import User from "../models/User.js";
import uniqId from "uniqid";

/**
 * Отправка списка комнат всем подключенным клиентам
 * @param {object} io - Экземпляр Socket.IO
 */
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

/**
 * Основной обработчик событий комнат
 * @param {object} io - Экземпляр Socket.IO
 * @param {object} socket - Экземпляр сокета
 * @param {object} roomTimers - Объект таймеров комнат
 */
export function handleRoomEvents(io, socket, roomTimers) {
  
  /**
   * Создание новой комнаты
   */
  socket.on("create_room", async (data) => {
    try {
      // Валидация входных данных
      if (!data.hostId || !data.roomName) {
        throw new Error("Missing hostId or roomName");
      }

      // Поиск пользователя в базе
      const owner = await User.findById(data.hostId);
      if (!owner) {
        throw new Error("User not found");
      }

      // Создание новой комнаты
      const newRoom = await Game.create({
        roomId: uniqId(),
        roomName: data.roomName,
        players: [{
          userId: owner._id,
          username: owner.username,
          isAlive: true,
          isReady: false,
          voice: []
        }],
        hostId: data.hostId,
        phase: "waiting"
      });

      // Сохранение данных в сокете
      socket.data = {
        userId: data.hostId,
        roomId: newRoom.roomId,
        username: owner.username
      };

      // Присоединение к комнате
      await socket.join(newRoom.roomId);

      // Отправка ответа создателю комнаты
      socket.emit("room_created", {
        roomId: newRoom.roomId,
        roomName: newRoom.roomName,
        players: newRoom.players,
        isHost: true
      });

      // Обновление списка игроков для всех в комнате
      io.to(newRoom.roomId).emit("players_updated", newRoom.players);

      // Обновление общего списка комнат
      await sendRooms(io);

      console.log(`✅ Room created: ${newRoom.roomId} by ${owner.username}`);

    } catch (err) {
      console.error("❌ create_room error:", err.message);
      socket.emit("error", { 
        message: "Failed to create room",
        details: err.message 
      });
    }
  });

  /**
   * Вход в существующую комнату
   */
  socket.on("join_room", async ({ roomId, userId, username }) => {
    try {
      // Валидация входных данных
      if (!roomId || !userId || !username) {
        throw new Error("Missing roomId, userId or username");
      }

      // Поиск комнаты
      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      // Проверка, что пользователь не в другой комнате
      const allRooms = await Game.find({ "players.userId": userId });
      const alreadyInOtherRoom = allRooms.some(r => r.roomId !== roomId);
      // if (alreadyInOtherRoom) {
      //   throw new Error("You are already in another room");
      // }

      // Добавление игрока, если его еще нет в комнате
      const playerExists = gameRoom.players.some(p => p.userId.toString() === userId);
      if (!playerExists) {
        gameRoom.players.push({
          userId,
          username,
          isAlive: true,
          isReady: false,
          voice: []
        });
        await gameRoom.save();
      }

      // Сохранение данных в сокете
      socket.data = {
        userId,
        roomId,
        username
      };

      // Присоединение к комнате
      await socket.join(roomId);

      // Отправка данных о комнате новому игроку
      socket.emit("room_joined", {
        roomId: gameRoom.roomId,
        roomName: gameRoom.roomName,
        players: gameRoom.players,
        isHost: gameRoom.hostId === userId,
        phase: gameRoom.phase
      });

      // Уведомление других игроков о новом участнике
      socket.to(roomId).emit("player_joined", {
        userId,
        username
      });

      // Обновление списка игроков
      io.to(roomId).emit("players_updated", gameRoom.players);

      // Обновление общего списка комнат
      await sendRooms(io);

      console.log(`✅ User ${username} joined room ${roomId}`);

    } catch (err) {
      console.error("❌ join_room error:", err.message);
      socket.emit("error", { 
        message: "Failed to join room",
        details: err.message 
      });
    }
  });

  /**
   * Выход из комнаты
   */
  socket.on("leave_room", async ({ roomId, userId }) => {
    try {
      // Валидация
      if (!roomId || !userId) {
        throw new Error("Missing roomId or userId");
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        throw new Error("Room not found");
      }

      // Удаление игрока из комнаты
      gameRoom.players = gameRoom.players.filter(p => p.userId.toString() !== userId);

      // Если комната пуста - удаляем ее
      if (gameRoom.players.length === 0) {
        await Game.deleteOne({ roomId });
        if (roomTimers[roomId]) {
          clearInterval(roomTimers[roomId].interval);
          delete roomTimers[roomId];
        }
        io.to(roomId).emit("room_closed");
      } else {
        // Если остались игроки - сохраняем изменения
        await gameRoom.save();
        io.to(roomId).emit("players_updated", gameRoom.players);
        io.to(roomId).emit("player_left", { userId });
      }

      // Выход из комнаты
      socket.leave(roomId);

      // Очистка данных сокета
      delete socket.data.roomId;

      // Обновление списка комнат
      await sendRooms(io);

      console.log(`✅ User ${userId} left room ${roomId}`);

    } catch (err) {
      console.error("❌ leave_room error:", err.message);
      socket.emit("error", { 
        message: "Failed to leave room",
        details: err.message 
      });
    }
  });

  /**
   * Запрос списка комнат
   */
  socket.on("request_rooms", async () => {
    try {
      await sendRooms(io);
    } catch (err) {
      console.error("❌ request_rooms error:", err.message);
      socket.emit("error", { 
        message: "Failed to get rooms list",
        details: err.message 
      });
    }
  });
}