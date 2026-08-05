// src/services/services.store.js
// ============================================================================
// Almacen de servicios gestionados DESDE LA INTERFAZ GRAFICA (dinamicos).
// Se persisten en backend/data/services.json para que sobrevivan a reinicios,
// a diferencia de los estaticos que vienen de MONITOR_SERVICES en .env.
//
// Responsabilidades:
//   - Mantener la lista de servicios agregados via UI (en memoria + JSON).
//   - Exponer getAllServices() = estaticos (.env) + dinamicos (UI).
//   - addService()/removeService() con validacion y persistencia.
// ============================================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const STORE_FILE = path.join(DATA_DIR, 'services.json');

// Servicios agregados via UI: [{ id, name, url, addedAt }]
let dynamicServices = [];

// ---------------------------------------------------------------------------
// Validacion: misma politica que env.js (http/https + URL bienformada).
// Lanza Error con mensaje legible para el operador (se devuelve como 400).
// ---------------------------------------------------------------------------
function validateAndNormalize(name, rawUrl) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    throw new Error('La URL es obligatoria');
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error(`URL invalida: "${trimmed}"`);
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error(`Protocolo no soportado (${trimmed}): use http:// o https://`);
  }
  const url = parsedUrl.toString();
  const finalName = (name ?? '').trim() || parsedUrl.hostname;

  if (getAllServices().some((s) => s.url === url)) {
    throw new Error(`Ya existe un servicio con esa URL: ${url}`);
  }
  return { name: finalName, url };
}

// ---------------------------------------------------------------------------
// Lectura/escritura del archivo de persistencia
// ---------------------------------------------------------------------------
async function load() {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      dynamicServices = parsed.filter((s) => s && typeof s.url === 'string');
    }
  } catch (err) {
    // ENOENT = primera ejecucion (aun no existe el archivo) -> lista vacia.
    if (err.code !== 'ENOENT') {
      logger.warn(`No se pudo leer ${STORE_FILE}: ${err.message}`);
    }
    dynamicServices = [];
  }
}

async function persist() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(STORE_FILE, JSON.stringify(dynamicServices, null, 2), 'utf-8');
  } catch (err) {
    logger.error(`No se pudo persistir ${STORE_FILE}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// API publica
// ---------------------------------------------------------------------------

// Combina servicios estaticos (.env) + dinamicos (UI). Los estaticos no son
// borrables desde la interfaz (managed: false); los dinamicos si (managed: true).
export function getAllServices() {
  const staticServices = config.services.map((s) => ({ ...s, id: `static:${s.url}`, managed: false }));
  const dynamic = dynamicServices.map((s) => ({ ...s, managed: true }));
  return [...staticServices, ...dynamic];
}

export function listDynamicServices() {
  return dynamicServices.map((s) => ({ ...s, managed: true }));
}

export async function addService({ name, url }) {
  const svc = validateAndNormalize(name, url);
  const service = { id: randomUUID(), name: svc.name, url: svc.url, addedAt: new Date().toISOString() };
  dynamicServices.push(service);
  await persist();
  logger.info(`Servicio agregado via UI: ${service.name} (${service.url})`);
  return service;
}

export async function removeService(id) {
  const idx = dynamicServices.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  dynamicServices.splice(idx, 1);
  await persist();
  logger.info(`Servicio eliminado via UI: ${id}`);
  return true;
}

// Carga el store al arrancar el proceso (imports top-level con side effect).
await load();
