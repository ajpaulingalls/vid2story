import { Router } from 'express';
import type { RequestHandler } from 'express';
import { addCaptions, captionsComplete, convertToPortrait } from '../controllers/convertController';

const router = Router();

router.post('/convertToPortrait', convertToPortrait as RequestHandler);
router.post('/addCaptions', addCaptions as RequestHandler);
router.post('/captionsComplete', captionsComplete as RequestHandler);

export default router; 