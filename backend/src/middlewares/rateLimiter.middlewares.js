// src/middlewares/rateLimiter.middlewares.js
// ============================================================================
// Rate limiter en memoria (ventana deslizante) sin dependencias externas.
// Protege /api/metrics de ser golpeada en bucle (p. ej. un frontend buggy o
// un crawler) que lanzaria N pings HTTP por segundo contra tus servicios.
//
// LIMITACION: vive en memoria del proceso; si mañana escalamos a varios
// procesos/replicas, cada uno tendria su propio contador. Para eso el modulo
// ya esta aislado: se cambia el interior por Redis/ioredis sin tocar rutas.
// ============================================================================

const WINDOW_MS = 60_000; // ventana de 1 minuto
const MAX_REQUESTS = 30; // max. peticiones por IP dentro de la ventana

// Almacen: ip -> { hits: [timestamps], resetAt }.
// Usamos Map en vez de objeto simple para evitar problemas con keys tipo
// "__proto__" y porque iterar Map es mas limpio.
const buckets = new Map();

// Limpieza periodica de buckets expirados: si no borramos, el Map creceria
// sin limite con IPs que solo pasaron una vez (memory leak lento).
const CLEANUP_INTERVAL_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [ip, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(ip);
  }
}, CLEANUP_INTERVAL_MS);

export function rateLimiter() {
  return (req, res, next) => {
    // req.ip puede ser una IPv6 como "::ffff:127.0.0.1"; es una key valida.
    // Nota: si servimos detras de un proxy/nginx, hay que activar
    // `app.set('trust proxy', true)` para que req.ip sea la IP real.
    const key = req.ip ?? 'unknown';
    const now = Date.now();

    // Recuperamos el bucket o creamos uno nuevo dentro de la ventana actual.
    const bucket = buckets.get(key) ?? { hits: [], resetAt: now + WINDOW_MS };

    // Podamos timestamps que ya quedaron fuera de la ventana deslizante:
    // "deslizante" significa que la ventana se mide hacia atras desde AHORA,
    // no desde una hora fija (asi no hay picos justo tras el reset).
    bucket.hits = bucket.hits.filter((t) => t > now - WINDOW_MS);

    if (bucket.hits.length >= MAX_REQUESTS) {
      // Cabecera estandar para que los clientes sepan cuando reintentar.
      const retryAfterSec = Math.ceil((bucket.hits[0] + WINDOW_MS - now) / 1000);
      res.set('Retry-After', String(Math.max(1, retryAfterSec)));
      // 429 Too Many Requests: status semantico, no un 500 (el server no fallo).
      return res.status(429).json({ error: 'Too Many Requests', retryAfterSec });
    }

    bucket.hits.push(now); // Registramos esta peticion...
    buckets.set(key, bucket); // ...y guardamos el bucket actualizado.
    next();
  };
}
