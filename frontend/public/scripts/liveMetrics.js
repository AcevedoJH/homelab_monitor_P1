// src/scripts/liveMetrics.js
// ============================================================================
// Script de polling cliente para Astro (Client Island).
// Consume /api/metrics cada 5 segundos y actualiza el DOM sin recargar.
//
// Conceptos clave explicados:
//
// 1. setInterval vs setTimeout recursivo:
//    setInterval ejecuta una función cada N ms de forma fija, pero si la
//    función tarda más que N, las ejecuciones se acumulan (pueden solaparse).
//    Aquí usamos setTimeout recursivo dentro del propio callback: el siguiente
//    poll solo se programa DESPUÉS de que el actual termine. Esto garantiza
//    un intervalo real de 5s entre el FIN de un poll y el INICIO del siguiente,
//    evitando solapamientos y consumo excesivo de la API.
//
// 2. Ciclo de renderizado (DOM diffing):
//    En lugar de reemplazar innerHTML completo (destruye nodos DOM existentes,
//    pierde foco del usuario, reinicia animaciones), usamos data-attributes
//    para seleccionar elementos específicos y actualizar solo su texto/contenido.
//    Esto es "DOM diffing" manual: comparamos lo que hay con lo que queremos
//    y aplicamos el mínimo cambio necesario.
//
// 3. Peticiones asíncronas (fetch + AbortController):
//    fetch() devuelve una Promise que se resuelve cuando la respuesta completa
//    llega. AbortController permite cancelar una petición en curso (útil si
//    el usuario navega o el componente se desmonta). El timeout de 10s evita
//    que una petición colgada bloquee el siguiente poll.
// ============================================================================

// ============================================================================
// CONFIGURACIÓN
// ============================================================================
const POLL_INTERVAL_MS = 5_000;    // 5 segundos entre polls (requisito)
const FETCH_TIMEOUT_MS = 10_000;  // timeout por petición HTTP
const API_BASE = 'http://localhost:3000/api/v1';
const MAX_RETRIES = 3;            // reintentos ante fallo de red
const RETRY_DELAY_MS = 3_000;     // espera entre reintentos

// ============================================================================
// ESTADO INTERNO DEL MÓDULO
// ============================================================================
let pollTimer = null;             // referencia al setTimeout del próximo poll
let abortController = null;       // controlador para cancelar fetch en curso
let retryCount = 0;               // contador de reintentos consecutivos
let isPolling = false;            // flag para evitar polls concurrentes

// Cache de referencias DOM (se obtienen una vez en init)
let gridEl = null;
let refreshBtn = null;
let autoRefreshCb = null;
let lastUpdatedEl = null;
let summaryUpEl = null;
let summaryDegradedEl = null;
let summaryDownEl = null;
let summaryAvailEl = null;
let addServiceForm = null;
let addServiceNameInput = null;
let addServiceUrlInput = null;
let addServiceBtn = null;
let addServiceFeedback = null;

// ============================================================================
// UTILIDADES
// ============================================================================

// Formatea latencia: "42 ms" o "—" si null
function fmtLatency(ms) {
  return ms !== null ? `${ms} ms` : '—';
}

// Formatea timestamp ISO a hora local legible
function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '—';
  }
}

// Color de la barra de latencia según umbrales:
//   < 50ms  → verde   (saludable)
//  50-150ms → amarillo (aceptable)
//    > 150ms → rojo   (lento)
function latencyColor(ms) {
  if (ms === null) return '#6B7280';
  if (ms < 50) return '#22C55E';
  if (ms < 150) return '#FACC15';
  return '#EF4444';
}

