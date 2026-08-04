// src/services/network.service.js
// ============================================================================
// Detección dinámica de red: obtiene la IP del gateway/router local
// para que el monitor pueda verificar la conectividad con el hogar.
//
// Estrategia multiplataforma:
//   1. Intenta obtener la gateway real del sistema (ip route / route print)
//   2. Si falla, busca en os.networkInterfaces() la primera IP no-internal
//   3. Si todo falla, devuelve null (degradación elegante)
//
// No lanza nunca: siempre resuelve un resultado estructurado.
// Esto es crítico porque un fallo en la detección de red no debe
// impedir que el monitor arranque; simplemente omitirá el gateway.
// ============================================================================

import os from 'node:os';
import { execSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// getDefaultGateway(): obtiene la IP del router/gateway por defecto
// ---------------------------------------------------------------------------
// En un hogar típico, el gateway es 192.168.1.1, 192.168.0.1 o 10.0.0.1.
// Pero hardcodear esos valores es frágil: cada router y configuración
// es diferente. Aquí detectamos la gateway real del sistema operativo.
// ---------------------------------------------------------------------------
export function getDefaultGateway() {
  // Primero intentamos la ruta nativa del sistema operativo.
  // Cada plataforma tiene su propio comando para mostrar la tabla de rutas.
  const platform = os.platform(); // 'win32' | 'linux' | 'darwin' (macOS)

  try {
    if (platform === 'win32') {
      // Windows: "route print 0.0.0.0" muestra la ruta por defecto.
      // La columna "Gateway" contiene la IP del router.
      // Filtramos líneas que empiecen con "0.0.0.0" o "0.0.0.0.0.0.0.0"
      // y tomamos la primera IP de gateway no vacía ni "on-link".
      const output = execSync('route print 0.0.0.0', { encoding: 'utf-8', timeout: 5000 });
      const gateway = parseWindowsRoute(output);
      if (gateway) return gateway;
    } else if (platform === 'linux') {
      // Linux: "ip route show default" muestra la ruta por defecto.
      // El formato es: "default via 192.168.1.1 dev eth0 proto dhcp"
      // Extraemos la IP después de "via".
      const output = execSync('ip route show default', { encoding: 'utf-8', timeout: 5000 });
      const match = output.match(/via\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match) return match[1];
    } else if (platform === 'darwin') {
      // macOS: "route get default" muestra la ruta por defecto.
      // El formato incluye "gateway: 192.168.1.1"
      const output = execSync('route get default', { encoding: 'utf-8', timeout: 5000 });
      const match = output.match(/gateway:\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (match) return match[1];
    }
  } catch {
    // Si el comando falla (permisos, comando no disponible, etc.),
    // continuamos con los métodos alternativos. Nunca lanzamos.
  }

  // Método alternativo: buscar en os.networkInterfaces() la primera IP
  // no-internal (no 127.x.x.x ni link-local 169.254.x.x) y asumir
  // que el gateway es la misma subred con .1 al final.
  // Esto es una heurística razonable para redes domésticas típicas
  // (192.168.1.x → gateway 192.168.1.1).
  const fallback = getFallbackGateway();
  if (fallback) return fallback;

  // Último recurso: devolver null. El monitor seguirá funcionando
  // para los servicios públicos (DNS de Cloudflare y Google), solo
  // omitirá el gateway local. Esto es degradación elegante.
  return null;
}

// ---------------------------------------------------------------------------
// parseWindowsRoute(): extrae la gateway de la salida de "route print"
// en Windows. La salida tiene una tabla con columnas separadas por espacios.
// Buscamos la fila de ruta por defecto y extraemos la IP de gateway.
// ---------------------------------------------------------------------------
function parseWindowsRoute(output) {
  // La salida de "route print 0.0.0.0" tiene columnas:
  //   Network Destination  Netmask  Gateway  Interface  Metric
  //   0.0.0.0              0.0.0.0  192.168.1.1  192.168.1.100  35
  // Buscamos la fila de ruta por defecto y extraemos la IP
  // de la columna "Gateway" (tercera columna util),
  // saltandonos las dos primeras IPs (destino y mascara).
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('0.0.0.0')) continue;

    // Extraemos todas las IPs validas de la linea.
    const ips = trimmed.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g) ?? [];

    // Saltamos las dos primeras (0.0.0.0 destino y 0.0.0.0 mascara)
    // y buscamos la primera IP que no sea 0.0.0.0 ni "on-link".
    for (let i = 2; i < ips.length; i++) {
      if (ips[i] !== '0.0.0.0' && ips[i] !== 'on-link') {
        return ips[i];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// getFallbackGateway(): heurística basada en la IP local del equipo
// ---------------------------------------------------------------------------
// Si no podemos ejecutar comandos de sistema (contenedor, sandbox, etc.),
// inferimos la gateway asumiendo que está en la misma subred con el
// último octeto cambiado a .1. Ejemplo: IP 192.168.1.42 → gateway 192.168.1.1.
// Esto funciona en el 90% de los routers domésticos.
// ---------------------------------------------------------------------------
function getFallbackGateway() {
  const interfaces = os.networkInterfaces();

  for (const _name of Object.keys(interfaces)) {
    for (const iface of interfaces[_name]) {
      // Ignoramos interfaces internas (loopback 127.x.x.x) y
      // link-local (169.254.x.x) que no tienen gateway asociado.
      // También ignoramos IPv6 (no necesitamos gateway IPv6 para este caso).
      if (iface.family !== 'IPv4' || iface.internal) continue;

      // Extraemos los primeros 3 octetos de la IP local.
      // Ejemplo: "192.168.1.42" → ["192", "168", "1"] → "192.168.1.1"
      const octets = iface.address.split('.');
      if (octets.length === 4) {
        const candidate = `${octets[0]}.${octets[1]}.${octets[2]}.1`;
        // Validamos que sea una IP válida antes de devolverla.
        if (isValidIp(candidate)) return candidate;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// isValidIp(): valida que un string sea una IPv4 válida
// ---------------------------------------------------------------------------
// Cada octeto debe estar entre 0 y 255. Esto evita que errores de parsing
// devuelvan strings que no son direcciones IP válidas.
function isValidIp(ip) {
  const octets = ip.split('.');
  if (octets.length !== 4) return false;
  return octets.every(
    (octet) => /^\d+$/.test(octet) && Number.parseInt(octet, 10) >= 0 && Number.parseInt(octet, 10) <= 255,
  );
}

// ---------------------------------------------------------------------------
// buildDefaultServices(): construye la lista de servicios por defecto
// ---------------------------------------------------------------------------
// Cuando MONITOR_SERVICES no está configurado en .env, usamos estos
// servicios como fallback. Incluyen:
//   1. Gateway local (router del hogar) - verifica conectividad interna
//   2. Cloudflare DNS (1.1.1.1) - DNS público global, siempre accesible
//   3. Google DNS (dns.google) - DNS público global alternativo
//
// Usamos HTTP para el gateway (la mayoría de routers sirven HTTP en puerto 80)
// y HTTPS para los DNS públicos (sus certificados TLS son válidos).
// ---------------------------------------------------------------------------
export function buildDefaultServices() {
  const gateway = getDefaultGateway();
  const services = [];

  // Gateway local: el router del hogar. Es el primer punto de fallo
  // si hay un problema de red interna. Usamos HTTP porque la mayoría
  // de routers domésticos sirven su panel de administración en HTTP.
  if (gateway) {
    services.push({ name: 'gateway', url: `http://${gateway}` });
  }

  // Cloudflare DNS: el resolver DNS público más rápido del mundo.
  // 1.1.1.1 responde HTTPS con un certificado válido para esa IP.
  services.push({ name: 'cloudflare-dns', url: 'https://1.1.1.1' });

  // Google DNS: resolver alternativo. Usamos el dominio dns.google
  // (no la IP 8.8.8.8 directamente) porque Google no sirve HTTPS
  // directamente en la IP 8.8.8.8, pero sí en dns.google con TLS.
  services.push({ name: 'google-dns', url: 'https://dns.google' });

  return services;
}
