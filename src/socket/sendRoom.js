import  express  from 'express'
import Game from '../models/Game'

export const sendRooms = async () => {
        try {
          const rooms = await Game.find({ players: { $not: { $size: 0 } } })
            .sort({ createdAt: -1 })
            .limit(100);
          io.emit("update_rooms", rooms);
        } catch (err) {
          console.error("❌ sendRooms error:", err.message);
        }
}