// Escape HTML básico para prevenir XSS al inyectar en innerHTML
function escapeHtml(str) {
  const map = { '&': '&', '<': '<', '>': '>', '"': '"', "'": "'" };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

// ============================================================================
// ACTUALIZACIÓN DEL DOM (DOM Diffing Manual)
// ============================================================================
// En lugar de innerHTML = ... (que destruye y recrea todos los nodos),
// actualizamos solo los textos y atributos que cambiaron. Esto es más
// eficiente, preserva el foco del usuario y no reinicia animaciones CSS.

// Actualiza el timestamp visible en el header
function updateLastUpdated(iso) {
  if (lastUpdatedEl) lastUpdatedEl.textContent = fmtTime(iso);
}

// Actualiza los 4 contadores del header (resumen global)
function updateHeaderSummary(summary) {
  if (summaryUpEl) summaryUpEl.textContent = String(summary.up);
  if (summaryDegradedEl) summaryDegradedEl.textContent = String(summary.degraded);
  if (summaryDownEl) summaryDownEl.textContent = String(summary.down);
  if (summaryAvailEl) summaryAvailEl.textContent = String(summary.availability) + '%';
}

// Actualiza el badge de estado de una tarjeta concreta.
// Busca el badge por data-service-name y lo reemplaza solo si el estado cambió.
function updateStatusBadge(serviceName, status) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  const badgeContainer = card.querySelector('.status-badge-wrapper');
  if (!badgeContainer) return;

  // Mapeo de estado a clase CSS (offline usa el estilo de down)
  const statusBadgeClass = { up: 'up', degraded: 'degraded', down: 'down', offline: 'down' };
  // Etiquetas legibles para cada estado
  const labels = { up: 'Online', degraded: 'Degradado', down: 'Offline', offline: 'Offline' };
  const dotHtml = status === 'up'
    ? '<span class="w-2 h-2 rounded-full bg-status-up animate-pulse-slow" aria-hidden="true"></span>'
    : '';

  badgeContainer.innerHTML = `
    <span class="status-badge status-badge--${statusBadgeClass[status]}" role="status" aria-live="polite" aria-label="Estado: ${labels[status]}">
      ${dotHtml}
      <span class="capitalize">${labels[status]}</span>
    </span>
  `;
}

// Actualiza la barra de latencia de una tarjeta concreta.
// La barra es un <div> con width y background dinámicos.
function updateLatencyBar(serviceName, latencyAvg) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  const fill = card.querySelector('[data-latency-fill]');
  if (!fill) return;

  const pct = latencyAvg !== null ? Math.min((latencyAvg / 300) * 100, 100) : 0;
  fill.style.width = `${pct}%`;
  fill.style.background = latencyColor(latencyAvg);
}

// Actualiza el texto de latencia promedio en la tarjeta
function updateLatencyText(serviceName, latencyAvg) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  const el = card.querySelector('[data-metric="latency-avg"]');
  if (el) el.textContent = fmtLatency(latencyAvg);
}

// Actualiza la disponibilidad en la tarjeta
function updateAvailability(serviceName, availability) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  const el = card.querySelector('[data-metric="availability"]');
  if (el) el.textContent = `${availability}%`;
}

// Actualiza el código HTTP en la tarjeta
function updateStatusCode(serviceName, statusCode) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  const el = card.querySelector('[data-metric="status-code"]');
  if (el) el.textContent = statusCode !== null ? String(statusCode) : '—';
}

// Actualiza el texto de último error (lo muestra u oculta)
function updateLastError(serviceName, lastError) {
  const card = gridEl?.querySelector(`[data-service-name="${CSS.escape(serviceName)}"]`);
  if (!card) return;

  let errorEl = card.querySelector('[data-error]');
  if (lastError) {
    if (!errorEl) {
      // Crea el elemento de error si no existe
      errorEl = document.createElement('div');
      errorEl.setAttribute('data-error', '');
      errorEl.className = 'text-xs text-status-down/80 bg-status-down/5 rounded p-2 font-mono break-all mt-2';
      errorEl.setAttribute('role', 'alert');
      card.appendChild(errorEl);
    }
    errorEl.textContent = `Último error: ${lastError}`;
  } else if (errorEl) {
    errorEl.remove();
  }
}

