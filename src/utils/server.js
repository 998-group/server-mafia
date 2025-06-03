import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import connectDB from '../config/db.js';
import app from './app.js';
import { socketHandler } from '../socket/gameSocket.js';

dotenv.config();

const PORT = process.env.PORT || 8000;

// 🛢 MongoDB connection
connectDB();

// 🌐 HTTP + WebSocket server
const server = http.createServer(app);

// 🔌 Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:5174'], // yoki frontend manzili: "http://localhost:5173"
    methods: ['GET', 'POST'],
  },
});

// 🔁 Real-time socket handler
socketHandler(io);

// 🚀 Server run
server.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
