# ============================================================================
# Dockerfile del backend (API REST Node.js + Express)
# ----------------------------------------------------------------------------
# Imagen de producción minimalista (sin devDependencies).
# El contenedor NO expone puertos hacia el host: solo es accesible en la red
# interna de Docker (lo consume el frontend/nginx mediante proxy /api).
# Los servicios agregados desde la UI se persisten en /app/data (volumen).
# ============================================================================

# --- Imagen base ligera (solo runtime, sin build tools) ---
FROM node:24-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /app

# Copiar manifiestos ANTES del código: capas de Docker cacheables.
# Si package.json no cambia, npm ci no se re-ejecuta en builds posteriores.
COPY package.json package-lock.json ./

# Instalar solo dependencias de producción (sin devDependencies)
RUN npm ci --omit=dev

# Copiar el código fuente (monotilo: src/ es autoconfuente)
COPY src ./src

# Crear el directorio de persistencia de servicios agregados via UI.
# El volumen Docker se montará aquí para que sobrevivan a reinicios.
RUN mkdir -p /app/data

# El backend escribe menos logs en producción
ENV NODE_ENV=production

# Puerto interno (solo red de Docker)
EXPOSE 3000

# Arranque igual que `npm start`
CMD ["node", "src/index.js"]