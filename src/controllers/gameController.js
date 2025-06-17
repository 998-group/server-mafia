import Game from "../models/Game.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { nanoid } from "nanoid";

// 1. 🏠 Room yaratish
export const createRoom = async (req, res) => {
  try {
    const { hostId, roomName } = req.body;

    const user = await User.findById(hostId);
    if (!user) return res.status(404).json({ message: "Host user not found" });

    const roomId = nanoid(6);

    const newGame = await Game.create({
      roomName,
      roomId,
      hostId,
      players: [
        {
          userId: user._id,
          username: user.username || `User${user._id.toString().slice(-4)}`,
          isAlive: true,
          isReady: false,
        },
      ],
    });
    await newGame.save()
    console.log("newGame: ", newGame)

    return res.status(201).json({
      message: "Room created",
      newGame,
    });
  } catch (err) {
    console.error("❌ createRoom error:", err.message);
    return res.status(500).json({ message: "Server error" });
  }
};

// 2. 🙋‍♂️ Roomga qo'shilish
export const joinRoom = async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;

    const game = await Game.findOne({ roomId });
    if (!game) return res.status(404).json({ message: "Room not found" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const alreadyJoined = game.players.some(
      (p) => p.userId.toString() === userId
    );
    if (alreadyJoined) {
      return res.status(200).json({ message: "Already joined", game });
    }

    game.players.push({
      userId: user._id,
      username: user.username,
      isAlive: true,
      isReady: false,
    });

    await game.save();

    res.status(200).json({ message: "Joined the room", game });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 3. ℹ️ Room haqida info olish
export const getRoomInfo = async (req, res) => {
  try {
    const { roomId } = req.params;

    const game = await Game.findOne({ roomId }).populate(
      "players.userId",
      "username"
    );

    if (!game) return res.status(404).json({ message: "Room not found" });

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

    if (!game) return res.status(404).json({ message: "Room not found" });

    res.status(200).json({ message: "Game result saved", game });
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

// 6. 🔍 Barcha o‘yinlar ro‘yxatini olish
export const getAllGames = async (req, res) => {
  try {
    const games = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);

    res.status(200).json({ success: true, count: games.length, games });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
