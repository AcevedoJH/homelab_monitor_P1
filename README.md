# 📊 Homelab Monitor

Dashboard de monitorización de servicios en tiempo real para homelab. Backend en Node.js/Express que ejecuta pings HTTP y mide latencia, y frontend en Astro/Tailwind CSS que muestra el estado de cada servicio con actualización automática.

---

## 🏗️ Arquitectura

```
homelab_monitor/
├── backend/                    # API REST (Node.js + Express)
│   ├── src/
│   │   ├── index.js            # Punto de entrada, bootstrap Express
│   │   ├── config/
│   │   │   └── env.js          # Configuración centralizada + validación fail-fast
│   │   ├── services/
│   │   │   ├── ping.service.js # Pings HTTP nativos + medición de latencia
│   │   │   └── metrics.service.js # Orquestador + agregación de métricas
│   │   ├── controllers/
│   │   │   └── metrics.controler.js # Handler HTTP (thin controller)
│   │   ├── middlewares/
│   │   │   ├── rateLimiter.middlewares.js # Rate limiter sliding-window
│   │   │   └── errorHandler.middlewares.js # 404 + handler central de errores
│   │   ├── routes/
│   │   │   └── api.routes.js   # Mount de rutas bajo /api
│   │   └── utils/
│   │       └── logger.js       # Logger minimalista sin dependencias
│   ├── .env                    # Variables de entorno locales (gitignoreado)
│   ├── .env.example            # Plantilla de configuración
│   └── package.json
│
└── frontend/
    └── public/
        └── src/
            ├── astro.config.mjs    # Config Astro (static output + Tailwind)
            ├── tailwind.config.mjs # Tema dark + colores de estado
            ├── package.json
            ├── tsconfig.json
            ├── styles/
            │   └── global.css      # Imports Tailwind + componentes custom
            ├── layouts/
            │   └── BaseLayout.astro # Layout base HTML
            ├── components/
            │   ├── Header.astro      # Cabecera con resumen + controles
            │   ├── MetricCard.astro  # Tarjeta individual de servicio
            │   ├── ServiceGrid.astro # Grid adaptativo CSS Grid
            │   └── StatusBadge.astro # Badge de estado (Online/Offline)
            ├── pages/
            │   └── index.astro       # Página principal
            ├── scripts/
            │   └── liveMetrics.js    # Polling cliente (5s interval)
            └── types/
                └── index.ts          # Tipos TypeScript para la API
```

---

## 🧠 Decisiones Técnicas

### Backend

| Decisión | Justificación |
|---|---|
| **Node.js nativo `http`/`https`** (sin `axios` ni `node-fetch`) | Control fino sobre timeouts y errores. Cero dependencias para la capa de red. Educativo y predecible. |
| **`Promise.allSettled`** en el orquestador | Un servicio caído no tumba el reporte entero. Degradación elegante, no explosión. |
| **5 sondas por servicio** (`PROBES=5`) | Permite calcular avg/min/max de latencia y disponibilidad porcentual. Más fiable que una sola medición. |
| **Rate limiter en memoria** (ventana deslizante) | Protege `/api/metrics` de ser golpeado en bucle. Sin dependencias externas. Fácil de migrar a Redis si se escala. |
| **Fail-fast en config** (`env.js`) | Errores de configuración se detectan en arranque, no en medio de una petición. |
| **ESM (`"type": "module"`)** | Módulos nativos de Node.js, sin transpilado. Moderno y alineado con el ecosistema actual. |
| **Express 5.x** | Async handlers auto-forward rejected promises a error middleware, reduciendo boilerplate. |

### Frontend

| Decisión | Justificación |
|---|---|
| **Astro (output: static)** | HTML estático por defecto. El JS se carga solo donde hace falta (islands). Sin hydration innecesaria. |
| **Tailwind CSS** (via `@astrojs/tailwind`) | Utility-first. Consistente con el diseño dark. Sin CSS global espagueti. |
| **`client:load`** para el script de polling | La isla se hidrata inmediatamente al cargar la página. El polling empieza desde el primer segundo. |
| **DOM diffing manual** (no `innerHTML` completo) | Preserva foco del usuario, no reinicia animaciones CSS, más eficiente. |
| **`setTimeout` recursivo** (no `setInterval`) | Evita solapamiento de polls. El intervalo real es 5s entre el **fin** de un poll y el **inicio** del siguiente. |
| **`AbortController`** en fetch | Permite cancelar peticiones colgadas. Timeout de 10s evita que un backend muerto bloquee el ciclo. |
| **Tipos TypeScript** (`types/index.ts`) | Contrato claro entre backend y frontend. Fácil de mantener cuando la API crece. |

### Diseño Visual