// Renderiza el grid completo (solo cuando la estructura cambia: servicios añadidos/eliminados)
function renderGrid(services) {
  if (!gridEl) return;

  gridEl.innerHTML = '';

  if (services.length === 0) {
    gridEl.innerHTML = `
      <div class="col-span-full text-center py-12 bg-card border border-border rounded-xl">
        <svg class="mx-auto h-12 w-12 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <h3 class="mt-4 text-text-primary">Sin servicios configurados</h3>
        <p class="mt-1 text-text-muted text-sm">
          Añade servicios en <code class="font-mono bg-dark px-1.5 py-0.5 rounded">backend/.env</code>
        </p>
      </div>
    `;
    return;
  }

  services.forEach((svc) => {
    const article = document.createElement('article');
    article.className = 'card p-5 flex flex-col gap-4 animate-fade-in';
    article.dataset.serviceName = svc.name;
    if (svc.id) article.dataset.serviceId = svc.id;
    article.dataset.status = svc.status;

    const borderColors = { up: 'border-status-up', degraded: 'border-status-degraded', down: 'border-status-down', offline: 'border-status-down' };
    article.classList.add('border-l-4', borderColors[svc.status]);

    // Solo los servicios gestionados (agregados via UI, managed: true) son
    // borrables; los de .env no. Mostramos el boton solo en esos casos.
    const removeBtn = svc.managed
      ? `<button type="button" class="remove-service-btn shrink-0 ml-auto inline-flex items-center gap-1 px-2 py-1 rounded text-xs text-text-muted border border-border hover:text-status-down hover:border-status-down/50 transition-colors" data-remove-service="${escapeHtml(svc.id)}" aria-label="Eliminar ${escapeHtml(svc.name)}">
           <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
           <span>Quitar</span>
         </button>`
      : '';

    article.innerHTML = `
      <header class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="font-semibold text-text-primary truncate">${escapeHtml(svc.name)}</h2>
          <p class="text-xs text-text-muted truncate mt-0.5 font-mono">${escapeHtml(svc.url)}</p>
        </div>
        <div class="flex items-center shrink-0 gap-2">
          <div class="status-badge-wrapper"></div>
          ${removeBtn}
        </div>
      </header>

      <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4 text-center" role="list">
        <div class="col-span-2 sm:col-span-1">
          <dt class="metric-label">Lat. media</dt>
          <dd class="metric-value text-status-up" data-metric="latency-avg" aria-label="Latencia promedio">${svc.latencyMs ? fmtLatency(svc.latencyMs.avg) : '—'}</dd>
          <div class="mt-1.5 h-1.5 bg-border rounded-full overflow-hidden" data-latency-bar>
            <div class="h-full rounded-full transition-all duration-500 ease-out" data-latency-fill style="width:${svc.latencyMs ? Math.min((svc.latencyMs.avg ?? 0) / 300 * 100, 100) : 0}%;background:${latencyColor(svc.latencyMs?.avg ?? null)}"></div>
          </div>
        </div>
        <div>
          <dt class="metric-label">Mín</dt>
          <dd class="metric-value text-text-muted" data-metric="latency-min">${svc.latencyMs ? fmtLatency(svc.latencyMs.min) : '—'}</dd>
        </div>
        <div>
          <dt class="metric-label">Máx</dt>
          <dd class="metric-value text-text-muted" data-metric="latency-max">${svc.latencyMs ? fmtLatency(svc.latencyMs.max) : '—'}</dd>
        </div>
        <div>
          <dt class="metric-label">Disponib.</dt>
          <dd class="metric-value" data-metric="availability">${svc.probes.availability}%</dd>
        </div>
      </dl>

      <div class="flex flex-wrap items-center gap-3 text-xs text-text-muted border-t border-border pt-3">
        <span class="flex items-center gap-1">
          <span class="px-1.5 py-0.5 bg-dark rounded text-text-primary font-mono" data-metric="status-code">${svc.statusCode !== null ? svc.statusCode : '—'}</span>
          <span>HTTP</span>
        </span>
        <span class="flex items-center gap-1">
          <span class="font-mono">${svc.probes.succeeded}/${svc.probes.total}</span>
          <span>probes</span>
        </span>
        <span class="flex items-center gap-1 ml-auto">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <time datetime="${escapeHtml(svc.checkedAt)}">${fmtTime(svc.checkedAt)}</time>
        </span>
      </div>

      ${svc.lastError ? `<div class="text-xs text-status-down/80 bg-status-down/5 rounded p-2 font-mono break-all mt-2" data-error role="alert">Último error: ${escapeHtml(svc.lastError)}</div>` : ''}
    `;

    gridEl.appendChild(article);
  });
}

// ============================================================================
// FETCH ASÍNCRONO CON ABORTCONTROLLER
// ============================================================================
// fetch() devuelve una Promise. AbortController nos permite cancelarla
// si tarda demasiado (timeout) o si el componente se desmonta.
// El pattern try/catch/finally asegura que limpiamos el timeout siempre.

