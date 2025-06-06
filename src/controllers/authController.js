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
