import express from 'express';
import jobRoutes from './routes/jobRoutes';
import convertRoutes from './routes/convertRoutes';
import videoRoutes from './routes/videoRoutes';
import { errorHandler } from './middlewares/errorHandler';

const app = express();

app.use(express.json());

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Routes
app.use('/api/jobs', jobRoutes);
app.use('/api', convertRoutes);
app.use('/api/videos', videoRoutes);

// Global error handler (should be after routes)
app.use(errorHandler);

export default app;