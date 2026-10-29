import { copyFile, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN = join(ROOT, 'plugin');
const PRESET = join(ROOT, 'preset');
const profileArg = process.argv.find((item) => item.startsWith('--profile='));
const PROFILE = profileArg
  ? profileArg.slice('--profile='.length)
  : join(homedir(), '.dsh', 'profiles', 'desktop');
const PACKAGE_PATH = join(PROFILE, 'package.json');
const PATCH_PATH = join(PROFILE, 'cordis.patch.yml');
const rollback = process.argv.includes('--rollback');

if (rollback) {
  const entries = await import('node:fs/promises').then((fs) => fs.readdir(PROFILE));
  const pkgBackup = entries.filter((name) => name.startsWith('package.json.bak-rpbot-')).sort().pop();
  const patchBackup = entries.filter((name) => name.startsWith('cordis.patch.yml.bak-rpbot-')).sort().pop();
  if (!pkgBackup) {
    console.error('no rpbot backup found in', PROFILE);
    process.exit(1);
  }
  await copyFile(join(PROFILE, pkgBackup), PACKAGE_PATH);
  if (patchBackup) await copyFile(join(PROFILE, patchBackup), PATCH_PATH);
  await removeLink(join(PROFILE, 'node_modules', 'dsh-rp-bot'));
  await removeLink(join(PROFILE, 'node_modules', '@local', 'dsh-rp-preset'));
  console.log('rolled back from', pkgBackup);
  process.exit(0);
}

await mkdir(join(PROFILE, 'node_modules', '@local'), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await copyFile(PACKAGE_PATH, PACKAGE_PATH + '.bak-rpbot-' + stamp).catch(() => {});
await copyFile(PATCH_PATH, PATCH_PATH + '.bak-rpbot-' + stamp).catch(() => {});

const pkg = JSON.parse(await readFile(PACKAGE_PATH, 'utf8'));
pkg.dependencies = pkg.dependencies || {};
pkg.dependencies['dsh-rp-bot'] = 'link:' + PLUGIN.replace(/\\/g, '/');
pkg.dependencies['@local/dsh-rp-preset'] = 'link:' + PRESET.replace(/\\/g, '/');

const bundles = pkg.dsh?.profile?.bundles;
if (!Array.isArray(bundles)) throw new Error('profile bundles missing; open DSH desktop at least once');
for (const name of ['@local/dsh-rp-preset', 'dsh-rp-bot']) {
  if (!bundles.includes(name)) bundles.push(name);
}
await writeFile(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

await relink(PLUGIN, join(PROFILE, 'node_modules', 'dsh-rp-bot'));
await relink(PRESET, join(PROFILE, 'node_modules', '@local', 'dsh-rp-preset'));

console.log('installed dsh-rp-bot + @local/dsh-rp-preset into', PROFILE);
console.log('backup stamp:', stamp);
console.log('next: fully quit and reopen DSH');
console.log('if DSH reports missing modules, run: cd plugin && npm install --omit=dev');

async function relink(target, linkPath) {
  await removeLink(linkPath);
  await symlink(target, linkPath, 'junction');
}

async function removeLink(linkPath) {
  try {
    await rm(linkPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}
