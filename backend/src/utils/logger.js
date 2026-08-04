// src/utils/logger.js
// ============================================================================
// Logger minimalista sin dependencias externas (no usa pino/winston).
// Ventajas: cero setup, cero peso, y suficiente para un proyecto que empieza.
// El dia que necesitemos transporte a archivos/SIEM o correlacion de traces,
// este modulo es el unico lugar que habria que cambiar (interface estable).
// ============================================================================

// Niveles de log con prioridad numerica: permiten filtrar facilmente
// ("muestrame solo desde warn hacia arriba") de forma programatica.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Codigos ANSI para colorear la salida en terminales que lo soporten.
// Detectamos TTY con process.stderr.isTTY para no ensuciar logs en CI/archivos.
const COLORS = {
  debug: '\x1b[90m', // gris
  info: '\x1b[36m', // cian
  warn: '\x1b[33m', // amarillo
  error: '\x1b[31m', // rojo
};
const RESET = '\x1b[0m';

// "env <= nivel minimo" -> decidimos si una linea se imprime o se descarta.
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

// Serializa el objeto de contexto (meta) de forma segura: JSON.stringify
// puede lanzar en presencia de BigInt o ciclos, y un logger que crashea al
// loggear es inutil. Aqui degradamos a String() en vez de propagar el error.
function safeStringify(meta) {
  if (meta instanceof Error) {
    return `${meta.stack ?? meta.message}`;
  }
  try {
    return JSON.stringify(meta);
  } catch {
    return String(meta);
  }
}

function write(level, message, meta) {
  if (LEVELS[level] < minLevel) return; // Filtrado por nivel configurado.
  const timestamp = new Date().toISOString(); // ISO-8601: parseable por cualquier tooling.
  const body = `[${timestamp}] ${level.toUpperCase()} ${message}${meta !== undefined ? ` ${safeStringify(meta)}` : ''}`;

  const useColor = process.stderr.isTTY && COLORS[level];
  const line = useColor ? `${COLORS[level]}${body}${RESET}` : body;

  // errores van a stderr, el resto a stdout: permite que CI redirija y
  // separe flujo normal de errores (patron estandar en sistemas reales).
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

// API publica: solo 4 metodos, suficientes. Mantener la superficie pequena
// hace que sea facil reemplazar por pino/winston mas adelante.
export default {
  debug: (message, meta) => write('debug', message, meta),
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
};