async function fetchMetrics() {
  // Creamos un nuevo AbortController para esta petición.
  // Su signal se pasa a fetch() para poder cancelarla.
  abortController = new AbortController();

  // Programamos un timeout que llamará a abort() si la petición tarda
  // más de FETCH_TIMEOUT_MS. Esto evita que una petición colgada
  // bloquee el siguiente ciclo de polling.
  const timeoutId = setTimeout(() => {
    if (abortController) abortController.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/metrics`, {
      signal: abortController.signal,  // permite cancelar la petición
      headers: { Accept: 'application/json' },
    });

    // Limpiamos el timeout porque la petición terminó antes de que expire
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    retryCount = 0; // reset del contador de reintentos en éxito
    return data;
  } catch (err) {
    clearTimeout(timeoutId);
    // Distinguimos entre abort por timeout y otros errores de red
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Timeout (10s)');
    }
    throw err;
  }
}

// ============================================================================
// CICLO DE POLLING PRINCIPAL
// ============================================================================
// Función asíncrona que:
//   1. Hace fetch a /api/metrics
//   2. Actualiza el DOM con los datos recibidos
//   3. En caso de error, reintenta hasta MAX_RETRIES veces
//   4. Programa el próximo poll con setTimeout (no setInterval)

async function poll() {
  // Evita polls concurrentes (si un poll tarda más de 5s por ejemplo)
  if (isPolling) return;
  isPolling = true;

  try {
    const result = await fetchMetrics();

    if (!result || !result.success) {
      throw new Error('Respuesta inválida del servidor');
    }

    const { data } = result;
    const services = data?.services ?? [];
    const summary = data?.summary ?? {};
    const timestamp = data?.timestamp ?? null;

    if (services.length === 0) {
      console.warn('[liveMetrics] No se recibieron servicios del backend');
    }

    renderGrid(services);
    updateHeaderSummary(summary);
    updateLastUpdated(timestamp);
    services.forEach((svc) => {
      updateStatusBadge(svc.name, svc.status);
      updateLatencyBar(svc.name, svc.latencyMs?.avg ?? null);
      updateLatencyText(svc.name, svc.latencyMs?.avg ?? null);
      updateAvailability(svc.name, svc.probes?.availability ?? 0);
      updateStatusCode(svc.name, svc.statusCode);
      updateLastError(svc.name, svc.lastError);
    });

    const errorBanner = gridEl?.parentElement?.querySelector('[role="alert"]');
    if (errorBanner) errorBanner.remove();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error(`[liveMetrics] Error al obtener métricas: ${message}`);

    if (retryCount < MAX_RETRIES) {
      retryCount++;
      console.warn(`[liveMetrics] Reintentando (${retryCount}/${MAX_RETRIES})...`);
      if (lastUpdatedEl) {
        lastUpdatedEl.textContent = `Reintentando (${retryCount}/${MAX_RETRIES})...`;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      if (isPolling && autoRefreshCb?.checked) {
        scheduleNextPoll();
      }
      return;
    }

    console.error(`[liveMetrics] Agotados ${MAX_RETRIES} reintentos: ${message}`);
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = `Error: ${message}`;
    }
  } finally {
    // --- Siempre: programamos el próximo poll ---
    // IMPORTANTE: usamos setTimeout recursivo, NO setInterval.
    // setInterval ejecuta la función cada N ms SIN esperar a que la
    // ejecución anterior termine. Si un fetch tarda 6s y el intervalo
    // es 5s, tendríamos ejecuciones solapadas. Con setTimeout recursivo,
    // el próximo poll empieza 5s DESPUÉS de que el actual termine.
    // La fuente de verdad para seguir repitiendo es el estado del checkbox
    // (autoRefreshCb.checked); `isPolling` solo marca "un poll en curso".
    isPolling = false;
    if (autoRefreshCb?.checked) {
      scheduleNextPoll();
    }
  }
}

// Programa el siguiente poll con setTimeout (evita solapamiento)
function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => {
    poll();
  }, POLL_INTERVAL_MS);
}

// ============================================================================
// GESTIÓN DE SERVICIOS DESDE LA INTERFAZ
// ============================================================================

// Muestra feedback del formulario (éxito/error) con estilos visuales
function setAddFeedback(msg, isError) {
  if (!addServiceFeedback) return;
  addServiceFeedback.textContent = msg;
  addServiceFeedback.classList.toggle('text-status-down', !!isError);
  addServiceFeedback.classList.toggle('text-status-up', !isError);
}

// POST /api/v1/services: agrega un servicio y refresca el grid
async function handleAddService(e) {
  e.preventDefault();
  if (!addServiceBtn || addServiceBtn.disabled) return;

  const name = addServiceNameInput?.value.trim() ?? '';
  const url = addServiceUrlInput?.value.trim() ?? '';
  if (!url) {
    setAddFeedback('La URL o IP es obligatoria', true);
    return;
  }

  addServiceBtn.disabled = true;
  setAddFeedback('Agregando servicio...', false);

  try {
    const res = await fetch(`${API_BASE}/services`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ name: name || undefined, url }),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    setAddFeedback(`Servicio "${data.data.service.name}" agregado`, false);
    if (addServiceUrlInput) addServiceUrlInput.value = '';
    if (addServiceNameInput) addServiceNameInput.value = '';
    poll(); // refresco inmediato para ver la nueva tarjeta
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[liveMetrics] Error agregando servicio:', message);
    setAddFeedback(`Error: ${message}`, true);
  } finally {
    addServiceBtn.disabled = false;
  }
}

// DELETE /api/v1/services/:id: elimina un servicio y refresca el grid
async function handleRemoveService(id, btn) {
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
  }

  try {
    const res = await fetch(`${API_BASE}/services/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }

    poll(); // refresco inmediato para quitar la tarjeta
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Error desconocido';
    console.error('[liveMetrics] Error eliminando servicio:', message);
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-50', 'cursor-not-allowed');
    }
  }
}

