// src/controllers/services.controller.js
// ============================================================================
// Controlador para la gestion de servicios DINAMICOS (agregar/eliminar desde
// la interfaz grafica). Sigue la misma convencion que metrics.controller.js:
// controller delgado, logica de negocio en los services.
// ============================================================================

import { getAllServices, addService, removeService } from '../services/services.store.js';
import logger from '../utils/logger.js';

// ---------------------------------------------------------------------------
// GET /api/v1/services
// Devuelve la lista completa: estaticos (.env) + dinamicos (UI), cada uno con
// su id y el flag `managed` para que el frontend decida si muestra el boton
// de eliminar.
// ---------------------------------------------------------------------------
export function getServices(req, res) {
  res.status(200).json({ success: true, data: { services: getAllServices() } });
}

// ---------------------------------------------------------------------------
// POST /api/v1/services
// Cuerpo esperado: { name?, url }. Valida, persiste y devuelve 201 con el
// servicio creado (incluyendo su id para futuras operaciones).
// Errores de validacion -> 400 con mensaje legible para el operador.
// ---------------------------------------------------------------------------
export async function createService(req, res, next) {
  try {
    const { name, url } = req.body ?? {};
    const service = await addService({ name, url });
    res.status(201).json({ success: true, data: { service } });
  } catch (err) {
    const known = ['URL invalida', 'Protocolo no soportado', 'Ya existe un servicio', 'es obligatoria'].some((frag) =>
      err.message.includes(frag),
    );
    if (known) {
      return res.status(400).json({ success: false, error: err.message });
    }
    logger.error('Error agregando servicio', err);
    next(err);
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/v1/services/:id
// Elimina un servicio dinamico por su id. Solo se pueden borrar los que se
// agregaron via UI (los de .env no tienen id "random" y no viven en el store).
// 404 si el id no existe en el store dinamico.
// ---------------------------------------------------------------------------
export async function deleteService(req, res, next) {
  try {
    const removed = await removeService(req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, error: 'Servicio no encontrado' });
    }
    res.status(200).json({ success: true, data: { removed: true } });
  } catch (err) {
    logger.error('Error eliminando servicio', err);
    next(err);
  }
}
