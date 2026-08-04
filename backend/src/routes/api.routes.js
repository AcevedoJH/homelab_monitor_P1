// src/routes/api.routes.js
// ============================================================================
// Montaje de rutas bajo el prefijo /api. Un archivo dedicado permite agregar
// nuevos recursos (p. ej. /api/history, /api/services) sin tocar index.js.
// ============================================================================

import { Router } from 'express';
import { getMetrics } from '../controllers/metrics.controller.js';
import { rateLimiter } from '../middlewares/rateLimiter.middlewares.js';

// Router es un middleware "composable": se monta en la app con app.use('/api', ...).
const router = Router();

// GET /api/metrics
// El rateLimiter se aplica SOLO a esta ruta (proteccion donde hace falta)
// y no a toda la app. Cada peticion a /api/metrics dispara pings HTTP, por
// eso es la ruta que necesita limite de frecuencia.
router.get('/metrics', rateLimiter(), getMetrics);

export default router;
