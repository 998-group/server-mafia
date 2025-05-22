import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes.js';
import gameRoutes from './routes/gameRoutes.js';

const app = express();

// 🌐 Middleware
app.use(cors());
app.use(express.json());

// 🛣 API marshrutlar
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);

// 🔁 Default route (optional)
app.get('/', (req, res) => {
  res.send('🎮 Mafia Game API is running...');
});

export default app;
