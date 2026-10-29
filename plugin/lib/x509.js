// Minimal, dependency-free X.509 v3 generator for the local DSH Link CA and
// its server certificate. We only need RSA + SHA-256, basic constraints,
// key usage, EKU serverAuth and SAN. DER is assembled by hand so the plugin
// has no certificate-generation dependency and stays installable offline.
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const OID_SHA256_RSA = '1.2.840.113549.1.1.11';
const OID_COMMON_NAME = '2.5.4.3';
const OID_BASIC_CONSTRAINTS = '2.5.29.19';
const OID_KEY_USAGE = '2.5.29.15';
const OID_EXT_KEY_USAGE = '2.5.29.37';
const OID_SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const OID_SUBJECT_ALT_NAME = '2.5.29.17';

function lengthBytes(length) {
  if (length < 0x80) return Buffer.from([length]);
  const raw = [];
  let value = length;
  while (value > 0) {
    raw.unshift(value & 0xff);
    value >>= 8;
  }
  return Buffer.from([0x80 | raw.length, ...raw]);
}

function tlv(tag, content) {
  return Buffer.concat([Buffer.from([tag]), lengthBytes(content.length), content]);
}

const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const bool = (value) => tlv(0x01, Buffer.from([value ? 0xff : 0x00]));
const nul = () => Buffer.from([0x05, 0x00]);
const octet = (buf) => tlv(0x04, buf);
const utf8 = (value) => tlv(0x0c, Buffer.from(String(value), 'utf8'));
const bitString = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]));
const utcTime = (date) => {
  const iso = date.toISOString();
  const stamp = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return tlv(0x17, Buffer.from(stamp, 'ascii'));
};
const explicit = (tag, content) => tlv(0xa0 + tag, content);
const implicit = (tag, content) => tlv(0x80 + tag, content);

function oid(value) {
  const arcs = String(value).split('.').map((part) => Number.parseInt(part, 10));
  if (arcs.length < 2 || arcs.some((arc) => !Number.isInteger(arc) || arc < 0)) {
    throw new Error(`invalid OID: ${value}`);
  }
  const out = [40 * arcs[0] + arcs[1]];
  for (const arc of arcs.slice(2)) {
    const chunks = [arc & 0x7f];
    let current = arc >>> 7;
    while (current > 0) {
      chunks.unshift((current & 0x7f) | 0x80);
      current >>>= 7;
    }
    out.push(...chunks);
  }
  return tlv(0x06, Buffer.from(out));
}

function integerFromBuffer(buf) {
  let value = buf;
  while (value.length > 1 && value[0] === 0 && (value[1] & 0x80) === 0) value = value.subarray(1);
  if ((value[0] & 0x80) !== 0) value = Buffer.concat([Buffer.from([0]), value]);
  return tlv(0x02, value);
}

function integer(value) {
  if (Buffer.isBuffer(value)) return integerFromBuffer(value);
  const raw = [];
  let current = value;
  do {
    raw.unshift(current & 0xff);
    current = Math.floor(current / 256);
  } while (current > 0);
  return integerFromBuffer(Buffer.from(raw));
}

function serial() {
  const raw = randomBytes(16);
  raw[0] &= 0x7f;
  if (raw[0] === 0) raw[0] = 1;
  return integerFromBuffer(raw);
}

function name(commonName) {
  return seq(set(seq(oid(OID_COMMON_NAME), utf8(commonName))));
}

function algorithm() {
  return seq(oid(OID_SHA256_RSA), nul());
}

function keyUsage(bits) {
  // bits: array of bit indexes that are set, e.g. [0, 2].
  const max = Math.max(...bits);
  const byteCount = Math.floor(max / 8) + 1;
  const data = Buffer.alloc(byteCount);
  for (const bit of bits) data[Math.floor(bit / 8)] |= 1 << (7 - (bit % 8));
  const unused = byteCount * 8 - (max + 1);
  return bitString(data, unused);
}

