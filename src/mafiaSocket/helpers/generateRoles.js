const generateRandomNumber = (min, max) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

// 🔑 Takrorlanmaydigan index generator
const getUniqueIndices = (count, max) => {
  const indices = new Set();
  while (indices.size < count) {
    indices.add(generateRandomNumber(0, max - 1));
  }
  return [...indices];
};

const generateRole = (room) => {
  console.log("🎭 GenerateRoles for room:", room.roomId);

  // default peaceful
  room.players.forEach((player) => {
    player.gameRole = "peaceful";
  });

  if (room.players.length >= 9) {
    const [m1, m2, m3, d1, det] = getUniqueIndices(5, room.players.length);
    room.players[m1].gameRole = "mafia";
    room.players[m2].gameRole = "mafia";
    room.players[m3].gameRole = "mafia";
    room.players[d1].gameRole = "doctor";
    room.players[det].gameRole = "detective";
  } else if (room.players.length >= 6) {
    const [m1, m2, d1, det] = getUniqueIndices(4, room.players.length);
    room.players[m1].gameRole = "mafia";
    room.players[m2].gameRole = "mafia";
    room.players[d1].gameRole = "doctor";
    room.players[det].gameRole = "detective";
  } else if (room.players.length >= 4) {
    const [m1, d1] = getUniqueIndices(2, room.players.length);
    room.players[m1].gameRole = "mafia";
    room.players[d1].gameRole = "doctor";
  }

  console.log(
    "✅ Assigned roles:",
    room.players.map((p) => ({ username: p.username, role: p.gameRole }))
  );

  return room;
};

export default generateRole;
