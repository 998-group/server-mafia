import mongoose from "mongoose";
const banSchema = new mongoose.Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, required: true },
  },
  { _id: false } // har bir ban uchun alohida _id kerak bo'lmasa
);

const muteSchema = new mongoose.Schema(
  {
    from: { type: Date, required: true },
    to: { type: Date, required: true },
    reason: { type: String, required: true },
  },
  { _id: false }
);

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
  },
  role: {
    type: String,
    default: "user",
    enum: ["user", "adminstrator", "moderator", "VIP", "Owner"],
  },
  password: {
    type: String,
    required: true,
  },
  gameRole: {
    type: String,
    default: "villager",
  },
  roomId: {
    type: String,
    default: null,
  },
  avatar: {
    type: String,
    default: "https://cdn-icons-png.flaticon.com/512/149/149071.png",
  },
  coins: {
    type: Number,
    default: 100,
    min: 0,
  },
  isBan: [banSchema], 
  isMuted: [muteSchema],
});

export default mongoose.model("UserMafia", userSchema);
