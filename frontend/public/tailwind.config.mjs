// tailwind.config.mjs
// Configuración de Tailwind CSS con paleta Dark Theme personalizada.
// extend: preserva los valores por defecto y solo añade/extiende lo nuestro.
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}',
  ],
  // darkMode: 'class' permite activar modo oscuro con <html class="dark">.
  // Aquí forzamos dark siempre porque nuestra app es dark-only.
  darkMode: 'class',
  theme: {
    extend: {
      // Paleta de colores personalizada (se usa como bg-dark, bg-card, text-muted, etc.)
      colors: {
        // Fondo principal: #0A0A0A (casi negro, reduce fatiga visual en dark)
        dark: '#0A0A0A',
        // Tarjetas/contenedores: #111111 (ligeramente más claro para contraste sutil)
        card: '#111111',
        // Bordes sutiles entre tarjetas
        border: '#1E1E1E',
        // Texto principal
        'text-primary': '#E8E8E8',
        // Texto secundario/muted
        'text-muted': '#888888',
        // Acentos de estado (semánticos, no solo "green-500")
        'status-up': '#22C55E',       // green-500
        'status-degraded': '#FACC15', // yellow-400
        'status-down': '#EF4444',     // red-500
      },
      // Espaciado extra si se necesita (opcional)
      spacing: {
        '18': '4.5rem', // 72px
      },
      // Animaciones sutiles para transiciones de estado
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};