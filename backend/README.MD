# homelab-monitor · Backend

API REST en Node.js + Express para monitorizar servicios mediante pings HTTP y
verificación de latencia. Expone las métricas en `GET /api/metrics` en formato JSON.

## Requisitos

- Node.js >= 18

## Configuración

```bash
cp .env.example .env   # ajusta los valores a tu homelab
```

| Variable | Descripción | Default |
| --- | --- | --- |
| `PORT` | Puerto del servidor HTTP | `3000` |
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `MONITOR_SERVICES` | Lista `nombre=url` separada por comas | — |
| `REQUEST_TIMEOUT_MS` | Timeout por petición HTTP (fail-fast) | `5000` |
| `PROBES` | Nº de sondas por servicio para medir latencia | `5` |

## Ejecución

```bash
npm install
npm run dev     # desarrollo (node --watch)
npm start       # producción
```

## Endpoints

### `GET /api/metrics`

Ejecuta N pings HTTP por servicio y devuelve el reporte agregado:

```json
{
  "schemaVersion": "1.0",
  "timestamp": "2026-08-04T13:09:04.528Z",
  "durationMs": 107,
  "summary": { "total": 2, "up": 2, "degraded": 0, "down": 0, "availability": 100, "avgLatencyMs": 60.9 },
  "services": [
    {
      "name": "example",
      "url": "https://example.com/",
      "status": "up",
      "statusCode": 200,
      "probes": { "total": 5, "succeeded": 5, "availability": 100 },
      "latencyMs": { "avg": 43.3, "min": 38.2, "max": 56.2 },
      "lastError": null,
      "checkedAt": "2026-08-04T13:09:04.482Z"
    }
  ]
}
```

Estados posibles por servicio:

- `up` — alguna sonda respondió 2xx/3xx.
- `degraded` — responde con 4xx (auth, 404…).
- `down` — 5xx, timeout o fallo de red (ECONNREFUSED, DNS…).

Limitado a 30 peticiones/min por IP (`429 Too Many Requests`).

### `GET /api/health`

Healthcheck ligero (no dispara pings remotos). Para orquestadores/load balancers.

## Estructura

```
src/
  config/       env.js          # carga y validación de configuración
  controllers/  metrics.*.js    # traduce HTTP <-> servicio
  middlewares/  rateLimiter.*   # límite de peticiones por IP
                errorHandler.*  # 404 + manejo central de errores
  routes/       api.routes.js   # montaje de rutas bajo /api
  services/     ping.service.js # pings HTTP + medición de latencia
                metrics.service.js # orquestación y agregación
  utils/        logger.js       # logger minimalista sin dependencias
  index.js                      # bootstrap de Express + graceful shutdown
```

## Notas de diseño

- **Sin dependencias de red para el ping**: usa `node:http`/`node:https`,
  con control explícito de timeout y captura central de errores (`'error'`).
- **Degradación, no explosión**: `Promise.allSettled` en el orquestador evita
  que la caída de un servicio tumbe el reporte completo.
- **Config validada al arrancar (fail-fast)**: errores de configuración se
  detectan en `npm start`, no en medio de una petición.
- El rate limiter es en memoria (por proceso); para múltiples réplicas migrar
  a Redis sin tocar las rutas.

## Próximos pasos sugeridos

- Persistencia de histórico de métricas (p. ej. SQLite/InfluxDB) para tendencias.
- Intervalo de sondeo en background + caché (evitar pings por cada petición).
- Tests de integración con supertest (el módulo `src/index.js` exporta `app`).
