import Game from "../../models/Game.js";

export const getmyrole = async (socket, info) => {
  try {
    // payload tekshiruv
    if (!info || !info.roomId || !info.userId) {
      socket.emit("error", { message: "roomId va userId talab qilinadi" });
      return;
    }

    const findGame = await Game.findOne({ roomId: info.roomId });
    if (!findGame) {
      socket.emit("error", { message: "Game not found" });
      return;
    }

    const player = findGame.players.find(
      (p) => String(p.userId) === String(info.userId)
    );

    if (!player) {
      socket.emit("error", { message: "Player not found in this room" });
      return;
    }

    // Faqat o'zi haqida ma'lumot yuboramiz
    socket.emit("your_role", {
      userId: player.userId,
      username: player.username,
      gameRole: player.gameRole ?? "peaceful",
      isAlive: player.isAlive,
    });
  } catch (err) {
    console.error("getmyrole error:", err);
    socket.emit("error", { message: "Internal server error" });
  }
};
