import { Router } from 'express';
import type { RequestHandler } from 'express';
import { convertToPortrait } from '../controllers/convertController';

const router = Router();

router.post('/convertToPortrait', convertToPortrait as RequestHandler);

export default router; 