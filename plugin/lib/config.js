// Configuration and LAN address selection for dsh-link.
import os from 'node:os';

export const DEFAULT_PORT = 3443;
const ADDRESS_PRIORITY = [
  { test: (ip) => ip.startsWith('192.168.'), score: 100 },
  { test: (ip) => ip.startsWith('10.'), score: 90 },
  { test: (ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip), score: 80 },
  { test: (ip) => ip.startsWith('169.254.'), score: 10 },
  { test: () => true, score: 1 },
];

const VIRTUAL_NAME = /(vEthernet|VMware|VirtualBox|Hyper-V|Loopback|Radmin|Tailscale|ZeroTier|WireGuard|VPN|Docker|WSL)/i;
const PHYSICAL_NAME = /(Ethernet|WLAN|Wi-?Fi|无线|以太网)/i;

/**
 * List non-internal IPv4 addresses in a stable preference order.
 * @returns {Array<{name: string, address: string, netmask: string, score: number}>}
 */
export function listLanAddresses() {
  const rows = [];
  for (const [name, addresses] of Object.entries(os.networkInterfaces())) {
    for (const item of addresses ?? []) {
      if (item.family !== 'IPv4' || item.internal) continue;
      let score = ADDRESS_PRIORITY.find((entry) => entry.test(item.address))?.score ?? 0;
      if (PHYSICAL_NAME.test(name)) score += 12;
      if (VIRTUAL_NAME.test(name)) score -= 60;
      rows.push({ name, address: item.address, netmask: item.netmask, score });
    }
  }
  rows.sort((a, b) => b.score - a.score || a.address.localeCompare(b.address));
  return rows;
}

/**
 * Pick the LAN address to bind. Honors an explicit address; otherwise prefers
 * a physical 192.168/10/172.16-31 interface over VPN and virtual adapters.
 * @param {string} [preferred]
 * @returns {{address: string, name: string, netmask: string} | undefined}
 */
export function pickLanAddress(preferred = '') {
  const rows = listLanAddresses();
  if (typeof preferred === 'string' && preferred.trim() !== '') {
    const found = rows.find((row) => row.address === preferred.trim());
    if (found !== undefined) return found;
  }
  return rows[0];
}

/**
 * Normalize the Loader-provided config.
 * @param {Record<string, unknown>} [raw]
 */
export function resolveConfig(raw = {}) {
  const port = Number.isFinite(Number(raw.port)) ? Math.min(65535, Math.max(1024, Math.trunc(Number(raw.port)))) : DEFAULT_PORT;
  const upstreamPort = Number.isFinite(Number(raw.upstreamPort)) && Number(raw.upstreamPort) > 0
    ? Math.min(65535, Math.trunc(Number(raw.upstreamPort)))
    : 0;
  return {
    port,
    upstreamPort,
    autoStart: raw.autoStart === true,
    bindAddress: typeof raw.bindAddress === 'string' ? raw.bindAddress.trim() : '',
    dataDir: typeof raw.dataDir === 'string' && raw.dataDir.trim() !== '' ? raw.dataDir.trim() : '',
  };
}
