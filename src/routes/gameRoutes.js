import express from 'express';
import {
  createRoom,
  joinRoom,
  getRoomInfo,
  saveGameResult,
  getUserHistory,
  getAllGames,
} from '../controllers/gameController.js';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Game
 *   description: Game management endpoints
 */

/**
 * @swagger
 * /api/game/all:
 *   get:
 *     summary: Get all games
 *     tags: [Game]
 *     responses:
 *       200:
 *         description: List of all games
 */
router.get('/all', getAllGames);

/**
 * @swagger
 * /api/game/create-room:
 *   post:
 *     summary: Create a new game room
 *     tags: [Game]
 *     responses:
 *       201:
 *         description: Room created successfully
 */
router.post('/create-room', createRoom);

/**
 * @swagger
 * /api/game/join-room/{roomId}:
 *   put:
 *     summary: Join an existing game room
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *         description: Room ID to join
 *     responses:
 *       200:
 *         description: Joined room successfully
 */
router.put('/join-room/:roomId', joinRoom);

/**
 * @swagger
 * /api/game/room/{roomId}:
 *   get:
 *     summary: Get room information
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Room information
 */
router.get('/room/:roomId', getRoomInfo);

/**
 * @swagger
 * /api/game/save-result:
 *   post:
 *     summary: Save game result
 *     tags: [Game]
 *     responses:
 *       201:
 *         description: Game result saved
 */
router.post('/save-result', saveGameResult);

/**
 * @swagger
 * /api/game/history/{userId}:
 *   get:
 *     summary: Get game history for a user
 *     tags: [Game]
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User game history
 */
router.get('/history/:userId', getUserHistory);

export default router;
