import mongoose from "mongoose";

const playerSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserMafia",
    required: true,
  },
  username: String,
  gameRole: String,
  isAlive: { type: Boolean, default: true },
  isReady: { type: Boolean, default: false },

  // 🔹 Night actions uchun
  isHealed: { type: Boolean, default: false },
  votes: { type: Number, default: 0 },
}, { _id: false });

const gameSchema = new mongoose.Schema({
  roomName: { type: String, required: true },
  roomId: { type: String, required: true, unique: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "UserMafia", required: true },
  players: [playerSchema],

  // 🔹 O‘yin progress
  phase: {
    type: String,
    enum: ["waiting","started","night", "day", "ended"],
    default: "waiting",
  },
  currentTurn: { type: Number, default: 0 },
  winner: { type: String, enum: ["mafia", "villagers", null], default: null },
  endedAt: Date,

  // 🔹 Night actions uchun flag va targetlar
  mafiaTarget: { type: mongoose.Schema.Types.ObjectId, default: null },
  doctorTarget: { type: mongoose.Schema.Types.ObjectId, default: null },

  hasMafiaKilled: { type: Boolean, default: false },
  hasDoctorHealed: { type: Boolean, default: false },
  hasDetectiveChecked: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model("Game", gameSchema);
