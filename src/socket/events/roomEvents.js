// src/socket/events/roomEvents.js - Complete Full Code
import Game from "../../models/Game.js";
import User from "../../models/User.js";
import uniqId from "uniqid";
import { GAME_CONFIG } from "../../config/gameConfig.js";
import { generateRoles } from "../helpers/gameLogic.js";

export const setupRoomEvents = (socket, io, timerManager) => {
  console.log("🏠 Setting up room events with timer integration");

  const sendRooms = async () => {
    try {
      const rooms = await Game.find({ players: { $not: { $size: 0 } } })
        .sort({ createdAt: -1 })
        .limit(100);
      io.emit("update_rooms", rooms);
      console.log(`📡 Sent ${rooms.length} rooms to all clients`);
    } catch (err) {
      console.error("❌ sendRooms error:", err.message);
    }
  };

  // ===== JOIN ROOM EVENT - COMPLETELY FIXED =====
  socket.on("join_room", async ({ roomId, userId, username }) => {
    try {
      console.log(
        `🚪 User ${username} (${userId}) trying to join room ${roomId}`
      );

      if (!roomId || !userId || !username) {
        socket.emit("error", {
          message: "Missing roomId, userId, or username",
        });
        return;
      }

      // ✅ STEP 1: Find room with retry mechanism
      let gameRoom = null;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          gameRoom = await Game.findOne({ roomId });
          break;
        } catch (err) {
          retryCount++;
          console.warn(
            `⚠️ Retry ${retryCount}: Database query failed for room ${roomId}`
          );
          if (retryCount === maxRetries) throw err;
          await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms delay
        }
      }

      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ STEP 2: Check game phase
      if (gameRoom.phase !== "waiting") {
        socket.emit("error", { message: "Game is already in progress" });
        return;
      }

      // ✅ STEP 3: Check room capacity
      if (gameRoom.players.length >= GAME_CONFIG.MAX_PLAYERS) {
        socket.emit("error", { message: "Room is full" });
        return;
      }

      // ✅ STEP 4: Advanced duplicate check
      const existingPlayerIndex = gameRoom.players.findIndex(
        (p) => p.userId.toString() === userId.toString()
      );

      if (existingPlayerIndex !== -1) {
        console.log(
          `🔍 User ${username} already exists in room ${roomId} at index ${existingPlayerIndex}`
        );

        // Update existing player info (in case username changed)
        gameRoom.players[existingPlayerIndex].username = username.trim();

        try {
          await gameRoom.save();
        } catch (saveErr) {
          console.warn(
            `⚠️ Failed to update existing player: ${saveErr.message}`
          );
        }

        // Join socket to room
        socket.join(roomId);
        socket.data = { userId, roomId };

        // Send current room state
        socket.emit("joined_room", gameRoom);

        // Update all players
        io.to(roomId).emit("update_players", gameRoom.players);

        console.log(`✅ Existing user ${username} rejoined room ${roomId}`);
        return;
      }

      // ✅ STEP 5: Remove any duplicate entries (cleanup)
      const cleanPlayers = [];
      const seenUserIds = new Set();

      gameRoom.players.forEach((player) => {
        if (!seenUserIds.has(player.userId.toString())) {
          cleanPlayers.push(player);
          seenUserIds.add(player.userId.toString());
        } else {
          console.log(
            `🧹 Removing duplicate player: ${player.username} (${player.userId})`
          );
        }
      });

      gameRoom.players = cleanPlayers;

      // ✅ STEP 6: Add new player
      const newPlayer = {
        userId,
        username: username.trim(),
        gameRole: null,
        isAlive: true,
        isReady: false,
        isHealed: false,
        votes: 0,
        hasVoted: false,
      };

      gameRoom.players.push(newPlayer);

      // ✅ STEP 7: Save with retry mechanism (prevent version conflicts)
      let saveSuccess = false;
      retryCount = 0;

      while (retryCount < maxRetries && !saveSuccess) {
        try {
          await gameRoom.save();
          saveSuccess = true;
          console.log(
            `💾 Successfully saved room ${roomId} on attempt ${retryCount + 1}`
          );
        } catch (saveErr) {
          retryCount++;
          console.warn(
            `⚠️ Save attempt ${retryCount} failed: ${saveErr.message}`
          );

          if (
            saveErr.name === "VersionError" ||
            saveErr.message.includes("version")
          ) {
            // Reload document and retry
            gameRoom = await Game.findOne({ roomId });
            if (!gameRoom) {
              socket.emit("error", { message: "Room was deleted" });
              return;
            }

            // Re-check for duplicates
            const existingAfterReload = gameRoom.players.findIndex(
              (p) => p.userId.toString() === userId.toString()
            );

            if (existingAfterReload !== -1) {
              console.log(`🔍 User ${username} was added by another process`);
              saveSuccess = true; // Don't need to save again
              break;
            }

            // Re-add player to reloaded document
            gameRoom.players.push(newPlayer);
          } else if (retryCount === maxRetries) {
            throw saveErr;
          }

          // Wait before retry
          await new Promise((resolve) => setTimeout(resolve, 100 * retryCount));
        }
      }

      if (!saveSuccess) {
        socket.emit("error", {
          message: "Failed to join room after multiple attempts",
        });
        return;
      }

      // ✅ STEP 8: Socket and response handling
      socket.join(roomId);
      socket.data = { userId, roomId };

      // Send success response
      socket.emit("joined_room", gameRoom);

      // Notify all players in room
      io.to(roomId).emit("update_players", gameRoom.players);
      io.to(roomId).emit("player_joined", {
        userId,
        username: username.trim(),
        playersCount: gameRoom.players.length,
      });

      console.log(
        `✅ User ${username} successfully joined room ${roomId}. Total players: ${gameRoom.players.length}`
      );

      // Update global room list
      await sendRooms();
    } catch (err) {
      console.error("❌ join_room error:", err.message);
      console.error("Stack trace:", err.stack);
      socket.emit("error", {
        message: "Failed to join room",
        details:
          process.env.NODE_ENV === "development"
            ? err.message
            : "Internal error",
      });
    }
  });

  // ===== LEAVE ROOM EVENT - FIXED FOR DUPLICATES =====
  socket.on("leave_room", async ({ roomId, userId }) => {
    try {
      console.log(`🚪 User ${userId} leaving room ${roomId}`);

      if (!roomId || !userId) {
        socket.emit("error", { message: "Missing roomId or userId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Find and remove ALL instances of this user (cleanup duplicates)
      const playersBeforeRemoval = gameRoom.players.length;
      let removedPlayer = null;

      gameRoom.players = gameRoom.players.filter((p) => {
        if (p.userId.toString() === userId.toString()) {
          if (!removedPlayer) {
            removedPlayer = p; // Store first instance for logging
          }
          return false; // Remove this player
        }
        return true; // Keep this player
      });

      const playersRemoved = playersBeforeRemoval - gameRoom.players.length;

      if (playersRemoved === 0) {
        socket.emit("error", { message: "You are not in this room" });
        return;
      }

      if (playersRemoved > 1) {
        console.log(
          `🧹 Removed ${playersRemoved} duplicate instances of user ${userId}`
        );
      }

      const wasHost = gameRoom.hostId.toString() === userId.toString();

      console.log(
        `👤 ${
          removedPlayer?.username || "User"
        } left room ${roomId}. Players remaining: ${gameRoom.players.length}`
      );

      if (gameRoom.players.length === 0) {
        // Delete empty room and clear timer
        await Game.deleteOne({ roomId });
        timerManager.clearRoomTimer(roomId);

        io.to(roomId).emit("room_closed", {
          reason: "empty",
          message: "Room closed - no players remaining",
        });

        console.log(`🗑️ Empty room ${roomId} deleted and timer cleared`);
      } else {
        // If host left, assign new host
        if (wasHost) {
          const newHost = gameRoom.players[0];
          gameRoom.hostId = newHost.userId;

          console.log(
            `👑 New host assigned: ${newHost.username} in room ${roomId}`
          );

          io.to(roomId).emit("new_host", {
            newHostId: newHost.userId.toString(),
            newHostUsername: newHost.username,
            message: `${newHost.username} is now the host`,
          });
        }

        // Save with retry mechanism
        let saveSuccess = false;
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries && !saveSuccess) {
          try {
            await gameRoom.save();
            saveSuccess = true;
          } catch (saveErr) {
            retryCount++;
            console.warn(
              `⚠️ Leave room save attempt ${retryCount} failed: ${saveErr.message}`
            );

            if (retryCount === maxRetries) {
              console.error(
                `❌ Failed to save after player left room ${roomId}`
              );
              // Continue anyway, emit events based on current state
              break;
            }

            await new Promise((resolve) =>
              setTimeout(resolve, 100 * retryCount)
            );
          }
        }

        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("player_left", {
          userId: userId,
          username: removedPlayer?.username || "Unknown",
          playersCount: gameRoom.players.length,
          wasHost: wasHost,
        });
      }

      // Leave socket room
      socket.leave(roomId);
      socket.data = null;

      // Send confirmation to leaving player
      socket.emit("left_room", {
        roomId,
        message: "Successfully left room",
      });

      // Update global room list
      await sendRooms();
    } catch (err) {
      console.error("❌ leave_room error:", err.message);
      socket.emit("error", { message: "Failed to leave room" });
    }
  });

  // ===== CLEANUP DUPLICATES ADMIN FUNCTION =====
  socket.on("cleanup_room_duplicates", async ({ roomId, adminId }) => {
    try {
      console.log(`🧹 Cleanup duplicates request for room ${roomId}`);

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      const originalCount = gameRoom.players.length;
      const cleanPlayers = [];
      const seenUserIds = new Set();

      gameRoom.players.forEach((player) => {
        if (!seenUserIds.has(player.userId.toString())) {
          cleanPlayers.push(player);
          seenUserIds.add(player.userId.toString());
        }
      });

      const duplicatesRemoved = originalCount - cleanPlayers.length;

      if (duplicatesRemoved > 0) {
        gameRoom.players = cleanPlayers;
        await gameRoom.save();

        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("notification", {
          message: `Removed ${duplicatesRemoved} duplicate players`,
          type: "success",
        });

        console.log(
          `🧹 Removed ${duplicatesRemoved} duplicates from room ${roomId}`
        );
      } else {
        socket.emit("notification", {
          message: "No duplicates found",
          type: "info",
        });
      }
    } catch (err) {
      console.error("❌ cleanup_room_duplicates error:", err.message);
      socket.emit("error", { message: "Failed to cleanup duplicates" });
    }
  });

  console.log("✅ Room events setup completed with duplicate prevention");
  // ===== CREATE ROOM EVENT =====
  socket.on("create_room", async (data) => {
    try {
      console.log(`🏠 Creating room: ${data.roomName} by ${data.hostId}`);

      if (!data.hostId || !data.roomName) {
        socket.emit("error", { message: "Missing hostId or roomName" });
        return;
      }

      // ✅ Host user mavjudligini tekshirish
      const owner = await User.findById(data.hostId);
      if (!owner) {
        socket.emit("error", { message: "Host user not found" });
        return;
      }

      // ✅ User boshqa roomda emasligini tekshirish
      const existingRoom = await Game.findOne({
        "players.userId": data.hostId,
      });
      // if (existingRoom) {
      //   console.log(`❌ User ${owner.username} already in room ${existingRoom.roomId}`);
      //   socket.emit("error", { message: "You are already in another room" });
      //   return;
      // }

      const newRoom = await Game.create({
        roomId: uniqId(),
        roomName: data.roomName,
        players: [
          {
            userId: owner._id,
            username: owner.username,
            isAlive: true,
            isReady: false,
            votes: 0,
            isHealed: false,
            hasVoted: false,
            voice: [],
          },
        ],
        hostId: data.hostId,
        phase: "waiting",
        hasMafiaKilled: false,
        hasDoctorHealed: false,
        hasDetectiveChecked: false,
        mafiaTarget: null,
        doctorTarget: null,
      });

      socket.join(newRoom.roomId);
      socket.data.userId = data.hostId;
      socket.data.roomId = newRoom.roomId;

      socket.emit("joined_room", newRoom);
      io.to(newRoom.roomId).emit("update_players", newRoom.players);
      io.to(newRoom.roomId).emit("game_phase", newRoom);
      await sendRooms();

      console.log(`✅ Room created: ${newRoom.roomId} by ${owner.username}`);
    } catch (err) {
      console.error("❌ create_room error:", err.message);
      socket.emit("error", { message: "Failed to create room" });
    }
  });

  // ===== JOIN ROOM EVENT =====
  socket.on("join_room", async ({ roomId, userId, username }) => {
    try {
      console.log(
        `🚪 User ${username} (${userId}) trying to join room ${roomId}`
      );

      if (!roomId || !userId || !username) {
        socket.emit("error", {
          message: "Missing roomId, userId, or username",
        });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // Check if game is in progress
      if (gameRoom.phase !== "waiting") {
        socket.emit("error", {
          message: "Cannot join room: game is in progress",
        });
        return;
      }

      // ✅ IMPROVED: Check if already in THIS room
      const alreadyInThisRoom = gameRoom.players.some(
        (p) => p.userId.toString() === userId.toString()
      );

      console.log(`🔍 Already in this room (${roomId}): ${alreadyInThisRoom}`);
      console.log(
        `📋 Current players:`,
        gameRoom.players.map((p) => ({
          userId: p.userId.toString(),
          username: p.username,
        }))
      );

      if (!alreadyInThisRoom) {
        // ✅ IMPROVED: Check for other rooms with better query
        const otherRooms = await Game.find({
          "players.userId": userId,
          roomId: { $ne: roomId }, // Exclude current room
          $or: [
            { phase: "waiting" },
            { phase: "started" },
            { phase: "night" },
            { phase: "day" },
          ],
        });

        console.log(
          `🔍 User ${userId} found in ${otherRooms.length} other active rooms`
        );

        if (otherRooms.length > 0) {
          console.log(
            `❌ User ${userId} is in other rooms:`,
            otherRooms.map((r) => r.roomId)
          );

          // ✅ AUTO-LEAVE: Remove from other rooms
          for (const otherRoom of otherRooms) {
            console.log(
              `🧹 Auto-removing user ${userId} from room ${otherRoom.roomId}`
            );

            const wasHostInOtherRoom =
              otherRoom.hostId.toString() === userId.toString();

            otherRoom.players = otherRoom.players.filter(
              (p) => p.userId.toString() !== userId.toString()
            );

            if (otherRoom.players.length === 0) {
              await Game.deleteOne({ roomId: otherRoom.roomId });
              io.to(otherRoom.roomId).emit("room_closed");
              timerManager.clearRoomTimer(otherRoom.roomId);
              console.log(`🗑️ Empty room ${otherRoom.roomId} auto-deleted`);
            } else {
              // If was host, assign new host
              if (wasHostInOtherRoom && otherRoom.players.length > 0) {
                otherRoom.hostId = otherRoom.players[0].userId;
                io.to(otherRoom.roomId).emit("new_host", {
                  newHostId: otherRoom.hostId,
                  newHostUsername: otherRoom.players[0].username,
                });
                console.log(
                  `👑 New host assigned in room ${otherRoom.roomId}: ${otherRoom.players[0].username}`
                );
              }
              await otherRoom.save();
              io.to(otherRoom.roomId).emit("update_players", otherRoom.players);
            }
          }

          console.log(
            `✅ User ${userId} auto-cleaned from ${otherRooms.length} rooms`
          );
        }

        // ✅ Check room capacity
        if (gameRoom.players.length >= GAME_CONFIG.MAX_PLAYERS) {
          socket.emit("error", { message: "Room is full" });
          return;
        }

        // ✅ Add player to room
        gameRoom.players.push({
          userId,
          username,
          isAlive: true,
          isReady: false,
          votes: 0,
          isHealed: false,
          hasVoted: false,
          voice: [],
        });
        await gameRoom.save();
        console.log(`✅ User ${username} added to room ${roomId}`);
      } else {
        console.log(
          `ℹ️ User ${username} already in room ${roomId}, skipping add`
        );
      }

      // ✅ Always set socket data
      socket.join(roomId);
      socket.data.userId = userId;
      socket.data.roomId = roomId;

      socket.emit("joined_room", gameRoom);
      io.to(roomId).emit("update_players", gameRoom.players);
      io.to(roomId).emit("game_phase", gameRoom);
      await sendRooms();

      console.log(`✅ User ${username} successfully joined room ${roomId}`);
    } catch (err) {
      console.error("❌ join_room error:", err.message);
      socket.emit("error", { message: "Failed to join room" });
    }
  });

  // ===== READY TOGGLE EVENT =====
  socket.on("ready", async ({ roomId, userId }) => {
    try {
      if (!roomId || !userId) {
        socket.emit("error", { message: "Missing roomId or userId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      if (gameRoom.phase !== "waiting") {
        socket.emit("error", {
          message: "Cannot change ready status: game is not in waiting phase",
        });
        return;
      }

      const player = gameRoom.players.find(
        (p) => p.userId.toString() === userId.toString()
      );
      if (!player) {
        socket.emit("error", { message: "Player not found" });
        return;
      }

      player.isReady = !player.isReady;
      await gameRoom.save();

      socket.emit("notification", {
        type: "success",
        message: player.isReady ? "You are ready" : "You are not ready",
      });

      io.to(roomId).emit("update_players", gameRoom.players);

      // ✅ Check if all players are ready and minimum players requirement
      const allReady =
        gameRoom.players.length >= GAME_CONFIG.MIN_PLAYERS &&
        gameRoom.players.every((p) => p.isReady);

      console.log(
        `📊 Ready Check: ${gameRoom.players.length}/${GAME_CONFIG.MIN_PLAYERS} players, All ready: ${allReady}`
      );

      if (allReady && gameRoom.phase === "waiting") {
        // Shuffle players and assign roles
        const shuffled = [...gameRoom.players].sort(() => Math.random() - 0.5);
        const roles = generateRoles(shuffled.length);

        shuffled.forEach((player, i) => {
          player.gameRole = roles[i];
          player.isAlive = true;
          player.isHealed = false;
          player.votes = 0;
          player.hasVoted = false;
        });

        gameRoom.phase = "started";
        gameRoom.hasMafiaKilled = false;
        gameRoom.hasDoctorHealed = false;
        gameRoom.hasDetectiveChecked = false;
        gameRoom.currentTurn = 1;
        gameRoom.mafiaTarget = null;
        gameRoom.doctorTarget = null;
        await gameRoom.save();

        io.to(roomId).emit("start_game");
        io.to(roomId).emit("update_players", gameRoom.players);
        io.to(roomId).emit("game_phase", gameRoom);

        // Start with night phase timer

        console.log(
          `🎮 Game started in room ${roomId} with ${gameRoom.players.length} players (Test Mode: ${GAME_CONFIG.TEST_MODE})`
        );
      }
    } catch (err) {
      console.error("❌ ready error:", err.message);
      socket.emit("error", { message: "Failed to toggle ready status" });
    }
  });

  // ===== LEAVE ROOM EVENT =====
  socket.on("leave_room", async ({ roomId, userId }) => {
    try {
      console.log(`🚪 User ${userId} trying to leave room ${roomId}`);

      if (!roomId || !userId) {
        socket.emit("error", { message: "Missing roomId or userId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        console.log(`❌ Room ${roomId} not found for user ${userId}`);
        socket.emit("error", { message: "Room not found" });
        return;
      }

      // ✅ Check if user is actually in this room
      const playerInRoom = gameRoom.players.find(
        (p) => p.userId.toString() === userId.toString()
      );

      if (!playerInRoom) {
        console.log(`❌ User ${userId} not found in room ${roomId}`);
        socket.emit("error", { message: "You are not in this room" });
        return;
      }

      const wasHost = gameRoom.hostId.toString() === userId.toString();
      console.log(
        `👤 User ${userId} is ${wasHost ? "HOST" : "PLAYER"} in room ${roomId}`
      );

      // ✅ Remove player from room
      gameRoom.players = gameRoom.players.filter(
        (p) => p.userId.toString() !== userId.toString()
      );

      console.log(`📊 Players after remove: ${gameRoom.players.length}`);

      if (gameRoom.players.length === 0) {
        // ✅ Delete empty room completely
        await Game.deleteOne({ roomId });
        io.to(roomId).emit("room_closed");
        timerManager.clearRoomTimer(roomId);
        console.log(`🗑️ Empty room ${roomId} deleted completely`);
      } else {
        // ✅ Assign new host if needed
        if (wasHost && gameRoom.players.length > 0) {
          gameRoom.hostId = gameRoom.players[0].userId;
          io.to(roomId).emit("new_host", {
            newHostId: gameRoom.hostId,
            newHostUsername: gameRoom.players[0].username,
          });
          console.log(`👑 New host assigned: ${gameRoom.players[0].username}`);
        }

        // ✅ Save room changes
        await gameRoom.save();
        io.to(roomId).emit("update_players", gameRoom.players);
        console.log(
          `💾 Room ${roomId} updated with ${gameRoom.players.length} players`
        );
      }

      // ✅ IMPORTANT: Clean up socket data immediately
      socket.leave(roomId);
      socket.data.userId = null;
      socket.data.roomId = null;

      // ✅ Update rooms list
      await sendRooms();

      // ✅ Confirm leave to user
      socket.emit("leave_confirmed", {
        roomId,
        message: "Successfully left the room",
      });

      console.log(`✅ User ${userId} successfully left room ${roomId}`);
    } catch (err) {
      console.error("❌ leave_room error:", err.message);
      socket.emit("error", { message: "Failed to leave room" });
    }
  });

  // ===== GET PLAYERS EVENT =====
  socket.on("get_players", async (roomId) => {
    try {
      if (!roomId) {
        socket.emit("error", { message: "Missing roomId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId });
      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      socket.emit("update_players", gameRoom.players);
      socket.emit("game_phase", gameRoom);

      const timeLeft = timerManager.getTimeLeftForRoom(roomId);
      if (timeLeft !== null) {
        socket.emit("timer_update", { timeLeft });
      }
    } catch (err) {
      console.error("❌ get_players error:", err.message);
      socket.emit("error", { message: "Failed to get players" });
    }
  });

  // ===== GET ROOM INFO EVENT =====
  socket.on("get_room_info", async ({ roomId }) => {
    try {
      if (!roomId) {
        socket.emit("error", { message: "Missing roomId" });
        return;
      }

      const gameRoom = await Game.findOne({ roomId })
        .populate("players.userId", "username avatar")
        .populate("hostId", "username avatar");

      if (!gameRoom) {
        socket.emit("error", { message: "Room not found" });
        return;
      }

      socket.emit("room_info", gameRoom);
      console.log(`ℹ️ Room info sent for ${roomId}`);
    } catch (err) {
      console.error("❌ get_room_info error:", err.message);
      socket.emit("error", { message: "Failed to get room info" });
    }
  });

  // ===== DISCONNECT HANDLER =====
  const handleDisconnect = async (socket) => {
    const { userId, roomId } = socket.data || {};
    console.log(`🔌 User disconnecting: ${userId} from room ${roomId}`);

    if (!userId) return;

    try {
      // ✅ Find ALL rooms user might be in
      const userRooms = await Game.find({ "players.userId": userId });

      for (const gameRoom of userRooms) {
        console.log(`🧹 Cleaning user ${userId} from room ${gameRoom.roomId}`);

        const wasHost = gameRoom.hostId.toString() === userId.toString();

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId.toString()
        );

        if (gameRoom.players.length === 0) {
          // Delete empty room
          await Game.deleteOne({ roomId: gameRoom.roomId });
          io.to(gameRoom.roomId).emit("room_closed");
          timerManager.clearRoomTimer(gameRoom.roomId);
          console.log(`🗑️ Empty room ${gameRoom.roomId} deleted on disconnect`);
        } else {
          // If host disconnected, assign new host
          if (wasHost && gameRoom.players.length > 0) {
            gameRoom.hostId = gameRoom.players[0].userId;
            io.to(gameRoom.roomId).emit("new_host", {
              newHostId: gameRoom.hostId,
              newHostUsername: gameRoom.players[0].username,
            });
            console.log(
              `👑 New host assigned on disconnect: ${gameRoom.players[0].username}`
            );
          }

          await gameRoom.save();
          io.to(gameRoom.roomId).emit("update_players", gameRoom.players);
        }
      }

      // ✅ Update rooms list
      await sendRooms();
      console.log(
        `✅ User ${userId} cleaned from ${userRooms.length} rooms on disconnect`
      );
    } catch (err) {
      console.error("❌ disconnect cleanup error:", err.message);
    }
  };

  // ===== FORCE LEAVE ALL ROOMS (Emergency cleanup) =====
  socket.on("force_leave_all", async ({ userId }) => {
    try {
      console.log(`🚨 Force leaving all rooms for user ${userId}`);

      if (!userId) {
        socket.emit("error", { message: "Missing userId" });
        return;
      }

      const userRooms = await Game.find({ "players.userId": userId });
      let cleanedRooms = 0;

      for (const gameRoom of userRooms) {
        const wasHost = gameRoom.hostId.toString() === userId.toString();

        gameRoom.players = gameRoom.players.filter(
          (p) => p.userId.toString() !== userId.toString()
        );

        if (gameRoom.players.length === 0) {
          await Game.deleteOne({ roomId: gameRoom.roomId });
          io.to(gameRoom.roomId).emit("room_closed");
          timerManager.clearRoomTimer(gameRoom.roomId);
        } else {
          if (wasHost && gameRoom.players.length > 0) {
            gameRoom.hostId = gameRoom.players[0].userId;
            io.to(gameRoom.roomId).emit("new_host", {
              newHostId: gameRoom.hostId,
              newHostUsername: gameRoom.players[0].username,
            });
          }
          await gameRoom.save();
          io.to(gameRoom.roomId).emit("update_players", gameRoom.players);
        }
        cleanedRooms++;
      }

      // Clear socket data
      socket.data.userId = null;
      socket.data.roomId = null;

      await sendRooms();

      socket.emit("force_leave_confirmed", {
        message: `Cleaned from ${cleanedRooms} rooms`,
        cleanedRooms,
      });

      console.log(`🧹 Force cleaned user ${userId} from ${cleanedRooms} rooms`);
    } catch (err) {
      console.error("❌ force_leave_all error:", err.message);
      socket.emit("error", { message: "Failed to force leave rooms" });
    }
  });

  // ✅ Return handleDisconnect for use in main socket handler
  return { handleDisconnect };
};
