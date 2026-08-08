// src/app.js
// ============================================================================
// Configuracion de la aplicacion Express (sin arrancar el servidor).
// Separar `app` de `index.js` (bootstrap) sigue el patron "server vs app":
// permite importar la app en tests de integracion (supertest) sin abrir
// puertos. Aqui viven los middlewares de SEGURIDAD (helmet + CORS estricto)
// y el cableado de rutas; index.js solo escucha en el puerto configurado.
// ============================================================================

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import apiRoutes from './routes/api.routes.js';
import { notFound, errorHandler } from './middlewares/errorHandler.middlewares.js';

export const app = express();

/* Elimina la cabecera X-Powered-By: Express la agrega por defecto y es un
detalle de fingerprinting que no aporta nada (buena practica de hardening).
Helmet tambien la elimina; dejamos el disable explicito para que no dependa
de la configuracion de la libreria.*/
app.disable('x-powered-by');

// ---------------------------------------------------------------------------
// HELMET: cabeceras de seguridad HTTP con politicas estrictas.
// Referencia: https://helmetjs.github.io/
// ---------------------------------------------------------------------------
app.use(
  helmet({
    // CSP para la API: es una API REST que SOLO sirve JSON. No ejecuta
    // scripts, estilos, imagenes ni conexiones; la politica mas estricta es
    // denegarlo TODO (default-src 'none'). Se anaden directivas explicitas
    // para cerrar vectores clasicos (clickjacking, base tag, formularios).
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],          // evita inyeccion de <base>
        formAction: ["'none'"],       // la API no publica formularios
        frameAncestors: ["'none'"],   // nadie puede embeker la API (clickjacking)
        objectSrc: ["'none'"],        // sin plugins/embeds
        frameSrc: ["'none'"],
        upgradeInsecureRequests: [],  // sube HTTP->HTTPS cuando se sirve sobre TLS
      },
    },
    // HSTS: fuerza HTTPS durante 1 ano. El frontend se sirve detras de
    // Cloudflare Tunnel (siempre HTTPS), asi que es seguro y recomendable.
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
    },
    // X-Frame-Options: DENY es mas estricto que el default SAMEORIGIN.
    // (En helmet v8 la opcion es { action: 'deny' }, no un string.)
    xFrameOptions: { action: 'deny' },
    // Referrer-Policy: solo se reenvia el origen al saltar a otro origin.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // X-Content-Type-Options: nosniff. Helmet v8 la fija SIEMPRE a nosniff
    // por defecto y no admite opciones; no la configuramos explicitamente.
    // COOP + CORP: aislamiento de procesos (window.opener) y bloqueo de
    // lectura cross-origin de las respuestas como recurso subordinado.
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    originAgentCluster: true,
    // X-XSS-Protection: se deja el default (0). La cabecera esta OBSOLETA
    // (puede introducir vulnerabilidades en algunos navegadores); OWASP
    // recomienda desactivarla y confiar en la CSP, que aqui es total.
  }),
);

// Permissions-Policy: Helmet v8 ya no emite esta cabecera, asi que la fijamos
// manualmente denegando los APIs potentes que la API no usa (camara,
// microfono, geolocalizacion, pagos, USB...). Valores por defecto = denegado.
app.use((req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  );
  next();
});

// ---------------------------------------------------------------------------
// CORS estricto (whitelist).
// En produccion el navegador habla con el frontend (misma origin via nginx)
// y nunca envia cabecera Origin; el CORS solo se ejerce en desarrollo, cuando
// el frontend (Astro dev, puerto 4321) llama directo al backend (puerto 3000).
// Si el origen no esta en la whitelist, `cors` NO emite
// Access-Control-Allow-Origin y el navegador bloquea la respuesta.
// ---------------------------------------------------------------------------
const allowedOrigins = ['http://localhost:4321', 'http://127.0.0.1:4321'];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
    maxAge: 86400,
    optionsSuccessStatus: 204,
  }),
);

// parsea cuerpos JSON en las peticiones (preparado para POST futuros).
app.use(express.json());

// PRIVACIDAD: la API NO usa sesiones ni cookies de seguimiento. Para
// garantizarlo con minimizacion de datos, eliminamos cualquier cabecera
// Set-Cookie justo antes de enviar la respuesta: si en el futuro una ruta
// intentara crear una cookie (incluso de sesion no esencial), se descarta.
// (El frontend estatico, ademas, no emite ni espera cookies.)
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
