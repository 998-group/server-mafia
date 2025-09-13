import Game from "../../models/Game.js";

export const timerEnd = async (io, data, socket) => {
  const findGame = await Game.findOne({ roomId: data.roomId });
  if (!findGame) return socket.emit("error", { message: "Game not found" });
  console.log("TIMER_END: ", data);
  const mafiaCount = findGame.players.filter((p) => p.gameRole === "mafia");
  const detectiveCount = findGame.players.filter(
    (p) => p.gameRole === "detective"
  );
  const doctorCount = findGame.players.filter((p) => p.gameRole === "doctor");
  const villagerCount = findGame.players.filter(
    (p) => p.gameRole === "peaceful"
  );

  const villager = [];

  villager.push(...detectiveCount);
  villager.push(...doctorCount);
  villager.push(...villagerCount);

  console.log("villager:", villager);

  console.log("counts: ", {
    mafia: mafiaCount.length,
    villager: villager.length,
  });
  if (findGame.phase === "started") {
    findGame.phase = "night";
    await findGame.save();
  } else if (findGame.phase === "night") {
    if (villager.length >= 2 && mafiaCount.length == 0) {
      console.log("YUTDI:", villager);
      findGame.phase = "ended";
      await findGame.save();
    } else if (villager.length <= 1 && mafiaCount.length >= 1) {
      findGame.phase = "ended";
      await findGame.save();
    } else {
      findGame.phase = "day";
      await findGame.save();
    }
  } else if (findGame.phase === "day") {
    if (villager.length >= 2 && mafiaCount.length == 0) {
      console.log("YUTDI:", villager);
      findGame.phase = "ended";
      await findGame.save();
    } else if (villager.length <= 1 && mafiaCount.length >= 1) {
      findGame.phase = "ended";
      await findGame.save();
    } else {
      findGame.phase = "night";
      await findGame.save();
    }
  }
  console.log("FINDED_GAME: ", findGame);
  io.to(data.roomId).emit("update_phase", findGame.phase);

  console.log("SARDOR BICH BOLA: ", findGame);
};
