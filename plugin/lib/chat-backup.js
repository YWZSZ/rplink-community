import { appendFile, cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { batteryFor } from './battery.js';

const KEEP_SNAPSHOTS = 20;

/**
 * Plain-text chat archive independent of DSH session logs.
 *
 * Layout:
 *   <dataDir>/chat-logs/<characterId>/<chapterId>.jsonl
 *   <dataDir>/chat-logs/<characterId>/<chapterId>.json
 *   <dataDir>/chat-logs/<characterId>/<chapterId>.md
 *   <dataDir>/backups/<timestamp>-<reason>/
 */
export class ChatBackup {
  constructor({ dataDir, characters, logger }) {
    this.dataDir = dataDir;
    this.characters = characters;
    this.logger = logger;
    this.root = join(dataDir, 'chat-logs');
    this.backups = join(dataDir, 'backups');
    this.snapshotting = false;
  }

  async init() {
    await mkdir(this.root, { recursive: true });
    await mkdir(this.backups, { recursive: true });
  }

  async backfill(conversations, bridge) {
    for (const conversation of conversations || []) {
      try {
        const history = await bridge.history(conversation, 0);
        await this.ensure(conversation, history);
      } catch (error) {
        this.logger?.warn?.('[rp-bot] chat backup backfill failed for ' + conversation.id + ': ' + String(error?.message || error));
      }
    }
  }

  async ensure(conversation, history) {
    const paths = this.#paths(conversation);
    await mkdir(paths.dir, { recursive: true });
    if (await exists(paths.jsonl)) {
      const info = await stat(paths.jsonl).catch(() => null);
      if (info && info.size > 0) return false;
    }
    await this.#writeMeta(conversation);
    for (const message of history || []) {
      await appendFile(paths.jsonl, JSON.stringify({
        ts: new Date().toISOString(),
        role: message.role,
        text: message.text,
        backfilled: true,
      }) + '\n', 'utf8');
    }
    return true;
  }

  async append(conversation, role, text, extra = {}) {
    const value = String(text || '').trim();
    if (!value && !extra.image) return;
    const paths = this.#paths(conversation);
    await mkdir(paths.dir, { recursive: true });
    const line = {
      ts: new Date().toISOString(),
      role,
      text: value,
      ...extra,
    };
    await appendFile(paths.jsonl, JSON.stringify(line) + '\n', 'utf8');
    await this.#writeMeta(conversation);
  }

  async markArchived(conversation) {
    await this.#writeMeta(conversation);
    await this.#writeMarkdown(conversation);
  }

  async sync(conversation) {
    await this.#writeMeta(conversation);
  }

  async readHistory(conversation) {
    const paths = this.#paths(conversation);
    let raw = '';
    try {
      raw = await readFile(paths.jsonl, 'utf8');
    } catch {
      return [];
    }
    const result = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry.role !== 'user' && entry.role !== 'assistant' && entry.role !== 'system') continue;
      if (entry.image) {
        result.push({ role: entry.role, image: String(entry.image), sticker: entry.sticker === true });
        continue;
      }
      if (!entry.text) continue;
      if (entry.role === 'assistant' && Array.isArray(entry.bubbles) && entry.bubbles.length) {
        for (const bubble of entry.bubbles) {
          if (bubble) result.push({ role: 'assistant', text: String(bubble) });
        }
      } else {
        result.push({ role: entry.role, text: String(entry.text) });
      }
    }
    return result;
  }

  async snapshot(reason = 'manual') {
    if (this.snapshotting) return null;
    this.snapshotting = true;
    try {
      await mkdir(this.backups, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = join(this.backups, stamp + '-' + safe(reason));
      await mkdir(target, { recursive: true });
      await cp(this.root, join(target, 'chat-logs'), { recursive: true, force: true });
      for (const name of ['conversations.json', 'characters.json', 'prompts.json', 'settings.json']) {
        const source = join(this.dataDir, name);
        if (await exists(source)) await cp(source, join(target, name), { force: true });
      }
      await this.#prune();
      return target;
    } catch (error) {
      this.logger?.warn?.('[rp-bot] chat backup snapshot failed: ' + String(error?.message || error));
      return null;
    } finally {
      this.snapshotting = false;
    }
  }

  async #prune() {
    const entries = await readdir(this.backups, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    while (dirs.length > KEEP_SNAPSHOTS) {
      const name = dirs.shift();
      await rm(join(this.backups, name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async #writeMeta(conversation) {
    const paths = this.#paths(conversation);
    await mkdir(paths.dir, { recursive: true });
    const character = (this.characters?.value?.characters || []).find((entry) => entry.id === conversation.characterId);
    const meta = {
      id: conversation.id,
      characterId: conversation.characterId,
      characterName: character?.name || conversation.title || conversation.characterId,
      index: conversation.index,
      status: conversation.status || 'active',
      title: conversation.title,
      summary: conversation.summary || '',
      mode: conversation.mode || 'chat',
      effects: Array.isArray(conversation.effects) ? conversation.effects : [],
      timeMode: conversation.timeMode || 'real',
      worldOffsetMs: Number(conversation.worldOffsetMs) || 0,
      tokens: Number(conversation.tokens) || 0,
      battery: Number.isFinite(Number(conversation.battery))
        ? Number(conversation.battery)
        : batteryFor(conversation.tokens || 0),
      startedRealTime: conversation.startedRealTime,
      startedWorldTime: conversation.startedWorldTime,
      endedRealTime: conversation.endedRealTime,
      endedWorldTime: conversation.endedWorldTime,
      updatedAt: new Date().toISOString(),
    };
    const temp = paths.meta + '.tmp';
    await writeFile(temp, JSON.stringify(meta, null, 2), 'utf8');
    await rename(temp, paths.meta);
  }

  async #writeMarkdown(conversation) {
    const paths = this.#paths(conversation);
    let meta = {};
    try { meta = JSON.parse(await readFile(paths.meta, 'utf8')); } catch { /* ignore */ }
    const lines = [];
    lines.push('# ' + (meta.characterName || conversation.title || conversation.characterId) + ' · 第' + (conversation.index || '?') + '章');
    lines.push('');
    lines.push('- 状态：' + (conversation.status === 'archived' ? '已归档' : '进行中'));
    lines.push('- 真实时间：' + (conversation.startedRealTime || '?') + ' → ' + (conversation.endedRealTime || '进行中'));
    lines.push('- 世界时间：' + (conversation.startedWorldTime || '?') + ' → ' + (conversation.endedWorldTime || '进行中'));
    lines.push('- 电量：' + (conversation.battery ?? '?') + '%');
    if (conversation.summary) lines.push('- 前情：' + conversation.summary);
    lines.push('');
    let raw = '';
    try { raw = await readFile(paths.jsonl, 'utf8'); } catch { /* ignore */ }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      lines.push(entry.role === 'user' ? '**你**' : (entry.role === 'system' ? '**系统**' : '**' + (meta.characterName || '角色') + '**'));
      lines.push('');
      lines.push(String(entry.text || ''));
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    await writeFile(paths.md, lines.join('\n'), 'utf8');
  }

  #paths(conversation) {
    const characterId = safe(conversation.characterId || 'default');
    const chapterId = safe(conversation.id || 'chapter');
    const dir = join(this.root, characterId);
    return {
      dir,
      jsonl: join(dir, chapterId + '.jsonl'),
      meta: join(dir, chapterId + '.json'),
      md: join(dir, chapterId + '.md'),
    };
  }
}

function safe(value) {
  return String(value || 'x').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
