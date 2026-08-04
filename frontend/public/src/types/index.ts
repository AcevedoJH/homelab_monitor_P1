// src/types/index.ts
// ============================================================================
// Tipos TypeScript para la respuesta de la API /api/metrics.
// Separar los tipos en su propio archivo permite compartirlos entre
// componentes Astro (servidor) y scripts cliente (navegador) sin duplicar.
// ============================================================================

// Estados posibles de un servicio según la lógica del backend
export type ServiceStatus = 'up' | 'degraded' | 'down';

// Métricas de latencia agregadas (promedio, mínimo, máximo en ms)
export interface LatencyMetrics {
  avg: number | null;
  min: number | null;
  max: number | null;
}

// Contadores de sondas (probes) por servicio
export interface ProbeMetrics {
  total: number;
  succeeded: number;
  availability: number; // porcentaje 0-100
}

// Un servicio individual en la respuesta
export interface ServiceMetric {
  name: string;
  url: string;
  status: ServiceStatus;
  statusCode: number | null;
  probes: ProbeMetrics;
  latencyMs: LatencyMetrics | null;
  lastError: string | null;
  checkedAt: string; // ISO 8601
}

// Resumen global de la flota
export interface SummaryMetrics {
  total: number;
  up: number;
  degraded: number;
  down: number;
  availability: number; // porcentaje 0-100
  avgLatencyMs: number | null;
}

// Respuesta completa de GET /api/metrics
export interface MetricsResponse {
  schemaVersion: string;
  timestamp: string; // ISO 8601
  durationMs: number; // tiempo que tardó el backend en generar el reporte
  summary: SummaryMetrics;
  services: ServiceMetric[];
}

// Tipos para el polling del cliente
export interface PollConfig {
  intervalMs: number;        // cada cuánto refrescar (default 30s)
  maxRetries: number;        // reintentos tras error de red
  retryDelayMs: number;      // backoff entre reintentos
}

// Eventos que emite el módulo liveMetrics (para desacoplar UI de lógica)
export type MetricsEventType =
  | 'loading'      // iniciando petición
  | 'success'      // datos recibidos OK
  | 'error'        // fallo de red/HTTP
  | 'retrying';    // reintentando tras fallo

export interface MetricsEvent {
  type: MetricsEventType;
  payload?: MetricsResponse | Error;
  retryCount?: number;
}