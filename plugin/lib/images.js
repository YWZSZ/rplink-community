import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Generic image provider.
 *
 * Configure `imageProvider.url` (and optional `imageProvider.token`) in the
 * RPLink plugin config. The URL receives JSON:
 *   { model, prompt, orientation, width, height }
 * and must return either:
 *   { "image_base64": "..." }
 *   { "image_url": "https://..." }
 * or an image body with an image/* content type.
 */
export class ImageService {
  constructor({ dataDir, config, logger }) {
    this.mediaDir = join(dataDir, 'media');
    this.config = config?.imageProvider || {};
    this.logger = logger;
  }

  async init() {
    await mkdir(this.mediaDir, { recursive: true });
  }

  mediaPath(id) {
    if (!/^[a-f0-9-]{8,64}$/i.test(String(id || ''))) return null;
    return join(this.mediaDir, String(id) + '.png');
  }

  async generate({ character, prompt, width, height, orientation }) {
    const url = String(this.config.url || '').trim();
    if (!url) throw new Error('image provider is not configured');
    const sizes = {
      portrait: { width: 864, height: 1536 },
      landscape: { width: 1536, height: 864 },
      square: { width: 1024, height: 1024 },
    };
    const size = sizes[String(orientation || 'portrait').toLowerCase()] || sizes.portrait;
    const body = JSON.stringify({
      model: String(character || ''),
      prompt: String(prompt || ''),
      orientation: String(orientation || 'portrait'),
      width: Number(width) || size.width,
      height: Number(height) || size.height,
    });
    const headers = { 'content-type': 'application/json' };
    if (this.config.token) headers.authorization = 'Bearer ' + this.config.token;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(Number(this.config.timeoutMs) || 360000),
    });
    if (!response.ok) throw new Error('image provider HTTP ' + response.status);
    const type = String(response.headers.get('content-type') || '');
    let bytes;
    if (type.startsWith('image/')) {
      bytes = Buffer.from(await response.arrayBuffer());
    } else {
      const payload = await response.json();
      if (payload.image_base64) {
        bytes = Buffer.from(String(payload.image_base64), 'base64');
      } else if (payload.image_url) {
        const image = await fetch(String(payload.image_url), { signal: AbortSignal.timeout(120000) });
        if (!image.ok) throw new Error('image download HTTP ' + image.status);
        bytes = Buffer.from(await image.arrayBuffer());
      } else {
        throw new Error('image provider returned no image');
      }
    }
    if (!bytes?.length) throw new Error('image provider returned empty image');
    const id = randomUUID();
    await writeFile(join(this.mediaDir, id + '.png'), bytes);
    return { id, path: join(this.mediaDir, id + '.png'), cost: 0 };
  }
}
