// src/index.js
// ============================================================================
// Punto de entrada de la aplicacion: monta Express, conecta middlewares y
// rutas, y arranca el servidor. Mantenerlo delgado hace que la mayoria de la
// logica viva en modulos importables (facil de testear con supertest, por
// ejemplo, importando `app` sin levantar el servidor).
// ============================================================================

import express from 'express';
import { config } from './config/env.js';
import apiRoutes from './routes/api.routes.js';
import { notFound, errorHandler } from './middlewares/errorHandler.middlewares.js';
import logger from './utils/logger.js';

/* Crear la app y el handler por separado es el patron "server vs app":
`app` (sin listen) se exporta para tests de integracion.*/
export const app = express();

/* Elimina la cabecera X-Powered-By: Express la agrega por defecto y es un
detalle de fingerprinting que no aporta nada (buena practica de hardening).*/
app.disable('x-powered-by');

// parsea cuerpos JSON en las peticiones (preparado para POST futuros).
app.use(express.json());

// PRIVACIDAD: la API NO usa sesiones ni cookies de seguimiento. Para
// garantizarlo con minimizacion de datos, eliminamos cualquier cabecera
// Set-Cookie justo antes de enviar la respuesta: si en el futuro una ruta
// intentara crear una cookie (incluso de sesion no esencial), se descarta.
// (El frontend estático, ademas, no emite ni espera cookies.)
app.use((req, res, next) => {
    const originalWriteHead = res.writeHead;
    res.writeHead = function patchedWriteHead(status, ...args) {
        this.removeHeader('Set-Cookie');
        // si las cabeceras van como objeto, tambien se limpian ahi.
        if (args[0] && typeof args[0] === 'object') {
            delete args[0]['Set-Cookie'];
        }
        return originalWriteHead.call(this, status, ...args);
    };
    next();
});

// CORS: whitelist con localhost Y 127.0.0.1 (el navegador los trata como
// orígenes distintos). Si el origen de la petición no está permitido,
// no se envía la cabecera y el navegador bloquea el fetch (síntoma típico:
// el grid se queda en "Sin servicios configurados").
const allowedOrigins = ['http://localhost:4321', 'http://127.0.0.1:4321'];
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

/* healthcheck estandar para orquestadores/load balancers: no golpea servicios
remotos, por eso no pasa por el rate limiter ni por el servicio de pings.*/
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

// Todas las rutas de negocio bajo /api (ver api.routes.js).
app.use('/api', apiRoutes);

// Middlewares de cierre DEBEN ir despues de las rutas (orden de registro).
app.use(notFound); // 404 para lo que no matcheo ninguna ruta.
app.use(errorHandler); // captura errores de cualquier handler anterior.

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
