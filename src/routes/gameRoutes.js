import express from 'express';
import {
  createRoom,
  joinRoom,
  getRoomInfo,
  saveGameResult,
  getUserHistory,
  getAllGames, // 👈 import

} from '../controllers/gameController.js';

const router = express.Router();

router.get('/all', getAllGames); // 👈 yangi route

router.post('/create-room', createRoom);
router.put('/join-room/:roomId', joinRoom);
router.get('/room/:roomId', getRoomInfo);
router.post('/save-result', saveGameResult);
router.get('/history/:userId', getUserHistory);

export default router;
