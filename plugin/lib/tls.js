// Local CA and server certificate lifecycle. The CA is stable across LAN IP
// changes; only the leaf is reissued so an already-paired phone can keep its
// pinned CA fingerprint.
import { createHash, createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite, readJsonFile, writeJsonFile } from './util.js';
import { createCa, createLeaf } from './x509.js';

/**
 * Ensure a CA and a leaf covering `ip`.
 * @param {string} dir - plugin data directory.
 * @param {string} ip - LAN address to include in the SAN.
 * @param {{ commonName?: string }} [options]
 */
export async function ensureTls(dir, ip, options = {}) {
  const caPemPath = join(dir, 'tls', 'ca.pem');
  const caKeyPath = join(dir, 'tls', 'ca-key.pem');
  const caDerPath = join(dir, 'tls', 'ca.der');
  const caSubjectPath = join(dir, 'tls', 'ca-subject.der');
  const metaPath = join(dir, 'tls', 'meta.json');
  const serverPemPath = join(dir, 'tls', 'server.pem');
  const serverKeyPath = join(dir, 'tls', 'server-key.pem');

  let ca = await loadCa({ caPemPath, caKeyPath, caDerPath, caSubjectPath });
  if (ca === undefined) {
    ca = createCa();
    await atomicWrite(caPemPath, ca.certPem);
    await atomicWrite(caKeyPath, ca.keyPem);
    await atomicWrite(caDerPath, ca.certDer);
    await atomicWrite(caSubjectPath, ca.subjectDer);
  }

  const meta = await readJsonFile(metaPath, {});
  let serverPem;
  let serverKeyPem;
  let serverDer;
  let certFingerprint;
  if (meta?.ip === ip && typeof meta?.certFingerprint === 'string') {
    try {
      serverPem = await readFile(serverPemPath, 'utf8');
      serverKeyPem = await readFile(serverKeyPath, 'utf8');
      serverDer = Buffer.from(meta.certDer, 'base64');
      certFingerprint = meta.certFingerprint;
    } catch {
      serverPem = undefined;
    }
  }
  if (serverPem === undefined || serverKeyPem === undefined) {
    const leaf = createLeaf({
      ca,
      commonName: options.commonName ?? 'DSH Link',
      ips: [ip, '127.0.0.1'],
      dnsNames: ['localhost'],
    });
    serverPem = leaf.certPem;
    serverKeyPem = leaf.keyPem;
    serverDer = leaf.certDer;
    certFingerprint = leaf.fingerprint;
    await atomicWrite(serverPemPath, serverPem);
    await atomicWrite(serverKeyPath, serverKeyPem);
    await writeJsonFile(metaPath, {
      ip,
      certFingerprint,
      certDer: serverDer.toString('base64'),
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    caPem: ca.certPem,
    caFingerprint: ca.fingerprint,
    certPem: serverPem,
    keyPem: serverKeyPem,
    certFingerprint,
    certDer: serverDer,
    ip,
  };
}

async function loadCa({ caPemPath, caKeyPath, caDerPath, caSubjectPath }) {
  try {
    const [certPem, keyPem, certDer, subjectDer] = await Promise.all([
      readFile(caPemPath, 'utf8'),
      readFile(caKeyPath, 'utf8'),
      readFile(caDerPath),
      readFile(caSubjectPath),
    ]);
    return {
      certPem,
      keyPem,
      certDer,
      subjectDer,
      fingerprint: createHash('sha256').update(certDer).digest('hex'),
      privateKey: createPrivateKey(keyPem),
    };
  } catch {
    return undefined;
  }
}
