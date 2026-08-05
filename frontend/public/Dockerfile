# ============================================================================
# Dockerfile del frontend (Astro + Tailwind, build estático)
# ----------------------------------------------------------------------------
# Estrategia multi-stage:
#   1. stage `build`: imagen Node — instala dependencias y genera el HTML
#      estático en /app/dist (astro build, salida "static").
#   2. stage `serve`: imagen nginx — copia el dist a la raíz web y monta un
#      reverse proxy /api hacia el service interno `backend:3000`.
#
# Elegimos nginx porque sirve ficheros estáticos muy bien Y nos da el proxy
# inverso en el mismo contenedor. Así la app usa UNA SOLA origin (rutas
# relativas /api en liveMetrics.js), por lo que NO hay CORS entre frontend y
# backend: ambos se sirven desde el mismo host al navegador.
# ============================================================================

# ------------------ STAGE 1: construccion ------------------
FROM node:20-alpine AS build

WORKDIR /app

# Copiar manifiestos primero (capas cacheables)
COPY package.json ./
# Nota: no hay package-lock.json junto a package.json; usamos `npm install`.
RUN npm install --no-audit --no-fund

# Copiar el resto del proyecto (config, src, scripts publicos)
COPY astro.config.mjs tailwind.config.mjs tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

# Generar el sitio estático (salida en /app/dist)
RUN npm run build

# ------------------ STAGE 2: servidor web ------------------
FROM nginx:1.27-alpine

# Config de nginx: sirve el site + proxy inverso /api -> backend
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar el build estático al document root de nginx
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# usamos la entrada de nginx por defecto (nofork, corre como PID 1)
CMD ["nginx", "-g", "daemon off;"]