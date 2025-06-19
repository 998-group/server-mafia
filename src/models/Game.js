import mongoose from "mongoose";

const playerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserMafia",
      required: true,
    },
    username: String,
    gameRole: String, // 'mafia', 'villager', 'detective', etc.
    isAlive: {
      type: Boolean,
      default: true,
    },
    isReady: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const gameSchema = new mongoose.Schema(
  {
    roomName: {
      type: String,
      required: true,
    },
    roomId: {
      type: String,
      required: true,
      unique: true,
    },
    hostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "UserMafia",
      required: true,
    },
    players: [playerSchema],
    phase: {
      type: String,
      enum: ["waiting", "night", "day", "ended"],
      default: "waiting",
    },
    currentTurn: {
      type: Number,
      default: 0,
    },
    winner: {
      type: String,
      enum: ["mafia", "villagers", null],
      default: null,
    },
    endedAt: Date,
  },
  { timestamps: true }
);

gameSchema.pre("save", async function (next) {
  if (this.players.length === 0) {
    await this.deleteOne(); // yoki this.remove()
    console.log("Room auto-deleted by middleware");
  }
  next();
});

export default mongoose.model("Game", gameSchema);