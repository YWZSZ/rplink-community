// Shared filesystem and HTTP helpers for dsh-link.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const LINK_NAMESPACE = '/__dsh_link';
export const ADMIN_NAMESPACE = '/__dsh_link_admin';
export const COOKIE_NAME = 'dsh_link';

export function json(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
}

export function text(response, status, body, headers = {}) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

export async function readBody(request, limit = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new Error('body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request, limit = 64 * 1024) {
  const raw = await readBody(request, limit);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString('utf8'));
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqualString(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key !== '') out[key] = decodeURIComponent(value);
  }
  return out;
}

export function bearerToken(request) {
  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookies = parseCookies(request.headers.cookie);
  return typeof cookies[COOKIE_NAME] === 'string' ? cookies[COOKIE_NAME] : '';
}

export function clientIp(request) {
  const raw = request.socket?.remoteAddress ?? '';
  return raw.startsWith('::ffff:') ? raw.slice(7) : raw;
}

export function isLoopback(request) {
  const ip = clientIp(request);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export function isPrivateIpv4(ip) {
  if (typeof ip !== 'string') return false;
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (match === null) return false;
  const [a, b] = match.slice(1).map(Number);
  if ([a, b, Number(match[3]), Number(match[4])].some((n) => n < 0 || n > 255)) return false;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, content, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readJsonFile(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(path, value) {
  return atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function sanitizeFilename(value, fallback = 'download') {
  const base = String(value ?? '').replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f<>:"|?*]/g, '').trim();
  const clipped = base.slice(0, 180);
  return clipped === '' || clipped === '.' || clipped === '..' ? fallback : clipped;
}

export function isPathInside(root, candidate) {
  const normalizedRoot = root.replace(/[\\/]+$/, '').toLowerCase();
  const normalizedCandidate = candidate.toLowerCase();
  return normalizedCandidate === normalizedRoot || normalizedCandidate.startsWith(`${normalizedRoot}${process.platform === 'win32' ? '\\' : '/'}`);
}

export function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
