// src/models/Game.js
import mongoose from "mongoose";

const playerSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "UserMafia", required: true },
  username: String,
  gameRole: String,
  isAlive: { type: Boolean, default: true },
  isReady: { type: Boolean, default: false },
  isHealed: { type: Boolean, default: false },
  votes: { type: Number, default: 0 },
}, { _id: false });

const mafiaVoteSchema = new mongoose.Schema({
  voter: { type: mongoose.Schema.Types.ObjectId, ref: "UserMafia", required: true },
  target: { type: mongoose.Schema.Types.ObjectId, ref: "UserMafia", required: true },
}, { _id: false });

const gameSchema = new mongoose.Schema({
  roomName: { type: String, required: true },
  roomId: { type: String, required: true, unique: true },
  hostId: { type: mongoose.Schema.Types.ObjectId, ref: "UserMafia", required: true },
  players: [playerSchema],

  phase: { type: String, enum: ["waiting","started","night","day","ended"], default: "waiting" },
  currentTurn: { type: Number, default: 0 },
  winner: { type: String, enum: ["mafia","villagers", null], default: null },
  endedAt: Date,

  // Night actions
  mafiaTarget: { type: mongoose.Schema.Types.ObjectId, default: null },
  doctorTarget: { type: mongoose.Schema.Types.ObjectId, default: null },
  hasMafiaKilled: { type: Boolean, default: false },
  hasDoctorHealed: { type: Boolean, default: false },
  hasDetectiveChecked: { type: Boolean, default: false },

  // NEW: collective mafia voting during night
  mafiaVotes: { type: [mafiaVoteSchema], default: [] },
}, { timestamps: true });

export default mongoose.model("Game", gameSchema);
