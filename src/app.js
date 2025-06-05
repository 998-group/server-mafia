// src/app.js
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './config/swagger.js';
import authRoutes from './routes/authRoutes.js'; // Make sure this file exports your routes

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Swagger endpoint
app.use("/api-docs/mafia_998", swaggerUi.serve, swaggerUi.setup(swaggerSpec));


// Your API routes
app.use("/api/auth", authRoutes);

export default app;
