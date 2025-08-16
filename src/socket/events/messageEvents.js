// src/socket/events/messageEvents.js
import GlobalChat from "../../models/GlobalChat.js";

export const setupMessageEvents = (socket, io) => {

  // ===== GLOBAL MESSAGING =====
  socket.on("send_message", async ({ data, global }) => {
    try {
      const senderId = data?.user?.user?._id;
      if (!senderId || !data.message) {
        socket.emit("error", { message: "Invalid sender ID or message" });
        return;
      }

      // Sanitize message to prevent XSS
      const sanitizedMessage = data.message.toString().trim();
      if (!sanitizedMessage || sanitizedMessage.length > 1000) {
        socket.emit("error", { message: "Invalid message length" });
        return;
      }

      const newMessage = await GlobalChat.create({
        sender: senderId,
        text: sanitizedMessage,
        global: Boolean(global),
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

  // ===== ROOM MESSAGING =====
  socket.on("send_room_message", async ({ roomId, message }) => {
    try {
      if (!roomId || !message) {
        socket.emit("error", { message: "Missing roomId or message" });
        return;
      }

      // Broadcast room message to all players in the room
      io.to(roomId).emit("receive_room_message", {
        ...message,
        timestamp: new Date().toISOString(),
      });

      console.log(`💬 Room message sent in ${roomId} by ${message.name}`);
    } catch (err) {
      console.error("❌ send_room_message error:", err.message);
      socket.emit("error", { message: "Failed to send room message" });
    }
  });

  // ===== FETCH MESSAGES =====
  socket.on("fetch_messages", async ({ global }) => {
    try {
      const msgs = await GlobalChat.find({ global: Boolean(global) })
        .populate("sender", "_id username avatar role")
        .sort({ createdAt: 1 })
        .limit(50);
      socket.emit("initial_messages", msgs);
    } catch (err) {
      console.error("❌ fetch_messages error:", err.message);
      socket.emit("error", { message: "Failed to fetch messages" });
    }
  });
};