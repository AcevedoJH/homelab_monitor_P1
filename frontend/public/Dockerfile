# ============================================================================
# Dockerfile del frontend (Astro + Tailwind, build estático)
# Solución definitiva al "JavaScript heap out of memory" con Multi-Stage Build.
#
#   deps    → instala dependencias (npm ci) en capa cacheable aislada
#   builder → compila el sitio con heap V8 acotado (NODE_OPTIONS)
#   runner  → nginx con usuario NO root (nodejs:1001), solo el artefacto estático
#
# Referencias:
#   - https://stackoverflow.com/questions/67903114/javascript-heap-out-of-memory-in-docker-image-run
#   - https://dev.to/asta_dev/fixing-javascript-heap-out-of-memory-during-production-builds-elb
#   - https://community.fly.io/t/running-out-of-memory-when-building-docker-image-npm/21920
#   - https://forums.docker.com/t/getting-error-as-cannot-allocate-memory-for-creation-of-docker-image-during-npm-install-legacy-peer-deps/146697
# ============================================================================

# ------------------ STAGE 1: deps (dependencias) ------------------
FROM node:24-alpine AS deps

WORKDIR /app

# Solo los manifiestos → capa Docker cacheable.
# package-lock.json* (opcional): si existe se usa `npm ci` (instalación
# reproducible y determinista). Si aún no está commiteado en esta carpeta,
# cae a `npm install`. Para producción estricta, commitea el lockfile.
COPY package.json package-lock.json* ./

RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

# ------------------ STAGE 2: builder (compilación) ------------------
FROM node:24-alpine AS builder

# Heap V8 ACOTADO durante el build (2 GB).
# Evita que Astro/Vite consuman toda la RAM del servidor y lancen
# "JavaScript heap out of memory" en builds grandes o VMs con poca memoria.
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Build-arg del frontend (Astro), inyectado desde docker-compose (build.args).
# Equivale a NEXT_PUBLIC_API_URL en Next.js. Hoy la app usa ruta relativa /api
# (API_BASE en liveMetrics.js), pero queda listo para sustituir
# import.meta.env.PUBLIC_API_BASE si se requiriera en el futuro.
ARG PUBLIC_API_BASE=
ENV PUBLIC_API_BASE=${PUBLIC_API_BASE}

WORKDIR /app

# Reutilizamos node_modules de la etapa deps (no reinstalamos).
COPY --from=deps /app/node_modules ./node_modules

# Código fuente, configuración y directorio público (publicDir de Astro).
# public/ contiene los assets servidos tal cual (p. ej. scripts/liveMetrics.js).
# NOTA: solo lo que vive en public/ se copia a dist/ en el build.
COPY package.json astro.config.mjs tailwind.config.mjs tsconfig.json ./
COPY src ./src
COPY public ./public

# Genera el sitio estático optimizado en /app/dist.
RUN npm run build

# ------------------ STAGE 3: runner (nginx no-root) ------------------
FROM nginx:1.27-alpine AS runner

# Usuario de sistema SIN privilegios (equivalente a nextjs:1001 en Next.js).
# uid/gid 1001 estándar para apps de contenedor; no es root, no puede
# escalar privilegios desde el proceso servido.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nodejs

# Config: sirve el static + proxy inverso /api -> backend (misma origin).
# nginx.conf se copia a conf.d (se carga como virtual host por defecto) y el
# snippet security-headers.conf a snippets/ para que nginx.conf lo incluya en
# los locations de contenido estático (ver comentario de add_header en nginx.conf).
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# ÚNICO artefacto del builder: el build estático optimizado (como
# .next/static + public en Next.js). Nada de node_modules ni código fuente.
COPY --from=builder /app/dist /usr/share/nginx/html

# Ajustes para correr nginx como usuario nodejs (no-root):
#   - pid file en /tmp (escribible por usuario no-root)
#   - escucha en 8080 (>1024, no requiere bind con root)
#   - raíz web, caché y logs propiedad de nodejs
RUN sed -i 's|pid .*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && chown -R nodejs:nodejs /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /tmp

# Puerto interno de nginx (no-root). Se mapea a ${FRONTEND_PORT:-4321} en host.
EXPOSE 8080

# Cambiar al usuario no privilegiado ANTES del CMD.
USER nodejs

# Entrada estándar de nginx (master como PID 1, daemon off para Docker).
CMD ["nginx", "-g", "daemon off;"]