| Decisión | Justificación |
|---|---|
| **Dark theme** (`#0A0A0A` fondo, `#111111` cards) | Reduce fatiga visual en monitores oscuros. Contraste suficiente para lectura prolongada. |
| **CSS Grid adaptativo** (1→2→3→4 cols) | Funciona en móvil, tablet, desktop y ultrawide sin media queries manuales en cada componente. |
| **Barra de latencia con colores** | Feedback visual instantáneo: verde (<50ms), amarillo (50-150ms), rojo (>150ms). |
| **Badges Online/Offline/Degradado** | Terminología clara y universal. No requiere interpretación. |

---

## 🚀 Despliegue

### Requisitos

- **Node.js** >= 18
- **npm** >= 9

### Instalación

```bash
# 1. Clonar el repositorio
git clone <repo-url>
cd homelab_monitor

# 2. Configurar el backend
cd backend
cp .env.example .env
# Editar .env: añadir los servicios a monitorizar en MONITOR_SERVICES
npm install

# 3. Configurar el frontend
cd ../frontend/public
npm install

# 4. Construir el frontend (para producción)
npm run build
```

### Ejecución en desarrollo

```bash
# Terminal 1: Backend
cd backend
npm run dev      # Node con --watch (auto-reload)

# Terminal 2: Frontend
cd frontend/public
npm run dev      # Astro dev server en http://localhost:4321
```

### Ejecución en producción

```bash
# Backend
cd backend
npm start        # Node en http://localhost:3000

# Frontend (servir el contenido de dist/ con cualquier servidor estático)
# Ejemplo con nginx:
# location / { root /ruta/a/frontend/public/dist; try_files $uri /index.html; }
```

### Variables de entorno

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto del servidor backend | `3000` |
| `NODE_ENV` | Entorno (`development`/`production`) | `development` |
| `MONITOR_SERVICES` | Lista `nombre=url` separada por comas | — |
| `REQUEST_TIMEOUT_MS` | Timeout por petición HTTP | `5000` |
| `PROBES` | Nº de sondas por servicio | `5` |

---

## 🧪 Pruebas realizadas

### Backend

| Prueba | Resultado |
|---|---|
| `GET /api/health` | ✅ 200 OK, `{"status":"ok","uptimeSec":N}` |
| `GET /api/metrics` (2 servicios up) | ✅ 200 OK, `summary.up=2`, latencias avg/min/max presentes |
| `GET /api/metrics` (servicio caído: ECONNREFUSED) | ✅ `status: "down"`, `lastError: "ECONNREFUSED"`, no rompe el reporte |
| `GET /api/inexistente` | ✅ 404 JSON `{"error":"Not Found","path":"/api/inexistente"}` |
| Rate limit (31 peticiones en <60s) | ✅ 31ª petición devuelve 429 con `Retry-After` header |
| `Promise.allSettled` con un servicio fallando | ✅ El servicio fallado reporta `down`, los demás reportan `up` |
| Sintaxis (`node --check`) | ✅ Todos los archivos pasan la verificación |

### Frontend

| Prueba | Resultado |
|---|---|
| Build estático (`npm run build`) | ✅ 1 página construida, sin errores |
| Dev server (`npm run dev`) | ✅ Responde en `http://localhost:4321` |
| `GET /` (página principal) | ✅ 200 OK, HTML renderizado |
| DOM actualización vía polling | ✅ Badges cambian Online/Offline, barras de latencia se actualizan |
| Botón refresh manual | ✅ Dispara un poll inmediato |
| Toggle auto-refresh | ✅ Activa/desactiva el ciclo de polling |
| Error de red (backend caído) | ✅ Muestra banner de error, reintenta hasta 3 veces |

### End-to-End

| Escenario | Resultado |
|---|---|
| Backend + Frontend corriendo simultáneamente | ✅ Frontend muestra métricas en tiempo real con polling cada 5s |
| Servicios `example.com` y `jsonplaceholder.typicode.com` | ✅ Ambos reportan `status: "up"` con latencia medible |
| Cambiar `MONITOR_SERVICES` en `.env` y reiniciar backend | ✅ El frontend refleja los nuevos servicios en el siguiente poll |

---

## 🔮 Próximos pasos

- **Persistencia histórica**: almacenar métricas en SQLite o InfluxDB para gráficos de tendencias.
- **Sondeo en background**: ejecutar pings en un intervalo interno y servir caché en `/api/metrics` (evitar pings por cada petición).
- **Tests automatizados**: supertest para el backend, Vitest para utilidades.
- **Docker**: `Dockerfile` + `docker-compose.yml` para despliegue containerizado.
- **Autenticación**: proteger la API con token o basic auth si se expone públicamente.
- **Notificaciones**: alertas por Telegram/Discord cuando un servicio cambia a `down`.

---

## 📄 Licencia

MIT
