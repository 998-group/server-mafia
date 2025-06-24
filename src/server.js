import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import app from './app.js';
import { socketHandler } from './socket/gameSocket.js';

// 🔐 Загружаем .env переменные
dotenv.config();

// 🛢 Подключаемся к базе данных
connectDB();

// 🌐 Создаем HTTP сервер
const server = http.createServer(app);

// 🔌 Настройка Socket.IO
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174'], // фронтенд
    methods: ['GET', 'POST'],
  },
});

// 🔄 Передаем `io` в обработчик
socketHandler(io);

// 🚀 Запускаем сервер
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});