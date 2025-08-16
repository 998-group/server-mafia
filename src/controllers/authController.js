import UserModel from "../models/User.js";
import jwt from "jsonwebtoken";

export const register = async (req, res) => {
  const { username, password, avatar, role, isBan, isMuted } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Please fill in all fields" });
  }

  try {
    const existingUser = await UserModel.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: "User already exists" });
    }

    const user = await UserModel.create({ username, password, avatar, role, isBan, isMuted });
    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(201).json({
      message: "Registered successfully", 
      user: {
        _id: user._id,
        username: user.username,
        image: user.avatar,
        role: user.role,
        isBan: user.isBan,
        isMuted: user.isMuted
      }, token
    })
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
};

export const login = async (req, res) => {
  const { username, password, avatar, role, isBan, isMuted } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: "Please fill in all fields" });
  }

  try {
    const user = await UserModel.findOne({ username, password });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const token = jwt.sign(
      { id: user._id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        username: user.username,
        image: user.avatar,
        role: user.role,
        isBan: user.isBan,
        isMuted: user.isMuted
      },
    });
  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
};

export const getAllUsers = async (req, res) => {
  try {
    const users = await UserModel.find();
    res.status(200).json(users);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getUserCoins = async (req, res) => {
  try {
    const user = await UserMafia.findById(req.userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    
    res.json({ coins: user.coins });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const addCoins = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await UserMafia.findByIdAndUpdate(
      req.userId,
      { $inc: { coins: amount } },
      { new: true }
    );
    
    res.json({ coins: user.coins });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const deductCoins = async (req, res) => {
  try {
    const { amount } = req.body;
    const user = await UserMafia.findById(req.userId);
    
    if (user.coins < amount) {
      return res.status(400).json({ message: "Not enough coins" });
    }
    
    user.coins -= amount;
    await user.save();
    
    res.json({ coins: user.coins });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
