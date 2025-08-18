import { Router } from 'express';
import { getVideoById } from '../controllers/videoController';

const router = Router();

router.get('/:id', getVideoById);

export default router;
