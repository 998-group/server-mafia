import Game from "../models/Game.js";
import User from "../models/User.js";
import mongoose from "mongoose";

// 1. 🏠 Room yaratish
export const createRoom = async (req, res) => {
  try {
    const { hostId, roomName } = req.body;
    const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

    const newGame = await Game.create({
      roomId,
      hostId,
      roomName,
      players: [],
    });

    res.status(201).json({ message: "Room yaratildi", newGame });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 2. 🙋‍♂️ Roomga qo'shilish
export const joinRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const game = await Game.findOne({ roomId });
    if (!game) return res.status(404).json({ message: "Room topilmadi" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User topilmadi" });

    const alreadyJoined = game.players.some(
      (p) => p.userId.toString() === userId
    );
    if (alreadyJoined) {
      return res.status(200).json({ message: "Allaqachon qo‘shilgan", game });
    }

    game.players.push({
      userId: user._id,
      username: user.username,
    });

    await game.save();

    res.status(200).json({ message: "Roomga qo‘shildingiz", game });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. ℹ️ Room haqida info olish
export const getRoomInfo = async (req, res) => {
  try {
    const { roomId } = req.params;
    console.log("roomID: ", roomId);

    const game = await Game.findOne({ roomId }).populate(
      "players.userId",
      "username"
    );

    console.log("game: ",!game);

    if (!game) return res.status(404).json({ message: "Room topilmadi" });

    res.status(200).json(game);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. 🏁 O'yin natijasini saqlash
export const saveGameResult = async (req, res) => {
  try {
    const { roomId, winner } = req.body;

    const game = await Game.findOneAndUpdate(
      { roomId },
      { winner, phase: "ended", endedAt: new Date() },
      { new: true }
    );

    res.status(200).json({ message: "Natija saqlandi", game });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. 📜 Foydalanuvchining o'yinlar tarixi
export const getUserHistory = async (req, res) => {
  try {
    const { userId } = req.params;

    const games = await Game.find({
      "players.userId": new mongoose.Types.ObjectId(userId),
      phase: "ended",
    });

    res.status(200).json(games);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
// 🔍 Barcha o‘yinlar ro‘yxatini olish
export const getAllGames = async (req, res) => {
  try {
    const games = await Game.find()
      .sort({ createdAt: -1 }) // eng oxirgi o‘yinlar birinchi
      .limit(100); // ixtiyoriy: faqat 100 ta
    console.log(games);

    res.status(200).json({ success: true, count: games.length, games });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
