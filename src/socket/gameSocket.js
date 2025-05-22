const rooms = {}; // roomId: { players: [], phase: 'waiting' | 'night' | 'day' }

export const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log(`🔌 Socket connected: ${socket.id}`);
  });
};
