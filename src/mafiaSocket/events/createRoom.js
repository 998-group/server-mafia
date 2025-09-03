import Game from "../../models/Game.js";
import User from "../../models/User.js";
import uniqId from "uniqid";
import generateCode from "../../utils/generateCode.js";

export const createRoom = async (io, socket, data) => {
  const user = await User.findById(data.hostId);
  console.log("DATA: ", data);
  console.log("user", user);

  if (!user) {
    socket.emit("error", { message: "User not found" });
    return;
  }

  if (!data.hostId || !data.roomName) {
    socket.emit("error", { message: "Missing hostId or roomName" });
    return;
  }

  const newRoom = new Game({
    roomId: generateCode(),
    roomName: data.roomName,
    hostId: data.hostId,
    players: [{ userId: data.hostId, username: user.username }],
  });

  await newRoom.save();

  socket.emit("joined_room", newRoom);
  socket.emit("update_players", newRoom.players);
  io.emit(
    "update_rooms",
    await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100)
  );
  console.log("NEW ROOM: ", newRoom);
};

export const joinRoom = async (io, socket, data) => {
  const room = await Game.findOne({ roomId: data.roomId });
  if (!room) {
    socket.emit('error', { message: 'Room not found' });
    return
  }
  console.log("data",data)
  const alreadyJoined = room.players.find(p => String(p.userId) === data.userId)
  if (!alreadyJoined) {
    room.players.push({ userId: data.userId, username: data.username, isAlive: true });
    await room.save()
  }
  socket.join(data.roomId);

  socket.emit("joined_room", room);
  io.to(data.roomId).emit("update_players", room.players)
};


export const leaveRoom = async (io, socket, data) => {
  const room = await Game.findOne({ roomId: data.roomId });
  if (!room) {
    socket.emit("error", { message: "Room not found" });
    return;
  }

  room.players = room.players.filter(
    (p) => String(p.userId) !== String(data.userId)
  );

  if (room.players.length === 0) {
    await Game.deleteOne({ roomId: data.roomId });
    console.log(`❌ Room deleted: ${room.roomName}`);
  } else {
    await room.save();
    io.to(data.roomId).emit("update_players", room.players);
  }

  io.emit(
    "update_rooms",
    await Game.find({ players: { $not: { $size: 0 } } })
      .sort({ createdAt: -1 })
      .limit(100)
  );

  socket.leave(data.roomId);
};

export const readyGame = async (io, socket, data) => {
  console.log("READY GAME: ", data);
  const room = await Game.findOne({ roomId: data.roomId });
  const player = room.players.find((p) => String(p.userId) === data.userId);
  console.log("ROOM: ", room.players);
  console.log("PLAYer: ", player);
  player.isReady = player.isReady ? false : true;
  await room.save();

  io.to(data.roomId).emit("update_players", room.players);

  const allReady = room.players.length >= 2 && room.players.every(p => p.isReady) 
  if(allReady) {
    io.to(data.roomId).emit("start_game")
  }

};
