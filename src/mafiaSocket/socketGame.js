import { createRoom, readyGame } from "../mafiaSocket/events/createRoom.js";

export const socketGame = (io) => {
    console.log(`🎮 Game Socket Handler initialized`);

    io.on("connection", (socket) => {
        console.log(`🔌 User connected: ${socket.id}`);

        socket.on("create_room", (data) => createRoom(io, socket, data));
        socket.on("ready", (data) => readyGame(io, socket, data));
    })    
}