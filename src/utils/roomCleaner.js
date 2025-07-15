import cron from "node-cron";
import Game from "../models/Game.js";

cron.schedule("*/1 * * * *", async () => {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000); // ✅ 1 soat oldingi vaqt
    const deletedRooms = await Game.deleteMany({
      createdAt: { $lte: oneHourAgo },
      phase: {$in: ["waiting", "started"] }, // ✅ faqat kutish holatida qolganlar
    });

    if (deletedRooms.deletedCount > 0) {
      console.log(`🗑️ ${deletedRooms.deletedCount} ta room o‘chirildi.`);
    }
  } catch (err) {
    console.error("❌ Cron xatoligi:", err.message);
  }
});
