// src/services/ping.service.js
// ============================================================================
// Responsabilidad: realizar pings HTTP a una URL y medir la latencia.
// Usamos los modulos nativos `http`/`https` de Node (sin dependencias extra)
// porque nos dan control fino sobre timeouts y errores, algo que `fetch`
// global no expone con tanta claridad para medir tiempos de red.
//
// Regla clave: esta capa NUNCA lanza. Siempre resuelve un objeto estructurado
// { ok, ... }. Asi, un servicio caido no rompe la cadena de peticiones y el
// orquestador (metrics.service.js) puede reportar la caida como dato.
// ============================================================================

import http from 'node:http';
import https from 'node:https';

// Redondea a un decimal para que las metricas sean legibles y compactas
// (una latencia con 15 decimales no aporta informacion, solo ruido).
const round1 = (n) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// pingOnce(url, timeoutMs): UNA sola sonda HTTP
// Envuelve la API de callbacks de Node en una Promise para poder usar
// async/await y Promise.all desde el orquestador.
// ---------------------------------------------------------------------------
function pingOnce(url, timeoutMs) {
  return new Promise((resolve) => {
    // `performance.now()` es un reloj de alta resolucion (ms con sub-ms de
    // precision), a diferencia de Date.now() que solo tiene resolucion de ms
    // y ademas depende del reloj del sistema (que puede saltar).
    const startedAt = performance.now();

    // `url` llega como STRING desde la configuracion. Lo convertimos a objeto
    // URL aqui (no en env.js) para no acoplar la configuracion al transporte:
    // asi el servicio de pings es el unico sitio que conoce como se envia la
    // peticion.
    let target;
    try {
      target = new URL(url);
    } catch {
      // URL invalida: resolvemos como fallo estructurado en vez de lanzar
      // (regla de la capa: nunca lanzar, siempre devolver un resultado).
      return resolve({ ok: false, statusCode: null, statusMessage: null, latencyMs: null, error: 'URL invalida' });
    }

    // Elegimos el modulo segun el protocolo: https para puerto 443/TLS.
    const lib = target.protocol === 'https:' ? https : http;

    // Construimos el options MANUALMENTE a partir del URL. No se le pasa el
    // objeto URL completo porque http/https usan su propiedad `protocol` para
    // autovalidarse y lanzarian "Protocol https not supported" al mezclar
    // protocolos. hostname/path son agnosticos y funcionan en ambos modulos.
    const reqOptions = {
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`, // incluye query string si existe
      method: 'GET',
      headers: { 'User-Agent': 'homelab-monitor/0.1', Accept: '*/*' },
      maxRedirects: 0, // No seguimos redirecciones: un 3xx ya indica que el servicio responde.
    };

    // http.get() es una peticion GET simplificada. El callback se dispara al
    // recibir las CABECERAS de respuesta (aun sin el cuerpo completo), que es
    // justo lo que necesitamos para saber si el servicio esta vivo.
    const req = lib.get(reqOptions, (res) => {
      const latencyMs = round1(performance.now() - startedAt);

      // drenar el cuerpo evita que Node deje conexiones abiertas (memory/conn
      // leaks en agentes HTTP reutilizables). Solo leemos las cabeceras.
      res.resume();

      resolve({ ok: true, statusCode: res.statusCode, statusMessage: res.statusMessage, latencyMs, error: null });
    });

    // Timeout: si el servicio no responde en X ms, destruimos la peticion.
    // Sin esto, una IP que "no responde" mantendria sockets colgados y
    // agotaria los recursos del proceso (tiempo maximo = REQUEST_TIMEOUT_MS).
    req.setTimeout(timeoutMs, () => {
      // destroy(new Error()) emite el evento 'error' con nuestro mensaje,
      // centralizando asi el manejo del timeout en el handler de abajo.
      req.destroy(new Error(`timeout tras ${timeoutMs}ms`));
    });

    // 'error' cubre TODOS los fallos de red: ECONNREFUSED, DNS_ENOTFOUND,
    // ECONNRESET, timeout (via el destroy anterior), etc. Un unico punto de
    // manejo de errores => menos codigo duplicado y menos bugs.
    req.on('error', (err) => {
      resolve({
        ok: false,
        statusCode: null,
        statusMessage: null,
        latencyMs: round1(performance.now() - startedAt), // tiempo hasta el fallo
        error: err.code || err.message, // p. ej. "ECONNREFUSED", mas corto de interpretar
      });
    });
  });
}

// ---------------------------------------------------------------------------
// pingService(service, options): N sondas + calculo de metricas de latencia
// Con varias sondas podemos distinguir "caido de verdad" de "fallo puntual"
// (flap), y ademas ofrecer latencia promedio/min/max (la [latencia][5] que
// pide la especificacion).
// ---------------------------------------------------------------------------
export async function pingService(service, { probes = 5, timeoutMs = 5000 } = {}) {
  const n = Math.max(1, Math.min(probes, 20)); // limitamos las sondas para no abusar del host remoto.

  // Lanzamos las N sondas EN PARALELO: mas rapido que en serie (serie podria
  // tomar N * timeout). Como pingOnce nunca rechaza, Promise.all no fallara.
  const results = await Promise.all(Array.from({ length: n }, () => pingOnce(service.url, timeoutMs)));

  // Solo medimos latencia sobre sondas que obtuvieron respuesta HTTP; una
  // sonda que fallo no tiene latencia que promediar.
  const withResponse = results.filter((r) => r.ok);
  const latencies = withResponse.map((r) => r.latencyMs);
  const successCount = withResponse.length;

  // Clasificacion de estado (politica explicita y documentada):
  //   up       -> alguna sonda respondio con 2xx/3xx (servicio sano).
  //   degraded -> responde pero con errores HTTP 4xx (auth, 404...).
  //   offline  -> cualquier sonda fallo con error de red/timeout
  //              (ECONNREFUSED, DNS_ENOTFOUND, timeout...). No hay
  //              conectividad con el servicio.
  //   down     -> alguna sonda respondio con 5xx (servicio existe pero
  //              esta devolviendo errores internos).
  //
  // Nota: "offline" es mas preciso que "down" para fallos de red
  // porque comunica al operador que el problema es de conectividad
  // (red, firewall, servicio caido), no de que el servidor responde
  // con errores HTTP 5xx.
  const hasUp = withResponse.some((r) => r.statusCode >= 200 && r.statusCode < 400);
  const hasDegraded = withResponse.some((r) => r.statusCode >= 400 && r.statusCode < 500);
  const hasDown = withResponse.some((r) => r.statusCode >= 500);

  let status;
  if (hasUp) {
    status = 'up';
  } else if (hasDegraded) {
    status = 'degraded';
  } else if (hasDown) {
    status = 'down';
  } else {
    // Ninguna sonda obtuvo respuesta HTTP: error de red, timeout
    // o DNS. El servicio esta "offline" (no alcanzable).
    status = 'offline';
  }

  // Ultima respuesta (la mas reciente) para dar contexto al operador.
  const last = results[results.length - 1];

  return {
    name: service.name,
    url: service.url,
    status,
    statusCode: last.ok ? last.statusCode : null,
    probes: {
      total: n,
      succeeded: successCount,
      availability: Math.round((successCount / n) * 100), // % de sondas exitosas
    },
    // Si no hubo respuesta medible, latencia es null (el JSON lo hace explicito).
    latencyMs: latencies.length
      ? {
          avg: round1(latencies.reduce((a, b) => a + b, 0) / latencies.length),
          min: round1(Math.min(...latencies)),
          max: round1(Math.max(...latencies)),
        }
      : null,
    lastError: last.ok ? null : last.error, // "ECONNREFUSED", "timeout..." etc.
    checkedAt: new Date().toISOString(),
  };
}
