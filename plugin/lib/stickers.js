import { cp, mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = fileURLToPath(new URL('../assets/stickers', import.meta.url));

export class StickerService {
  constructor({ dataDir, logger }) {
    this.root = join(dataDir, 'stickers');
    this.logger = logger;
    this.cache = new Map();
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    await this.#ensureDefaults();
    await this.loadAll();
  }

  async loadAll() {
    try {
      const entries = await import('node:fs/promises').then((fs) => fs.readdir(this.root, { withFileTypes: true }));
      for (const entry of entries) {
        if (entry.isDirectory()) await this.pack(entry.name);
      }
    } catch (error) {
      this.logger?.warn?.('[rp-bot] sticker packs unavailable: ' + String(error?.message || error));
    }
  }

  tagListSync(name) {
    const pack = this.cache.get(String(name || ''));
    if (!pack) return [];
    return [...new Set(pack.stickers.flatMap((sticker) => sticker.tags))];
  }

  async #ensureDefaults() {
    try {
      const dirs = await import('node:fs/promises').then((fs) => fs.readdir(ASSETS, { withFileTypes: true }));
      for (const entry of dirs) {
        if (!entry.isDirectory()) continue;
        const target = join(this.root, entry.name);
        if (await exists(target)) continue;
        await cp(join(ASSETS, entry.name), target, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger?.warn?.('[rp-bot] sticker defaults unavailable: ' + String(error?.message || error));
    }
  }

  async pack(name) {
    const id = String(name || '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!id) return null;
    if (this.cache.has(id)) return this.cache.get(id);
    try {
      const data = JSON.parse(await readFile(join(this.root, id, 'stickers.json'), 'utf8'));
      const stickers = (Array.isArray(data.stickers) ? data.stickers : [])
        .filter((item) => item && item.file && Array.isArray(item.tags))
        .map((item) => ({
          file: String(item.file),
          tags: item.tags.map((tag) => String(tag).trim()).filter(Boolean),
          desc: String(item.desc || ''),
        }));
      const value = { id, name: String(data.name || id), stickers };
      this.cache.set(id, value);
      return value;
    } catch {
      return null;
    }
  }

  async path(packName, file) {
    const pack = await this.pack(packName);
    if (!pack) return null;
    const sticker = pack.stickers.find((item) => item.file === file);
    if (!sticker) return null;
    const full = join(this.root, pack.id, sticker.file);
    return (await exists(full)) ? full : null;
  }

  async pick(packName, tags) {
    const pack = await this.pack(packName);
    if (!pack) return null;
    const wanted = [...new Set((tags || []).map((tag) => String(tag).trim()).filter(Boolean))];
    if (!wanted.length) return null;
    let best = null;
    let bestScore = 0;
    for (const sticker of pack.stickers) {
      let score = 0;
      for (const tag of wanted) {
        if (sticker.tags.some((entry) => entry === tag)) score += 2;
        else if (sticker.tags.some((entry) => entry.includes(tag) || tag.includes(entry))) score += 1;
      }
      if (score > bestScore) {
        best = sticker;
        bestScore = score;
      }
    }
    return best;
  }

  async tags(packName) {
    const pack = await this.pack(packName);
    if (!pack) return [];
    return [...new Set(pack.stickers.flatMap((sticker) => sticker.tags))];
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function parseStickerMarkers(text) {
  const value = String(text || '');
  const tags = [];
  const regex = /\[\[STICKER:\s*([^\]]+?)\s*\]\]/gi;
  let match;
  while ((match = regex.exec(value)) !== null) {
    const parts = match[1].split(/[,，、|]/).map((item) => item.trim()).filter(Boolean);
    if (parts.length) tags.push(parts);
  }
  const cleaned = value.replace(/\[\[STICKER:\s*[^\]]+?\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, tags };
}

export function stickerPrompt(character, tags) {
  const config = character?.stickers || {};
  if (config.enabled !== true || !config.pack || !Array.isArray(tags) || tags.length === 0) return '';
  const max = Math.max(1, Math.min(3, Number(config.maxPerReply) || 3));
  return [
    '[表情包能力]',
    '你可以在合适的时候给用户发表情包，作为文字之外的补充反应。',
    '需要发时，在回复最后单独输出标记，每行一个：',
    '[[STICKER: 标签]]',
    '可用标签：' + tags.join('、'),
    '一般只发 1 个；最多 ' + max + ' 个。',
    '同一张表情包可以重复，但总数不要超过 ' + max + ' 个。',
    '正文不要解释“表情包”“图片”“标签”，也不要说“我发个表情包”；让标记自己出现。',
    '不要在正文里写英文 tag 列表。',
  ].join('\n');
}