function extension(oidValue, critical, value) {
  const parts = [oid(oidValue)];
  if (critical) parts.push(bool(true));
  parts.push(octet(value));
  return seq(...parts);
}

function san(ips, dnsNames) {
  const entries = [];
  for (const dns of dnsNames) entries.push(tlv(0x82, Buffer.from(dns, 'ascii')));
  for (const ip of ips) {
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) continue;
    const bytes = ip.split('.').map((part) => Number.parseInt(part, 10));
    if (bytes.some((part) => part < 0 || part > 255)) continue;
    entries.push(tlv(0x87, Buffer.from(bytes)));
  }
  return seq(...entries);
}

function pem(label, der) {
  const body = der.toString('base64').match(/.{1,64}/g)?.join('\n') ?? '';
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function fingerprintOf(der) {
  return createHash('sha256').update(der).digest('hex');
}

function tbs({ version = 2, serialDer, issuer, subject, notBefore, notAfter, spki, extensions }) {
  return seq(
    explicit(0, integer(version)),
    serialDer,
    algorithm(),
    issuer,
    seq(utcTime(notBefore), utcTime(notAfter)),
    subject,
    spki,
    explicit(3, seq(...extensions)),
  );
}

function certificate(tbsDer, privateKey) {
  const signature = sign('sha256', tbsDer, privateKey);
  return seq(tbsDer, algorithm(), bitString(signature));
}

/**
 * Create a self-signed CA.
 * @param {{ commonName?: string, days?: number }} [options]
 * @returns {{ certPem: string, keyPem: string, certDer: Buffer, fingerprint: string, subjectDer: Buffer, privateKey: import('node:crypto').KeyObject }}
 */
export function createCa(options = {}) {
  const commonName = options.commonName ?? 'DSH Link Local CA';
  const days = options.days ?? 3650;
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const subject = name(commonName);
  const notBefore = new Date(Date.now() - 5 * 60 * 1000);
  const notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const extensions = [
    extension(OID_BASIC_CONSTRAINTS, true, seq(bool(true))),
    extension(OID_KEY_USAGE, true, keyUsage([5, 6])),
  ];
  const tbsDer = tbs({
    serialDer: serial(),
    issuer: subject,
    subject,
    notBefore,
    notAfter,
    spki,
    extensions,
  });
  const certDer = certificate(tbsDer, privateKey);
  return {
    certPem: pem('CERTIFICATE', certDer),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certDer,
    fingerprint: fingerprintOf(certDer),
    subjectDer: subject,
    privateKey,
  };
}

/**
 * Create a leaf server certificate signed by a CA created with createCa().
 * @param {{ ca: ReturnType<typeof createCa>, commonName?: string, ips?: string[], dnsNames?: string[], days?: number }} options
 * @returns {{ certPem: string, keyPem: string, certDer: Buffer, fingerprint: string }}
 */
export function createLeaf(options) {
  const ca = options.ca;
  const commonName = options.commonName ?? 'DSH Link';
  const days = options.days ?? 825;
  const ips = options.ips ?? [];
  const dnsNames = options.dnsNames ?? ['localhost'];
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const subject = name(commonName);
  const notBefore = new Date(Date.now() - 5 * 60 * 1000);
  const notAfter = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const extensions = [
    extension(OID_BASIC_CONSTRAINTS, true, seq()),
    extension(OID_KEY_USAGE, true, keyUsage([0, 2])),
    extension(OID_EXT_KEY_USAGE, false, seq(oid(OID_SERVER_AUTH))),
    extension(OID_SUBJECT_ALT_NAME, false, san(ips, dnsNames)),
  ];
  const tbsDer = tbs({
    serialDer: serial(),
    issuer: ca.subjectDer,
    subject,
    notBefore,
    notAfter,
    spki,
    extensions,
  });
  const certDer = certificate(tbsDer, ca.privateKey);
  return {
    certPem: pem('CERTIFICATE', certDer),
    keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certDer,
    fingerprint: fingerprintOf(certDer),
  };
}
