import Game from "../../models/Game.js";

export const votePlayer = async (socket, data, io) => {
  const room = await Game.findOne({ roomId: data.roomId });
  console.log("data: ", data);
  if (!room) {
    socket.emit("error", { message: "Room not found" });
    return;
  }

  const player = room.players.find((p) => String(p.userId) === data.selected);
  if (!player) {
    socket.emit("error", { message: "Player not found in this room" });
    return;
  }

  if (player.isAlive === false) {
    socket.emit("error", { message: "Player is dead" });
  }

  player.votes += 1;
  await player.save();

  console.log("player: ", player);
};


export const removeVoice = async ( ) => {
    
}