// src/services/metrics.service.js
// ============================================================================
// Orquestador: junta configuracion + ping + agregacion para construir el
// payload final que se expone en GET /api/metrics.
// Separar "orquestar" (aqui) de "medir" (ping.service) y "exponer"
// (controller) mantiene cada unidad pequena, testeable e intercambiable.
// ============================================================================

import { config } from '../config/env.js';
import { pingService } from './ping.service.js';
import { getAllServices } from './services.store.js';

// ---------------------------------------------------------------------------
// collectMetrics(): ejecuta el ping de TODOS los servicios y agrega el resumen
// ---------------------------------------------------------------------------
export async function collectMetrics() {
  const startedAt = performance.now();

  // Combina servicios estaticos (.env) + dinamicos (agregados via UI).
  // Promise.allSettled (a diferencia de Promise.all) nunca rechaza aunque un
  // servicio falle: la caida de UN servicio NO debe tumbar el reporte entero.
  // Este es el patron correcto para monitorizacion distribuida: degradar, no
  // explotar.
  const allServices = getAllServices();
  const settled = await Promise.allSettled(
    allServices.map((service) => pingService(service, { probes: config.probes, timeoutMs: config.requestTimeoutMs })),
  );

  // Transformamos cada resultado: si la promesa fue rechazada (algo salio MUY
  // mal, p. ej. un bug en el servicio de ping), lo convertimos en una metricas
  // de fallo con el motivo, en vez de propagar la excepcion. Propagamos id y
  // `managed` del servicio original para que el frontend sepa cual es borrable.
  const services = settled.map((entry, index) => {
    const src = allServices[index];
    const base = { id: src.id ?? null, managed: src.managed ?? false };
    if (entry.status === 'fulfilled') return { ...base, ...entry.value };
    return {
      ...base,
      name: src.name,
      url: src.url,
      status: 'down',
      statusCode: null,
      probes: { total: config.probes, succeeded: 0, availability: 0 },
      latencyMs: null,
      lastError: entry.reason?.message ?? 'error inesperado al sondear',
      checkedAt: new Date().toISOString(),
    };
  });

  // --- Agregacion a nivel de flota -------------------------
  const total = services.length;
  const up = services.filter((s) => s.status === 'up').length;
  const degraded = services.filter((s) => s.status === 'degraded').length;
  const down = services.filter((s) => s.status === 'down').length;

  // Promedio de latencia entre los servicios que reportaron dato. Redondeado
  // a 2 decimales para mantener el JSON compacto.
  const latencies = services.flatMap((s) => (s.latencyMs ? [s.latencyMs.avg] : []));
  const avgLatencyMs = latencies.length ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100 : null;

  return {
    // schemaVersion permite al frontend migrar el parser cuando cambie el
    // contrato de la API (buena practica de versionado de payloads).
    schemaVersion: '1.0',
    timestamp: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt), // cuanto tardo en generar el reporte
    summary: {
      total,
      up,
      degraded,
      down,
      availability: total ? Math.round((up / total) * 100) : 0, // % global de servicios sanos
      avgLatencyMs,
    },
    services,
  };
}
