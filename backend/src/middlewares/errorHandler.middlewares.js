// src/middlewares/errorHandler.middlewares.js
// ============================================================================
// Manejo centralizado de errores. Un unico lugar para loggear y formatear
// respuestas de error => consistencia en toda la API y menos codigo duplicado
// en cada controlador (los controladores solo hacen next(err)).
//
// REGLA DE ORO en Express: el middleware de errores DEBE tener 4 parametros
// (err, req, res, next). Si firma 3, Express lo trata como normal y las
// excepciones caerian fuera de la cadena.
// ============================================================================

import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// 404 para rutas inexistentes. Debe registrarse DESPUES de las rutas validas
// porque Express ejecuta middlewares en orden de registro.
// ---------------------------------------------------------------------------
export function notFound(req, res) {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
}

// ---------------------------------------------------------------------------
// Handler de errores global (se registra SIEMPRE al final de la cadena).
// ---------------------------------------------------------------------------
export function errorHandler(err, req, res, next) {
  // Algunas librerias setean err.status o err.statusCode; lo respetamos.
  // Cualquier otra cosa que no declare status se trata como 500.
  const status = err.status ?? err.statusCode ?? 500;

  // Los errores 5xx son del SERVIDOR: siempre se loguean a nivel error para
  // que el equipo pueda actuar. Los 4xx son culpa del cliente: log debug basta
  // (es ruido normal si no los logueamos a nivel error).
  if (status >= 500) {
    logger.error(`[${req.method} ${req.originalUrl}]`, err);
  } else {
    logger.warn(`[${req.method} ${req.originalUrl}]`, { status, message: err.message });
  }

  // Nunca filtramos el detalle interno en 5xx: no queremos filtrar stack
  // traces ni rutas del filesystem a clientes externos (seguridad).
  const body = status >= 500 ? { error: 'Internal Server Error' } : { error: err.message };

  // next(err) no se llama aqui a proposito: si el propio handler de errores
  // fallara, Express caeria en su default (HTML). Preferimos responder 500.
  res.status(status).json(body);
}
