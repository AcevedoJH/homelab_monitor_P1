// src/index.js
// ============================================================================
// Bootstrap de la aplicacion: arranca el servidor HTTP con la app importada
// de ./app.js. Mantener este archivo delgado hace que `app` (configurada en
// app.js) sea importable en tests de integracion sin abrir un puerto
// (patron "server vs app").
// ============================================================================

import { config } from './config/env.js';
import { app } from './app.js';
import logger from './utils/logger.js';

/* ---------------------------------------------------------------------------
Arranque del servidor (solo si se ejecuta directamente, no al importar).
El check con import.meta.url permite que tests importen `app` sin abrir
un puerto (evita conflictos de puerto en CI).
--------------------------------------------------------------------------- */
const isMainModule = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isMainModule) {
    const server = app.listen(config.port, () => {
    logger.info(`homelab-monitor API escuchando en http://localhost:${config.port}`);
    logger.info(`Servicios monitorizados: ${config.services.map((s) => s.name).join(', ') || 'ninguno'}`);
    });

/* -------------------------------------------------------------------------
Apagado gracioso: en lugar de que el OS mate el proceso, atrapamos las
senales y cerramos el servidor limpiamente (deja terminar peticiones en
curso y no pierde conexiones). Requerido en entornos containerizados
(Docker envía SIGTERM al hacer stop).
-------------------------------------------------------------------------*/
    const shutdown = (signal) => {
    logger.info(`Recibida senal ${signal}, cerrando servidor...`);
    server.close(() => {
        logger.info('Servidor cerrado correctamente.');
      process.exit(0); // 0 = exito, avisa al orquestador que salio bien.
    });

    /* Escape hatch: si algo bloquea el cierre, forzamos salida para no dejar
    un proceso zombi en el contenedor.*/
    setTimeout(() => process.exit(1), 10_000).unref();
    };

  process.on('SIGINT', () => shutdown('SIGINT')); // Ctrl+C en terminal.
  process.on('SIGTERM', () => shutdown('SIGTERM')); // docker stop / kill normal.
}