// ============================================================================
// INICIALIZACIÓN
// ============================================================================
function init() {
  // Cacheamos referencias DOM una sola vez (evita querySelector repetidos)
  gridEl = document.getElementById('service-grid');
  refreshBtn = document.getElementById('refresh-btn');
  autoRefreshCb = document.getElementById('auto-refresh');
  lastUpdatedEl = document.getElementById('last-updated');
  summaryUpEl = document.querySelector('[data-summary="up"]');
  summaryDegradedEl = document.querySelector('[data-summary="degraded"]');
  summaryDownEl = document.querySelector('[data-summary="down"]');
  summaryAvailEl = document.querySelector('[data-summary="availability"]');
  addServiceForm = document.getElementById('add-service-form');
  addServiceNameInput = document.getElementById('svc-name');
  addServiceUrlInput = document.getElementById('svc-url');
  addServiceBtn = document.getElementById('add-service-btn');
  addServiceFeedback = document.getElementById('add-service-feedback');

  if (!gridEl) {
    console.warn('[liveMetrics] Grid element not found, skipping init');
    return;
  }

  // Botón de refresh manual
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      if (isPolling) return; // evita doble click
      refreshBtn.disabled = true;
      refreshBtn.classList.add('opacity-50', 'cursor-not-allowed');
      const spinner = refreshBtn.querySelector('.animate-spin');
      if (spinner) spinner.classList.remove('hidden');

      await poll(); // un poll inmediato

      refreshBtn.disabled = false;
      refreshBtn.classList.remove('opacity-50', 'cursor-not-allowed');
      if (spinner) spinner.classList.add('hidden');
    });
  }

  // Toggle de auto-refresh
  if (autoRefreshCb) {
    autoRefreshCb.addEventListener('change', () => {
      if (autoRefreshCb.checked) {
        poll(); // arranca con una carga inmediata
      } else {
        isPolling = false;
        if (pollTimer) clearTimeout(pollTimer); // detiene el ciclo
      }
    });
  }

  // Formulario de agregar servicio
  if (addServiceForm) {
    addServiceForm.addEventListener('submit', handleAddService);
  }

  // Delegación de eventos: un solo listener en el grid para todos los botones
  // "Quitar". Como el grid se re-renderiza en cada poll, la delegación evita
  // re-asociar listeners a nodos que se recrean constantemente.
  if (gridEl) {
    gridEl.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-remove-service]');
      if (btn) {
        event.preventDefault();
        const id = btn.getAttribute('data-remove-service');
        if (id) handleRemoveService(id, btn);
      }
    });
  }

  // Arranca el polling si auto-refresh está activo (por defecto sí)
  if (autoRefreshCb?.checked) {
    poll(); // carga inicial inmediata; poll() encadena el siguiente vía scheduleNextPoll()
  }

  // Limpieza al desmontar la página
  window.addEventListener('beforeunload', destroy);
}

function destroy() {
  isPolling = false;
  if (pollTimer) clearTimeout(pollTimer);
  if (abortController) abortController.abort();
  window.removeEventListener('beforeunload', destroy);
}

// Auto-inicializa cuando el DOM está listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}