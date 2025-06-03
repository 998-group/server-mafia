import express from 'express';
import cors from 'cors';
import authRoutes from '../routes/authRoutes.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from '../config/swagger.js';

// import gameRoutes from '../routes/gameRoutes.js';

const app = express();

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// 🌐 Middleware
app.use(cors());
app.use(express.json());

// 🛣 API marshrutlar
app.use('/api/auth', authRoutes); 
// app.use('/api/game', gameRoutes);

// 🔁 Default route (optional)
app.get('/', (req, res) => {
  res.send('🎮 Mafia Game API is running...');
});

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));


export default app;
