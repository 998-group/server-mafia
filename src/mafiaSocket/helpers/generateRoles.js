// src/mafiaSocket/helpers/generateRoles.js
import Game from "../../models/Game.js";

const pickUniqueIndices = (count, max) => {
  // count > max bo'lsa ham baribir set qila oladigancha olamiz
  const need = Math.min(count, max);
  const s = new Set();
  while (s.size < need) {
    s.add(Math.floor(Math.random() * max)); // 0..max-1
  }
  return [...s];
};

const assignRolesBySize = (playersLen) => {
  // Qancha rol kerakligini qaytaradi
  if (playersLen >= 9) return { mafias: 3, doctors: 1, detectives: 1 };
  if (playersLen >= 6) return { mafias: 2, doctors: 1, detectives: 1 };
  if (playersLen >= 3) return { mafias: 1, doctors: 1, detectives: 0 };
  return { mafias: 0, doctors: 0, detectives: 0 };
};

const generateRole = async (room) => {
  if (!room || !Array.isArray(room.players)) {
    throw new Error("Room or room.players is invalid");
  }

  const n = room.players.length;
  if (n === 0) return room;

  // 1) Hamma default peaceful
  room.players.forEach((p) => { p.gameRole = "peaceful"; });

  // 2) Nechta rol kerakligini aniqlaymiz
  const plan = assignRolesBySize(n);

  // 3) Unikal indekslar
  const mafiaIdx = pickUniqueIndices(plan.mafias, n);
  const restAfterMafia = pickUniqueIndices(plan.doctors + plan.detectives, n - mafiaIdx.length)
    .map(i => {
      // mafia to'plamidan keyin qolgan slotlardan tanlash uchun maplash kerak bo'ladi
      // ammo soddaroq yo'l: umumiy tanlashni bosqichma-bosqich qilamiz
      return i;
    });

  // osonroq va aniqroq: bosqichma-bosqich tanlaymiz
  // all pool
  const pool = new Set(Array.from({ length: n }, (_, i) => i));
  // mafiyalar
  const mafias = pickUniqueIndices(plan.mafias, pool.size).map(() => {
    const arr = [...pool];
    const idx = arr[Math.floor(Math.random() * arr.length)];
    pool.delete(idx);
    return idx;
  });
  // doctor
  const doctors = pickUniqueIndices(plan.doctors, pool.size).map(() => {
    const arr = [...pool];
    const idx = arr[Math.floor(Math.random() * arr.length)];
    pool.delete(idx);
    return idx;
  });
  // detective
  const detectives = pickUniqueIndices(plan.detectives, pool.size).map(() => {
    const arr = [...pool];
    const idx = arr[Math.floor(Math.random() * arr.length)];
    pool.delete(idx);
    return idx;
  });

  // 4) Rollarni qo'yamiz
  mafias.forEach(i => { room.players[i].gameRole = "mafia"; });
  doctors.forEach(i => { room.players[i].gameRole = "doctor"; });
  detectives.forEach(i => { room.players[i].gameRole = "detective"; });

  // 5) Mongoose-ga array o'zgarganini bildiramiz va saqlaymiz
  room.markModified("players");
  await room.save();

  return room;
};

export default generateRole;
