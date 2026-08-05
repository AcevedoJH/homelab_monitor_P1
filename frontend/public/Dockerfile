# ============================================================================
# Dockerfile del frontend (Astro + Tailwind, build estático)
# Refactor de producción con Multi-Stage Build en 3 etapas aisladas:
#
#   deps    → instala dependencias (capa cacheable por separado)
#   builder → compila el sitio estático con memoria V8 ampliada
#   runner  → nginx no-root que sirve el static + proxy /api al backend
#
# Beneficios:
#   - La imagen final solo contiene el static y nginx: sin node_modules,
#     sin código fuente, sin herramientas de build.
#   - Si falla la memoria durante la compilación, la etapa builder ya está
#     blindada con NODE_OPTIONS (ver NODE_OPTIONS abajo).
#   - El runner corre con usuario sin privilegios (nginx), hardening por
#     defecto: un exploit no tiene permisos root en el contenedor.
# ============================================================================

# ------------------ STAGE 1: deps (dependencias) ------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Solo los manifiestos → capa Docker cacheable.
# Si package.json no cambia, este paso no se re-ejecuta en builds siguientes.
COPY package.json ./
# Nota: no hay package-lock.json junto a package.json; usamos `npm install`.
RUN npm install --no-audit --no-fund

# ------------------ STAGE 2: builder (compilación) ------------------
FROM node:20-alpine AS builder

# Memoria V8 ampliada durante el build (3 GB).
# Astro/Vite pueden exceder el heap por defecto en servidores con poca RAM o
# en builds grandes → "JavaScript heap out of memory". Este límite lo evita.
# Referencias:
#   - https://stackoverflow.com/questions/56982005/where-do-i-set-node-options-max-old-space-size-2048
#   - https://hafiqiqmal93.medium.com/why-npm-run-build-still-kills-your-low-memory-server-in-2026-7371b6778bb9
ENV NODE_OPTIONS="--max-old-space-size=3072"

# Variables de build (opcionales) inyectadas desde docker-compose (build.args).
# El frontend usa ruta relativa /api, así que hoy no las consume; quedan listas
# para sustituir import.meta.env.PUBLIC_* si algún día hiciera falta.
ARG PUBLIC_API_BASE=
ENV PUBLIC_API_BASE=${PUBLIC_API_BASE}

WORKDIR /app

# Reutilizamos node_modules de la etapa deps (no reinstalamos).
COPY --from=deps /app/node_modules ./node_modules

# Código fuente, configuración y scripts públicos.
COPY package.json astro.config.mjs tailwind.config.mjs tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Genera el sitio estático en /app/dist.
RUN npm run build

# ------------------ STAGE 3: runner (nginx no-root) ------------------
FROM nginx:1.27-alpine AS runner

# Config: sirve el static + proxy inverso /api -> backend (misma origin).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Único artefacto necesario del builder: el build estático optimizado.
COPY --from=builder /app/dist /usr/share/nginx/html

# Hacer que nginx corra como usuario SIN privilegios (nginx):
#   - pid file en /tmp (escribible por usuario no-root)
#   - escucha en 8080 (>1024, no requiere bind con root)
#   - propiedad de raíz web, caché y logs para el usuario nginx
RUN sed -i 's|pid .*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && chown -R nginx:nginx /usr/share/nginx/html /var/cache/nginx /var/log/nginx /etc/nginx/conf.d /tmp

# Puerto interno de nginx (no-root). Se mapea a ${FRONTEND_PORT:-4321} en host.
EXPOSE 8080

# Cambiar al usuario no privilegiado ANTES del CMD.
USER nginx

# Entrada estándar de nginx (master como PID 1, daemon off para Docker).
CMD ["nginx", "-g", "daemon off;"]