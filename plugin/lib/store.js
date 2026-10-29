import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export { defaultCharacter } from './characters.js';

export class JsonStore {
  constructor(path, fallback) {
    this.path = path;
    this.fallback = fallback;
    this.value = fallback;
    this.ready = this.#load();
  }

  async #load() {
    try {
      const raw = await readFile(this.path, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') this.value = parsed;
    } catch {
      this.value = this.fallback;
    }
  }

  async save() {
    await this.ready;
    await mkdir(dirname(this.path), { recursive: true });
    const temp = this.path + '.tmp';
    await writeFile(temp, JSON.stringify(this.value, null, 2), 'utf8');
    await rename(temp, this.path);
  }
}
