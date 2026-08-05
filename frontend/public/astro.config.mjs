// astro.config.mjs
// Configuración principal de Astro. Usamos ESM (type: module en package.json).
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  // output: 'static' (default) genera HTML estático en build.
  // El cliente (liveMetrics.js) hace fetch a la API en el navegador.
  // Esto evita problemas de SSR/adapter y es más simple para un dashboard.
  output: 'static',
  // Integración oficial de Tailwind: inyecta los estilos y purga clases no usadas en build.
  integrations: [tailwind()],
  // Configuración del servidor de desarrollo
  server: {
    port: 4321,
    host: true, // escucha en todas las interfaces (útil en contenedores/VMs)
  },
  // Proxy de Vite hacia el backend durante el desarrollo. Como el frontend usa
  // rutas relativas /api (API_BASE en liveMetrics.js), reenviamos esas
  // peticiones al backend (localhost:3000) para que haya UNA SOLA origin
  // y no dependamos de CORS. Equivale al proxy /api que hace nginx en Docker.
  vite: {
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
      },
    },
  },
  // Prefijo de ruta si desplegamos en subpath (p. ej. /monitor/)
  // base: '/monitor/',
});