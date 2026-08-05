// src/routes/api.routes.js
// ============================================================================
// Montaje de rutas bajo el prefijo /api. Un archivo dedicado permite agregar
// nuevos recursos (p. ej. /api/history, /api/services) sin tocar index.js.
// ============================================================================

import { Router } from 'express';
import { getMetrics } from '../controllers/metrics.controller.js';
import { getServices, createService, deleteService } from '../controllers/services.controller.js';
import { rateLimiter } from '../middlewares/rateLimiter.middlewares.js';

// Router es un middleware "composable": se monta en la app con app.use('/api', ...).
const router = Router();

// GET /api/v1/metrics
// El rateLimiter se aplica SOLO a esta ruta (proteccion donde hace falta)
// y no a toda la app. Cada peticion a /api/metrics dispara pings HTTP, por
// eso es la ruta que necesita limite de frecuencia.
router.get('/v1/metrics', rateLimiter(), getMetrics);

// Gestion de servicios dinamicos (agregados/eliminados desde la interfaz):
//   GET    /api/v1/services         -> listar (estaticos + dinamicos)
//   POST   /api/v1/services         -> agregar { name?, url }
//   DELETE /api/v1/services/:id     -> eliminar por id
// Estas rutas no llevan rate limiter porque no disparan pings (solo persisten).
router.get('/v1/services', getServices);
router.post('/v1/services', createService);
router.delete('/v1/services/:id', deleteService);

export default router;
