// src/controllers/metrics.controler.js
// ============================================================================
// Capa de controlador: su unica mision es traducir una peticion HTTP en la
// respuesta correcta. Toda la logica de negocio vive en los services, asi el
// controller queda delgado ("thin controllers") y facil de razonar.
// ============================================================================

import { collectMetrics } from '../services/metrics.service.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// GET /api/metrics
// async porque el handler espera el reporte antes de responder.
// El tercer parametro `next` permite delegar errores al middleware central.
// ---------------------------------------------------------------------------
export async function getMetrics(req, res, next) {
  try {
    // El trabajo pesado (ping + agregacion) vive en el servicio, no aqui.
    const metrics = await collectMetrics();

    // 200 + JSON: el contrato que consume el frontend (fetch -> json()).
    res.status(200).json(metrics);
  } catch (err) {
    // Cualquier error inesperado pasa a errorHandler (middleware de errores),
    // que se encarga de loggear y devolver un JSON 500 controlado. NUNCA
    // dejamos que una excepcion escape al framework y crashee el proceso.
    logger.error('Error generando metricas', err);
    next(err);
  }
}
