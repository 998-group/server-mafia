// routes/gameRoutes.js
import express from "express";
import {
  createRoom,
  joinRoom,
  getRoomInfo,
  saveGameResult,
  getUserHistory,
  getAllGames,
} from "../controllers/gameController.js";

const router = express.Router();

// 🏠 Room yaratish
router.post("/create-room", createRoom);

// 👤 Roomga qo'shilish
router.post("/join-room/:roomId", joinRoom);

// ℹ️ Room haqida info olish
router.get("/room/:roomId", getRoomInfo);

// 🏁 O'yin natijasini saqlash
router.post("/save-result", saveGameResult);

// 📜 Foydalanuvchining o'yinlar tarixi
router.get("/history/:userId", getUserHistory);

// 🔍 Barcha o‘yinlar ro‘yxatini olish
router.get("/all", getAllGames);

export default router;
