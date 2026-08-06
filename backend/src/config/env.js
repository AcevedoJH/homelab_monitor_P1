// src/config/env.js
// ============================================================================
// Punto unico de carga y VALIDACION de la configuracion del proyecto.
// Se separa en su propio modulo para que cualquier capa de la app importe la
// configuracion desde un solo lugar ("Single Source of Truth") y no lea
// process.env a lo loco, lo que haria el codigo dificil de testear y fragil.
// ============================================================================

import 'dotenv/config'; // Carga el contenido de .env hacia process.env (lado a lado)
import logger from '../utils/logger.js';
import { buildDefaultServices, getDefaultGateway } from '../services/network.service.js';

// Valores por defecto: si la variable de entorno no existe, usamos un fallback
// razonable. Centralizar los defaults aqui evita "magic numbers" esparcidos.
const DEFAULT_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_PROBES = 5;

// ---------------------------------------------------------------------------
// Helpers de parseo (fail-fast)
// La idea detras de validar al arrancar es detectar configuraciones invalidas
// lo antes posible (en el momento de hacer `npm start`), en vez de fallar
// tarde, en medio de una peticion, cuando ya es mas dificil de depurar.
// ---------------------------------------------------------------------------

// Convierte un string a entero positivo. Si no es valido, lanza un error claro
// para que el operador sepa exactamente que variable corrigio mal.
function parsePositiveInt(raw, defaultValue, varName) {
  // Variable ausente o vacia: usamos el default. Sin esto, un entorno sin la
  // variable (p. ej. el contenedor Docker, donde no hay .env) rompe el
  // arranque aunque exista un valor por defecto razonable.
  if (raw === undefined || raw === '') return defaultValue;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) {
    throw new Error(`Configuracion invalida: ${varName} debe ser un entero >= 0`);
  }
  return n;
}

// Convierte la lista de servicios "nombre=url,nombre2=url2" en un arreglo de
// objetos { name, url }. Cada entrada se valida con `new URL()`, que lanza
// TypeError si la url esta malformada; asi descartamos servicios rotos.
function parseServices(raw) {
  if (!raw || raw.trim() === '') return [];

  return raw
    .split(',') // Separamos por comas...
    .map((entry) => entry.trim()) // ...y limpiamos espacios sobrantes.
    .filter(Boolean) // Ignoramos entradas vacias (p. ej. "a.com,,b.com").
    .map((entry) => {
      // Soporte opcional "nombre=url"; si no hay '=', derivamos el nombre
      // desde el hostname (menos codigo duplicado de configuracion).
      const eqIndex = entry.indexOf('=');
      const hasExplicitName = eqIndex > 0 && !entry.slice(0, eqIndex).includes('/');

      let name;
      let url;
      if (hasExplicitName) {
        name = entry.slice(0, eqIndex);
        url = entry.slice(eqIndex + 1);
      } else {
        url = entry;
      }

      // `new URL()` valida el esquema (http/https) y el hostname; si falla
      // lanzamos aqui mismo para avisar del error en el arranque (fail-fast).
      const parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error(`Servicio con protocolo no soportado (${url}): use http:// o https://`);
      }

      return { name: name || parsedUrl.hostname, url: parsedUrl.toString() };
    });
}

// ---------------------------------------------------------------------------
// Resolucion de servicios: prioridad de fuentes
// 1. MONITOR_SERVICES en .env (configuracion explicita del operador)
// 2. Servicios por defecto: gateway local + DNS publicos (fallback)
//
// Esto permite que el monitor funcione "out of the box" sin tocar el
// codigo: npm install && npm run dev y ya tienes métricas de tu gateway
// y los DNS publicos. El operador puede sobrescribir con MONITOR_SERVICES.
// ---------------------------------------------------------------------------
function resolveServices() {
  const explicit = parseServices(process.env.MONITOR_SERVICES);
  if (explicit.length > 0) return explicit;

  // Sin MONITOR_SERVICES: usamos los servicios por defecto (gateway + DNS).
  const defaults = buildDefaultServices();
  if (defaults.length > 0) {
    const gateway = getDefaultGateway();
    logger.info(
      `MONITOR_SERVICES no configurado. Usando servicios por defecto: ${defaults.map((s) => s.name).join(', ')}${gateway ? ` (gateway detectado: ${gateway})` : ' (gateway no detectado)'}`,
    );
  }
  return defaults;
}

// `Object.freeze` impide que otra parte del codigo mute la configuracion por
// accidente. Los objetos mutables globales son una de las fuentes de bugs mas
// comunes en proyectos que crecen.
export const config = Object.freeze({
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parsePositiveInt(process.env.PORT, DEFAULT_PORT, 'PORT'),
  requestTimeoutMs: parsePositiveInt(process.env.REQUEST_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 'REQUEST_TIMEOUT_MS'),
  probes: parsePositiveInt(process.env.PROBES, DEFAULT_PROBES, 'PROBES'),
  services: resolveServices(),
});

// Si no hay ningun servicio configurado la API no tiene sentido; mejor avisar
// en el arranque con un mensaje claro en vez de devolver "vacio" en silencio.
if (config.services.length === 0) {
  logger.warn('No hay servicios configurados en MONITOR_SERVICES y no se pudo detectar el gateway. La API respondera metricas vacias.');
}
