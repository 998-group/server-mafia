import {
  createRoom,
  joinRoom,
  leaveRoom,
  readyGame,
} from "../mafiaSocket/events/createRoom.js";
import Game from "../models/Game.js";
import { votePlayer } from "./events/gameEvent.js";
import { getmyrole } from "./features/GameFeatures.js";
import { timerEnd } from "./helpers/timeHelper.js";

export const socketGame = (io) => {
  console.log(`🎮 Game Socket Handler initialized`);

  io.on("connection", async (socket) => {
    console.log(`🔌 User connected: ${socket.id}`);

    const rooms = await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100);
    socket.emit("update_rooms", rooms);

    socket.on("leave_room", (data) => leaveRoom(io, socket, data));
    socket.on("create_room", (data) => createRoom(io, socket, data));
    socket.on("join_room", (data) => joinRoom(io, socket, data));
    socket.on("ready", (data) => readyGame(io, socket, data));
    socket.on("client_timer_end", (data) => timerEnd(io, data, socket));
    socket.on("get_my_role", (data) => getmyrole(socket, data));
    socket.on("vote_player", (data) => votePlayer(socket, data, io));

    socket.on("disconnect", () => {
      console.log(`🔌 User disconnected: ${socket.id}`);
    });
  });
};
