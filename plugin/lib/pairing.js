// One-time pairing codes and the QR/link the desktop panel displays.
import { randomInt, randomUUID } from 'node:crypto';
import QRCode from 'qrcode';
import { safeEqualString } from './util.js';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_FAILURES = 8;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

export class PairingManager {
  constructor({ serverId, serverName }) {
    this.serverId = serverId;
    this.serverName = serverName;
    this.current = null;
    this.failures = new Map();
  }

  create() {
    this.current = {
      code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
      expiresAt: Date.now() + CODE_TTL_MS,
      issuedAt: Date.now(),
    };
    return this.current;
  }

  peek() {
    if (this.current === null) return null;
    if (this.current.expiresAt <= Date.now()) {
      this.current = null;
      return null;
    }
    return this.current;
  }

  /**
   * Verify a pairing code. A successful attempt consumes it.
   * @param {string} code
   * @param {string} ip
   * @returns {{ ok: true } | { ok: false, reason: 'missing'|'expired'|'invalid'|'rate-limited' }}
   */
  verify(code, ip) {
    const now = Date.now();
    const failures = this.failures.get(ip);
    if (failures !== undefined && failures.resetAt > now && failures.count >= MAX_FAILURES) {
      return { ok: false, reason: 'rate-limited' };
    }
    if (this.current === null) return { ok: false, reason: 'missing' };
    if (this.current.expiresAt <= now) {
      this.current = null;
      return { ok: false, reason: 'expired' };
    }
    if (!safeEqualString(String(code ?? ''), this.current.code)) {
      const next = failures !== undefined && failures.resetAt > now
        ? { count: failures.count + 1, resetAt: failures.resetAt }
        : { count: 1, resetAt: now + FAILURE_WINDOW_MS };
      this.failures.set(ip, next);
      return { ok: false, reason: next.count >= MAX_FAILURES ? 'rate-limited' : 'invalid' };
    }
    this.current = null;
    this.failures.delete(ip);
    return { ok: true };
  }

  link({ address, port, caFingerprint }) {
    const current = this.peek();
    if (current === null) return null;
    const params = new URLSearchParams({
      v: '1',
      host: address,
      port: String(port),
      sid: this.serverId,
      fp: caFingerprint,
      code: current.code,
      name: this.serverName,
    });
    return {
      code: current.code,
      expiresAt: new Date(current.expiresAt).toISOString(),
      url: `rplink://pair?${params.toString()}`,
    };
  }

  async qrPng(link) {
    if (link === null) return undefined;
    const value = typeof link === 'string' ? link : link?.url;
    if (typeof value !== 'string' || value === '') return undefined;
    return QRCode.toBuffer(value, {
      type: 'png',
      width: 560,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220ff', light: '#ffffffff' },
    });
  }
}

export function newServerId() {
  return randomUUID();
}
