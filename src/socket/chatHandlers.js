import GlobalChat from "../models/GlobalChat.js";

export function handleChatEvents(io, socket) {
  socket.on("send_message", async ({ data, global }) => {
    try {
      const senderId = data?.user?.user?._id;
      if (!senderId || !data.message) {
        socket.emit("error", { message: "Invalid sender ID or message" });
        return;
      }

      const newMessage = await GlobalChat.create({
        sender: senderId,
        text: data.message,
        global,
      });

      const populated = await newMessage.populate(
        "sender",
        "_id username avatar role"
      );

      if (global) {
        io.emit("receive_message", populated);
      } else if (data.roomId) {
        io.to(data.roomId).emit("receive_message", populated);
      } else {
        socket.emit("receive_message", populated);
      }

      console.log(`✅ Message sent by ${populated.sender.username}`);
    } catch (err) {
      console.error("❌ send_message error:", err.message);
      socket.emit("error", { message: "Failed to send message" });
    }
  });

  socket.on("fetch_messages", async ({ global }) => {
    try {
      const msgs = await GlobalChat.find({ global })
        .populate("sender", "_id username avatar role")
        .sort({ createdAt: 1 })
        .limit(50);
      socket.emit("initial_messages", msgs);
    } catch (err) {
      console.error("❌ fetch_messages error:", err.message);
      socket.emit("error", { message: "Failed to fetch messages" });
    }
  });
}