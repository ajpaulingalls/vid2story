import { Router } from 'express';
import {
  getVideoById,
  updateVideoTranscript,
} from '../controllers/videoController';

const router = Router();

router.get('/:id', getVideoById);
router.post('/:id/transcript', updateVideoTranscript);

export default router;
