import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { appendFile, copyFile, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:https';
import { WebSocketServer } from 'ws';
import { batteryFor, estimateTokens } from './battery.js';
import { normalizeCharacter } from './characters.js';
import { commandCatalog, matchTrigger, normalizeTemplate, parseCommand } from './effect-templates.js';
import { applyAdHoc, applyTemplate, decrementEffectState, effectsForState, setEffectsForState } from './effect-state.js';
import { parsePhotoMarker } from './photo.js';
import { parseStickerMarkers } from './stickers.js';
import { pickLanAddress } from './config.js';
import { PairingManager } from './pairing.js';
import { splitForMode } from './modes.js';
import { defaultPrompts } from './prompts.js';
import { bubbleDelay } from './reply.js';
import { conversationTime } from './time.js';
import { ensureTls } from './tls.js';
import { memoryUserFor, normalizeWorldline, worldlineMemoryUser } from './worldlines.js';
import { clientIp, isLoopback } from './util.js';

export class RpServer {
  constructor({ ctx, config, dataDir, characters, conversations, devices, settings, prompts, effectTemplates, effectStates, worldlines, backup, images, stickers, bridge, logger }) {
    this.ctx = ctx;
    this.config = config;
    this.dataDir = dataDir;
    this.characters = characters;
    this.conversations = conversations;
    this.devices = devices;
    this.settings = settings;
    this.prompts = prompts;
    this.effectTemplates = effectTemplates;
    this.effectStates = effectStates;
    this.worldlines = worldlines;
    this.backup = backup;
    this.images = images;
    this.stickers = stickers;
    this.bridge = bridge;
    this.logger = logger;
    this.server = null;
    this.wss = null;
    this.tls = null;
    this.busy = new Set();
    this.clients = new Map();
    this.port = null;
    this.pairing = new PairingManager({ serverId: config.serverId || 'rplink', serverName: 'RPLink' });
  }

  async start() {
    if (this.server) return this.port;

    const preferred = this.config.bindAddress && this.config.bindAddress !== '0.0.0.0'
      ? this.config.bindAddress
      : '';
    const lan = pickLanAddress(preferred);
    const address = lan?.address || '127.0.0.1';
    this.tls = await ensureTls(this.dataDir, address, { commonName: 'RPLink' });

    this.server = createServer(
      { key: this.tls.keyPem, cert: this.tls.certPem },
      (request, response) => {
        this.#handleHttp(request, response).catch((error) => {
          this.logger?.warn?.('[rp-bot] http failed: ' + String(error));
          sendJson(response, 500, { ok: false, error: 'internal error' });
        });
      },
    );

    this.wss = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (request, socket, head) => {
      this.#handleUpgrade(request, socket, head);
    });

    const port = Number(this.config.port) || 3456;
    const bind = this.config.bindAddress || '0.0.0.0';
    await new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.server.once('error', onError);
      this.server.listen(port, bind, () => {
        this.server.off('error', onError);
        resolve();
      });
    });
    this.port = port;
    this.logger?.info?.(`[rp-bot] listening on https://${address}:${port}`);
    return port;
  }

  async close() {
    if (this.wss) this.wss.close();
    if (this.server) {
      await new Promise((resolve) => this.server.close(() => resolve()));
    }
    this.wss = null;
    this.server = null;
    await this.bridge.close();
  }

  state() {
    const link = this.port && this.tls
      ? this.pairing.link({
        address: this.tls.ip,
        port: this.port,
        caFingerprint: this.tls.caFingerprint,
      })
      : null;
    return {
      running: this.server !== null,
      port: this.port,
      bindAddress: this.config.bindAddress || '0.0.0.0',
      address: this.tls?.ip || null,
      caFingerprint: this.tls?.caFingerprint || null,
      pairing: link
        ? { code: link.code, expiresAt: link.expiresAt, url: link.url }
        : null,
      devices: (this.devices.value.devices || []).map((device) => ({
        id: device.id,
        name: device.name,
        lastSeenAt: device.lastSeenAt,
      })),
      conversations: (this.conversations.value.conversations || []).map((entry) => this.#view(entry)),
      worldlines: (this.worldlines?.value?.worldlines || []).map((line) => ({
        id: line.id,
        characterId: line.characterId,
        name: line.name,
        premise: line.premise,
        premiseEnabled: line.premiseEnabled,
        isDefault: line.isDefault,
      })),
      characters: (this.characters.value.characters || []).map((character) => ({
        id: character.id,
        name: character.name,
        tagline: character.tagline,
      })),
    };
  }

  #view(conversation) {
    const line = this._worldline(conversation.worldlineId);
    return {
      ...conversation,
      worldlineName: line?.name || '',
      effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)),
      tokens: Number(conversation.tokens) || 0,
      battery: batteryFor(conversation.tokens || 0),
      archived: conversation.status === 'archived',
    };
  }

  async normalizeChapters() {
    const list = this.conversations.value.conversations || [];
    const groups = new Map();
    for (const entry of list) {
      const key = entry.worldlineId || entry.characterId || 'default';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    let changed = false;
    for (const entries of groups.values()) {
      entries.sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')));
      let activeSeen = false;
      entries.forEach((entry, index) => {
        if (!Number.isFinite(Number(entry.index)) || Number(entry.index) < 1) {
          entry.index = index + 1;
          changed = true;
        }
        if (!entry.timeMode) {
          entry.timeMode = 'real';
          changed = true;
        }
        if (!Number.isFinite(Number(entry.worldOffsetMs))) {
          entry.worldOffsetMs = 0;
          changed = true;
        }
        if (!entry.status) {
          entry.status = index === entries.length - 1 ? 'active' : 'archived';
          changed = true;
        }
        if (entry.status === 'active') {
          if (activeSeen) {
            entry.status = 'archived';
            changed = true;
          }
          activeSeen = true;
        }
        if (!entry.createdAt) {
          entry.createdAt = new Date().toISOString();
          changed = true;
        }
        if (!entry.startedRealTime) {
          entry.startedRealTime = entry.createdAt;
          changed = true;
        }
        if (!entry.startedWorldTime) {
          const when = new Date(entry.createdAt);
          const offset = entry.timeMode === 'world' ? Number(entry.worldOffsetMs) || 0 : 0;
          entry.startedWorldTime = new Date(when.getTime() + offset).toISOString();
          changed = true;
        }
        if (!Number.isFinite(Number(entry.tokens))) {
          entry.tokens = 0;
          changed = true;
        }
        if (!Number.isFinite(Number(entry.imageCount))) {
          entry.imageCount = 0;
          changed = true;
        }
      });
      if (!activeSeen && entries.length > 0) {
        entries[entries.length - 1].status = 'active';
        changed = true;
      }
    }
    if (changed) await this.conversations.save();
  }

  async #handleDraw(conversation, request, send, frame) {
    const character = (this.characters.value.characters || []).find((entry) => entry.id === conversation.characterId);
    const image = character?.image || {};
    const cards = Array.isArray(image.cards) ? image.cards.filter(Boolean) : [];
    if (!request) {
      send({ type: 'command.applied', conversationId: conversation.id, text: '用法：/draw 画面描述', effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)) });
      send({ type: 'assistant.done', conversationId: conversation.id });
      return;
    }
    if (image.enabled !== true || cards.length === 0) {
      send({ type: 'command.applied', conversationId: conversation.id, text: '这个角色还没有启用生图。', effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)) });
      send({ type: 'assistant.done', conversationId: conversation.id });
      return;
    }
    const limit = Math.max(1, Number(image.maxPerChapter) || 3);
    if ((Number(conversation.imageCount) || 0) >= limit) {
      send({ type: 'command.applied', conversationId: conversation.id, text: '本章发图次数已用完。', effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)) });
      send({ type: 'assistant.done', conversationId: conversation.id });
      return;
    }
    this.busy.add(conversation.id);
    send({ type: 'message.accepted', conversationId: conversation.id, clientId: frame.clientId });
    send({ type: 'assistant.typing', conversationId: conversation.id, active: true, label: '图片加载中…' });
    try {
      const prompt = await this.bridge.drawPrompt(conversation, request);
      const result = await this.images.generate({
        character: prompt.card,
        prompt: prompt.tags,
        orientation: prompt.orientation,
      });
      conversation.imageCount = (Number(conversation.imageCount) || 0) + 1;
      await this.conversations.save();
      if (this.backup) {
        await this.backup.append(conversation, 'system', '/draw ' + request, { source: 'command' }).catch(() => {});
        await this.backup.append(conversation, 'assistant', '', {
          image: result.id,
          mode: conversation.mode || 'chat',
        }).catch(() => {});
      }
      send({ type: 'assistant.image', conversationId: conversation.id, mediaId: result.id, caption: '' });
    } catch (error) {
      this.logger?.warn?.('[rp-bot] /draw failed: ' + String(error?.message || error));
      await appendFile(
        join(this.dataDir, 'image-errors.log'),
        new Date().toISOString() + ' /draw ' + String(error?.stack || error) + '\n',
        'utf8',
      ).catch(() => {});
      send({ type: 'assistant.image.failed', conversationId: conversation.id, text: '图片未成功生成。' });
    } finally {
      send({ type: 'assistant.typing', conversationId: conversation.id, active: false });
      send({ type: 'assistant.done', conversationId: conversation.id });
      this.busy.delete(conversation.id);
    }
  }

  async #prepareStickers(conversation, tagGroups) {
    const character = (this.characters.value.characters || []).find((entry) => entry.id === conversation.characterId);
    const config = character?.stickers || {};
    if (config.enabled !== true || !config.pack || !Array.isArray(tagGroups) || tagGroups.length === 0) return [];
    const max = Math.max(1, Math.min(3, Number(config.maxPerReply) || 3));
    const ids = [];
    for (const tags of tagGroups) {
      if (ids.length >= max) break;
      const picked = await this.stickers?.pick(config.pack, tags);
      if (!picked) continue;
      const source = await this.stickers.path(config.pack, picked.file);
      if (!source) continue;
      const mediaId = randomUUID();
      try {
        await copyFile(source, join(this.dataDir, 'media', mediaId + '.png'));
        ids.push(mediaId);
      } catch (error) {
        this.logger?.warn?.('[rp-bot] sticker copy failed: ' + String(error?.message || error));
      }
    }
    return ids;
  }

  async #applyEffectTemplate(conversation, template, source) {
    const state = { effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)) };
    const result = applyTemplate(state, template, source);
    if (result.status !== 'blocked') {
      setEffectsForState(this.effectStates.value, this._effectKey(conversation), result.effects);
      await this.effectStates.save();
      if (this.backup) await this.backup.sync(conversation).catch(() => {});
    }
    return result;
  }

  async #saveCharacterEffects(conversation, effects) {
    setEffectsForState(this.effectStates.value, this._effectKey(conversation), effects);
    await this.effectStates.save();
    if (this.backup) await this.backup.sync(conversation).catch(() => {});
  }

  createPairing() {
    this.pairing.create();
    return this.state().pairing;
  }

  async qrPng() {
    const link = this.state().pairing;
    if (!link) return undefined;
    return this.pairing.qrPng(link);
  }

  async revokeDevice(id) {
    const before = this.devices.value.devices || [];
    const device = before.find((entry) => entry.id === id);
    if (!device) return false;
    this.devices.value.devices = before.filter((entry) => entry.id !== id);
    await this.devices.save();
    for (const [ws, owner] of this.clients.entries()) {
      if (owner?.id === id && ws.readyState === 1) {
        try { ws.close(4001, 'revoked'); } catch { /* ignore */ }
      }
    }
    return true;
  }

  listCharacters() {
    return this.characters.value.characters || [];
  }

  async saveCharacter(body = {}) {
    const list = this.characters.value.characters || [];
    const requestedId = String(body.id || '').trim();
    const existing = list.find((entry) => entry.id === requestedId);
    const name = String(body.name || existing?.name || '').trim();
    if (!name) throw new Error('character name is required');
    const id = existing
      ? existing.id
      : (requestedId && /^[a-z0-9-]+$/.test(requestedId) ? requestedId : 'char-' + Date.now().toString(36));
    const next = normalizeCharacter({
      ...(existing || {}),
      ...body,
      id,
      name,
    });
    const index = list.findIndex((entry) => entry.id === id);
    if (index >= 0) list[index] = next;
    else list.push(next);
    this.characters.value.characters = list;
    await this.characters.save();
    await this.bridge.reconfigureAll().catch(() => {});
    return next;
  }

  async deleteCharacter(id) {
    const list = this.characters.value.characters || [];
    if (list.length <= 1) throw new Error('cannot delete the last character');
    const next = list.filter((entry) => entry.id !== id);
    if (next.length === list.length) return false;
    this.characters.value.characters = next;
    await this.characters.save();
    return true;
  }

  listEffectTemplates() {
    return (this.effectTemplates?.value?.templates || []).map(normalizeTemplate);
  }

  async saveEffectTemplate(body = {}) {
    const list = this.effectTemplates?.value?.templates || [];
    const requested = String(body.id || '').trim();
    const existing = list.find((entry) => entry.id === requested);
    const id = existing
      ? existing.id
      : (requested && /^[a-z0-9-]+$/.test(requested) ? requested : 'eff-' + Date.now().toString(36));
    const next = normalizeTemplate({
      ...(existing || {}),
      ...body,
      id,
      createdAt: existing?.createdAt || new Date().toISOString(),
    });
    if (!next.name || !next.prompt) throw new Error('effect name and prompt required');
    const index = list.findIndex((entry) => entry.id === id);
    if (index >= 0) list[index] = next;
    else list.push(next);
    this.effectTemplates.value.templates = list;
    await this.effectTemplates.save();
    return next;
  }

  async deleteEffectTemplate(id) {
    const list = this.effectTemplates?.value?.templates || [];
    const next = list.filter((entry) => entry.id !== id);
    if (next.length === list.length) return false;
    this.effectTemplates.value.templates = next;
    await this.effectTemplates.save();
    return true;
  }

  getPrompts() {
    return this.prompts.value;
  }

  async updatePrompts(body = {}) {
    const defaults = defaultPrompts();
    const value = this.prompts.value;
    for (const key of ['framework', 'chat', 'meeting']) {
      if (typeof body[key] !== 'string') continue;
      const text = body[key].trim();
      value[key] = text ? text.slice(0, 20000) : defaults[key];
    }
    await this.prompts.save();
    return value;
  }

  async updateSettings(body = {}) {
    const value = this.settings.value;
    const reconfigure = ['provider', 'model', 'reasoningEffort', 'maxTokens', 'chatMaxTokens', 'meetingMaxTokens']
      .some((key) => body[key] !== undefined);
    if (typeof body.provider === 'string' && body.provider.trim()) value.provider = body.provider.trim();
    if (typeof body.model === 'string' && body.model.trim()) value.model = body.model.trim();
    if (['off', 'low', 'high', 'max'].includes(body.reasoningEffort)) value.reasoningEffort = body.reasoningEffort;
    if (Number.isFinite(Number(body.maxTokens))) value.maxTokens = Math.min(8000, Math.max(100, Math.trunc(Number(body.maxTokens))));
    if (Number.isFinite(Number(body.chatMaxTokens))) value.chatMaxTokens = Math.min(8000, Math.max(100, Math.trunc(Number(body.chatMaxTokens))));
    if (Number.isFinite(Number(body.meetingMaxTokens))) value.meetingMaxTokens = Math.min(8000, Math.max(100, Math.trunc(Number(body.meetingMaxTokens))));
    if (Number.isFinite(Number(body.replyDelayMinMs))) {
      value.replyDelayMinMs = Math.min(120000, Math.max(0, Math.trunc(Number(body.replyDelayMinMs))));
    }
    if (Number.isFinite(Number(body.replyDelayMaxMs))) {
      value.replyDelayMaxMs = Math.min(120000, Math.max(0, Math.trunc(Number(body.replyDelayMaxMs))));
    }
    if (Number(value.replyDelayMaxMs) < Number(value.replyDelayMinMs)) {
      value.replyDelayMaxMs = value.replyDelayMinMs;
    }
    if (Number.isFinite(Number(body.replyTimeoutMs))) {
      value.replyTimeoutMs = Math.min(600000, Math.max(10000, Math.trunc(Number(body.replyTimeoutMs))));
    }
    if (typeof body.memoryEndpoint === 'string') {
      value.memoryEndpoint = body.memoryEndpoint.trim();
    }
    await this.settings.save();
    if (reconfigure) await this.bridge.reconfigureAll();
    return value;
  }

  async memoryStatus() {
    const endpoint = String(this.settings.value.memoryEndpoint || '').replace(/\/+$/, '');
    if (!endpoint) return { endpoint: '', healthy: false, enabled: false, version: '', status: 'disabled' };
    try {
      const response = await fetch(endpoint + '/health', { signal: AbortSignal.timeout(3000) });
      const body = await response.json().catch(() => ({}));
      return { endpoint, healthy: response.ok && body?.healthy === true, version: body?.version || '', status: body?.status || '' };
    } catch (error) {
      return { endpoint, healthy: false, version: '', status: '', error: String(error?.message || error) };
    }
  }

  async handleAdmin(request, response) {
    if (!isLoopback(request)) {
      sendJson(response, 403, { ok: false, error: 'loopback only' });
      return;
    }
    const url = new URL(request.url || '/', 'http://localhost');
    const path = url.pathname.replace(/^\/api\/(?:rp-bot|admin)/, '') || '/state';

    if (request.method === 'GET' && path === '/state') {
      sendJson(response, 200, { ok: true, ...this.state() });
      return;
    }
    if (request.method === 'POST' && path === '/pairing') {
      sendJson(response, 200, { ok: true, pairing: this.createPairing() });
      return;
    }
    if (request.method === 'GET' && path === '/qr') {
      const png = await this.qrPng();
      if (!png) {
        sendJson(response, 404, { ok: false, error: 'no pairing code' });
        return;
      }
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': png.length,
        'cache-control': 'no-store',
      });
      response.end(png);
      return;
    }
    if (request.method === 'POST' && path === '/devices/revoke') {
      const body = await readJson(request);
      const revoked = await this.revokeDevice(String(body.id || ''));
      sendJson(response, revoked ? 200 : 404, { ok: revoked, ...this.state() });
      return;
    }
    if (request.method === 'GET' && path === '/characters') {
      sendJson(response, 200, { ok: true, characters: this.listCharacters() });
      return;
    }
    if (request.method === 'POST' && path === '/characters') {
      try {
        const character = await this.saveCharacter(await readJson(request));
        sendJson(response, 200, { ok: true, character, characters: this.listCharacters() });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    if (request.method === 'POST' && path === '/characters/delete') {
      try {
        const body = await readJson(request);
        const deleted = await this.deleteCharacter(String(body.id || ''));
        sendJson(response, deleted ? 200 : 404, { ok: deleted, characters: this.listCharacters() });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    if (request.method === 'GET' && path === '/settings') {
      sendJson(response, 200, { ok: true, settings: this.settings.value });
      return;
    }
    if (request.method === 'POST' && path === '/settings') {
      const settings = await this.updateSettings(await readJson(request));
      sendJson(response, 200, { ok: true, settings });
      return;
    }
    if (request.method === 'GET' && path === '/prompts') {
      sendJson(response, 200, { ok: true, prompts: this.getPrompts() });
      return;
    }
    if (request.method === 'POST' && path === '/prompts') {
      const prompts = await this.updatePrompts(await readJson(request));
      sendJson(response, 200, { ok: true, prompts });
      return;
    }
    if (request.method === 'GET' && path === '/effect-templates') {
      sendJson(response, 200, { ok: true, templates: this.listEffectTemplates() });
      return;
    }
    if (request.method === 'POST' && path === '/effect-templates') {
      try {
        const template = await this.saveEffectTemplate(await readJson(request));
        sendJson(response, 200, { ok: true, template, templates: this.listEffectTemplates() });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    if (request.method === 'POST' && path === '/effect-templates/delete') {
      const body = await readJson(request);
      const deleted = await this.deleteEffectTemplate(String(body.id || ''));
      sendJson(response, deleted ? 200 : 404, { ok: deleted, templates: this.listEffectTemplates() });
      return;
    }
    if (request.method === 'GET' && path === '/memory') {
      sendJson(response, 200, { ok: true, memory: await this.memoryStatus() });
      return;
    }
    sendJson(response, 404, { ok: false, error: 'not found' });
  }

  async #handleHttp(request, response) {
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, service: 'dsh-rp-bot', port: this.port });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/ca') {
      const caPem = this.tls?.caPem || '';
      response.writeHead(caPem ? 200 : 503, {
        'content-type': 'application/x-pem-file; charset=utf-8',
        'content-length': Buffer.byteLength(caPem),
        'cache-control': 'no-store',
      });
      response.end(caPem);
      return;
    }
    if (url.pathname.startsWith('/api/admin/')) {
      await this.handleAdmin(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/pairing') {
      if (!isLoopback(request)) {
        sendJson(response, 403, { ok: false, error: 'loopback only' });
        return;
      }
      const pairing = this.createPairing();
      sendJson(response, 200, { ok: true, pairing });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/devices/revoke') {
      if (!isLoopback(request)) {
        sendJson(response, 403, { ok: false, error: 'loopback only' });
        return;
      }
      const body = await readJson(request);
      const revoked = await this.revokeDevice(String(body.id || ''));
      sendJson(response, revoked ? 200 : 404, { ok: revoked, ...this.state() });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/pair') {
      const body = await readJson(request);
      const code = String(body.code || '');
      const verified = this.pairing.verify(code, clientIp(request));
      if (!verified.ok) {
        sendJson(response, 401, { ok: false, error: verified.reason });
        return;
      }
      const token = randomBytes(24).toString('hex');
      const device = {
        id: randomUUID(),
        name: String(body.deviceName || 'Android'),
        tokenHash: hashToken(token),
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      this.devices.value.devices = [...(this.devices.value.devices || []), device];
      await this.devices.save();
      sendJson(response, 200, {
        ok: true,
        token,
        device: { id: device.id, name: device.name },
        server: { name: 'RPLink', version: '0.0.1' },
      });
      return;
    }
    if (request.method === 'GET' && url.pathname.startsWith('/media/')) {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const id = url.pathname.slice('/media/'.length).replace(/\.png$/i, '');
      const path = this.images?.mediaPath(id);
      const data = path ? await readFile(path).catch(() => null) : null;
      if (!data) {
        sendJson(response, 404, { ok: false, error: 'media not found' });
        return;
      }
      response.writeHead(200, {
        'content-type': 'image/png',
        'content-length': data.length,
        'cache-control': 'private, max-age=86400',
      });
      response.end(data);
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      sendJson(response, 200, {
        ok: true,
        server: { name: 'RPLink', version: '0.0.1' },
        characters: this.state().characters,
        worldlines: this.state().worldlines,
        conversations: this.state().conversations,
      });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/settings') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      sendJson(response, 200, { ok: true, settings: this.settings.value });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/settings') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const settings = await this.updateSettings(await readJson(request));
      sendJson(response, 200, { ok: true, settings });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/worldlines') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const characterId = url.searchParams.get('characterId') || '';
      sendJson(response, 200, { ok: true, worldlines: await this._listWorldlines(characterId) });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/worldlines') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const body = await readJson(request);
      const characterId = String(body.characterId || '');
      try {
        if (body.action === 'create') {
          const line = await this._createWorldline(characterId, String(body.name || ''), String(body.premise || ''), body.premiseEnabled !== false);
          sendJson(response, 200, { ok: true, worldline: line, worldlines: await this._listWorldlines(characterId) });
          return;
        }
        if (body.action === 'update') {
          const line = await this._updateWorldline(characterId, String(body.id || ''), body);
          sendJson(response, 200, { ok: true, worldline: line, worldlines: await this._listWorldlines(characterId) });
          return;
        }
        if (body.action === 'archive') {
          const line = await this._archiveWorldline(characterId, String(body.id || ''));
          sendJson(response, 200, { ok: true, worldline: line, worldlines: await this._listWorldlines(characterId) });
          return;
        }
        sendJson(response, 400, { ok: false, error: 'unknown worldline action' });
      } catch (error) {
        sendJson(response, 400, { ok: false, error: String(error?.message || error) });
      }
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/conversations') {
      const device = await this.#authenticate(request);
      if (!device) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const body = await readJson(request);
      const conversation = await this.#createConversation(String(body.characterId || ''), '', String(body.worldlineId || ''));
      sendJson(response, 200, { ok: true, conversation });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/rp-bot/state') {
      sendJson(response, 200, { ok: true, ...this.state() });
      return;
    }
    sendJson(response, 404, { ok: false, error: 'not found' });
  }

  async #handleUpgrade(request, socket, head) {
    const url = new URL(request.url || '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const device = await this.#authenticate(request);
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.#handleSocket(ws, device);
    });
  }

  #handleSocket(ws, device) {
    this.clients.set(ws, device);
    ws.on('close', () => this.clients.delete(ws));
    const send = (payload) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(payload));
    };
    send({
      type: 'ready',
      server: { name: 'RPLink', version: '0.0.1' },
      characters: this.state().characters,
      worldlines: this.state().worldlines,
      conversations: this.state().conversations,
      commands: commandCatalog(this.effectTemplates?.value?.templates),
    });

    ws.on('message', (raw) => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        send({ type: 'error', error: 'bad json' });
        return;
      }
      this.#handleFrame(ws, device, frame, send).catch((error) => {
        send({ type: 'error', error: String(error?.message || error), conversationId: frame?.conversationId });
      });
    });
  }

  async #handleFrame(ws, device, frame, send) {
    if (frame.type === 'conversation.open') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      const line = this._worldline(conversation.worldlineId);
      const expectedMemoryUser = line?.memoryUser || memoryUserFor(conversation.characterId);
      if (conversation.memoryUser !== expectedMemoryUser) {
        const fresh = await this.#replaceConversation(conversation);
        send({ type: 'conversation.created', conversation: this.#view(fresh), time: conversationTime(fresh).text });
        return;
      }
      const requestedLimit = Number(frame.limit);
      const limit = Number.isFinite(requestedLimit) && requestedLimit >= 0
        ? Math.trunc(requestedLimit)
        : (conversation.status === 'archived' ? 0 : 40);
      let history = await this.bridge.history(conversation, limit).catch(() => []);
      const backed = await this.backup?.readHistory(conversation).catch(() => []) || [];
      if (backed.length > history.length) history = limit > 0 ? backed.slice(-limit) : backed;
      send({ type: 'conversation.opened', conversation: this.#view(conversation), history, time: conversationTime(conversation).text });
      return;
    }
    if (frame.type === 'conversation.create') {
      const conversation = await this.#createConversation(String(frame.characterId || ''), '', String(frame.worldlineId || ''));
      send({ type: 'conversation.created', conversation: this.#view(conversation), time: conversationTime(conversation).text });
      return;
    }
    if (frame.type === 'chapter.list') {
      const characterId = String(frame.characterId || '');
      const worldlineId = String(frame.worldlineId || this._defaultWorldline(characterId)?.id || '');
      const list = (this.conversations.value.conversations || [])
        .filter((entry) => entry.characterId === characterId && (!worldlineId || entry.worldlineId === worldlineId))
        .sort((left, right) => (Number(left.index) || 0) - (Number(right.index) || 0))
        .map((entry) => this.#view(entry));
      send({ type: 'chapter.list', characterId, worldlineId, conversations: list });
      return;
    }
    if (frame.type === 'chapter.new') {
      const conversation = await this.#createConversation(
        String(frame.characterId || ''),
        String(frame.summary || '').trim(),
        String(frame.worldlineId || ''),
      );
      send({ type: 'conversation.created', conversation: this.#view(conversation), time: conversationTime(conversation).text });
      return;
    }
    if (frame.type === 'time.set') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      if (conversation.status === 'archived') {
        send({ type: 'error', error: 'chapter archived', conversationId: conversation.id });
        return;
      }
      conversation.timeMode = frame.mode === 'world' ? 'world' : 'real';
      if (conversation.timeMode === 'world' && Number.isFinite(Number(frame.worldTimeMs))) {
        conversation.worldOffsetMs = Number(frame.worldTimeMs) - Date.now();
      } else {
        conversation.worldOffsetMs = 0;
      }
      await this.conversations.save();
      if (this.backup) await this.backup.sync(conversation).catch(() => {});
      send({
        type: 'time.updated',
        conversationId: conversation.id,
        mode: conversation.timeMode,
        time: conversationTime(conversation).text,
      });
      return;
    }
    if (frame.type === 'mode.set') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      if (conversation.status === 'archived') {
        send({ type: 'error', error: 'chapter archived', conversationId: conversation.id });
        return;
      }
      if (this.busy.has(conversation.id)) {
        send({ type: 'error', error: 'busy', conversationId: conversation.id });
        return;
      }
      conversation.mode = frame.mode === 'meeting' ? 'meeting' : 'chat';
      await this.bridge.reconfigure(conversation);
      await this.conversations.save();
      if (this.backup) await this.backup.sync(conversation).catch(() => {});
      send({ type: 'mode.updated', conversationId: conversation.id, mode: conversation.mode });
      return;
    }
    if (frame.type === 'effect.list') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      send({
        type: 'effect.updated',
        conversationId: conversation.id,
        effects: effectsForState(this.effectStates?.value, this._effectKey(conversation)),
      });
      return;
    }
    if (frame.type === 'effect.add') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      if (conversation.status === 'archived') {
        send({ type: 'error', error: 'chapter archived', conversationId: conversation.id });
        return;
      }
      const current = effectsForState(this.effectStates?.value, this._effectKey(conversation));
      if (current.length >= 10) {
        send({ type: 'error', error: 'too many effects', conversationId: conversation.id });
        return;
      }
      const result = applyAdHoc({ effects: current }, frame, 'manual');
      await this.#saveCharacterEffects(conversation, result.effects);
      if (this.backup) await this.backup.sync(conversation).catch(() => {});
      send({
        type: 'effect.updated',
        conversationId: conversation.id,
        effects: result.effects,
        applied: result.effect,
      });
      return;
    }
    if (frame.type === 'effect.remove') {
      const conversation = this.#conversation(String(frame.conversationId || ''));
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      const effects = effectsForState(this.effectStates?.value, this._effectKey(conversation))
        .filter((entry) => entry.id !== String(frame.effectId || ''));
      await this.#saveCharacterEffects(conversation, effects);
      if (this.backup) await this.backup.sync(conversation).catch(() => {});
      send({ type: 'effect.updated', conversationId: conversation.id, effects });
      return;
    }
    if (frame.type === 'turn.stop') {
      const conversation = this.#conversation(frame.conversationId);
      if (conversation) await this.bridge.stop(conversation);
      send({ type: 'turn.stopped', conversationId: frame.conversationId });
      return;
    }
    if (frame.type === 'message.send') {
      const conversation = this.#conversation(frame.conversationId);
      if (!conversation) {
        send({ type: 'error', error: 'conversation not found', conversationId: frame.conversationId });
        return;
      }
      if (conversation.status === 'archived') {
        send({ type: 'error', error: 'chapter archived', conversationId: conversation.id });
        return;
      }
      if (this.busy.has(conversation.id)) {
        send({ type: 'error', error: 'busy', conversationId: conversation.id });
        return;
      }
      const text = String(frame.text || '').trim();
      let inputImage = null;
      try {
        inputImage = normalizeInputImage(frame.image);
      } catch (error) {
        send({ type: 'error', error: String(error?.message || error), conversationId: conversation.id });
        return;
      }
      if (!text && !inputImage) {
        send({ type: 'error', error: 'empty message', conversationId: conversation.id });
        return;
      }

      if (!inputImage && /^\/draw(?:\s|$)/i.test(text)) {
        const drawRequest = text.replace(/^\/draw\s*/i, '').trim();
        await this.#handleDraw(conversation, drawRequest, send, frame);
        return;
      }

      const templates = this.effectTemplates?.value?.templates || [];
      const command = inputImage ? null : parseCommand(text, templates);
      if (command) {
        let notice;
        let effects = effectsForState(this.effectStates?.value, this._effectKey(conversation));
        if (command.unknown) {
          notice = '未知命令：' + command.command;
        } else {
          const template = command.durationTurns === command.template.durationTurns
            ? command.template
            : { ...command.template, durationTurns: command.durationTurns };
          const result = await this.#applyEffectTemplate(conversation, template, 'command');
          effects = result.effects;
          const turns = result.effect?.remainingTurns;
          const suffix = turns ? '（' + turns + ' 轮）' : '';
          if (result.status === 'blocked') {
            notice = (result.blocker?.label || '更高等级状态') + ' 已激活，' + command.template.name + ' 不生效';
          } else if (result.status === 'refreshed') {
            notice = '已刷新：' + command.template.name + suffix;
          } else {
            notice = '已施加：' + command.template.name + suffix;
          }
          if (command.invalidArg) notice += '（参数无效，使用默认时长）';
        }
        send({ type: 'message.accepted', conversationId: conversation.id, clientId: frame.clientId });
        send({ type: 'assistant.typing', conversationId: conversation.id, active: false });
        send({
          type: 'command.applied',
          conversationId: conversation.id,
          text: notice,
          effects,
        });
        if (this.backup) await this.backup.append(conversation, 'system', notice, { source: 'command' }).catch(() => {});
        send({ type: 'assistant.done', conversationId: conversation.id });
        return;
      }

      const trigger = inputImage ? null : matchTrigger(text, templates);
      if (trigger) {
        const result = await this.#applyEffectTemplate(conversation, trigger, 'trigger');
        if (result.status !== 'blocked') {
          send({
            type: 'effect.updated',
            conversationId: conversation.id,
            effects: result.effects,
            trigger: trigger.id,
          });
        }
      }

      this.busy.add(conversation.id);
      let userImageId = null;
      try {
        if (inputImage) {
          userImageId = randomUUID();
          await writeFile(join(this.dataDir, 'media', userImageId + '.png'), Buffer.from(inputImage.data, 'base64'));
        }
      } catch (error) {
        this.busy.delete(conversation.id);
        send({ type: 'error', error: 'image save failed', conversationId: conversation.id });
        return;
      }
      if (this.backup) {
        if (userImageId) {
          await this.backup.append(conversation, 'user', '', {
            image: userImageId,
            mode: conversation.mode || 'chat',
          }).catch(() => {});
        }
        if (text) {
          await this.backup.append(conversation, 'user', text, { mode: conversation.mode || 'chat' }).catch(() => {});
        }
      }
      send({ type: 'message.accepted', conversationId: conversation.id, clientId: frame.clientId });
      send({ type: 'assistant.typing', conversationId: conversation.id, active: true, label: '对方输入中…' });
      try {
        const reply = await this.bridge.send(conversation, text, () => {}, inputImage);
        const parsed = parsePhotoMarker(reply);
        const stickerParsed = parseStickerMarkers(parsed.text || reply);
        const displayText = stickerParsed.text;
        const stickerIds = await this.#prepareStickers(conversation, stickerParsed.tags);
        const bubbles = splitForMode(displayText, conversation.mode || 'chat');
        const character = (this.characters.value.characters || []).find((entry) => entry.id === conversation.characterId);
        const image = character?.image || {};
        const allowedCards = Array.isArray(image.cards) ? image.cards.filter(Boolean) : [];
        const imageLimit = Math.max(1, Number(image.maxPerChapter) || 3);
        let imageResult = null;
        let imageError = null;
        if (parsed.photo && image.enabled === true && allowedCards.length > 0
          && (Number(conversation.imageCount) || 0) < imageLimit) {
          const requestedCard = allowedCards.includes(parsed.photo.card) ? parsed.photo.card : allowedCards[0];
          const tags = (parsed.photo.tags || image.extraPrompt || '').slice(0, 800);
          send({ type: 'assistant.typing', conversationId: conversation.id, active: true, label: '图片加载中…' });
          try {
            // Generate before sending any text: if it succeeds, the image appears first.
            imageResult = await this.images.generate({
              character: requestedCard,
              prompt: tags,
              orientation: parsed.photo.orientation,
            });
            conversation.imageCount = (Number(conversation.imageCount) || 0) + 1;
            await this.conversations.save();
          } catch (error) {
            imageError = error;
            this.logger?.warn?.('[rp-bot] image generation failed: ' + String(error?.message || error));
            await appendFile(
              join(this.dataDir, 'image-errors.log'),
              new Date().toISOString() + ' ' + String(error?.stack || error) + '\n',
              'utf8',
            ).catch(() => {});
          }
        }
        await sleep(this._replyDelayMs());
        if (imageResult) {
          send({
            type: 'assistant.image',
            conversationId: conversation.id,
            mediaId: imageResult.id,
            caption: '',
          });
        }
        if (imageError) {
          send({ type: 'assistant.typing', conversationId: conversation.id, active: false });
        }
        for (let index = 0; index < bubbles.length; index += 1) {
          await sleep(bubbleDelay(bubbles[index]));
          send({ type: 'assistant.bubble', conversationId: conversation.id, text: bubbles[index] });
          if (index < bubbles.length - 1) {
            send({ type: 'assistant.typing', conversationId: conversation.id, active: true, label: '对方输入中…' });
          }
        }
        for (const mediaId of stickerIds) {
          await sleep(180);
          send({ type: 'assistant.sticker', conversationId: conversation.id, mediaId });
        }
        send({ type: 'assistant.typing', conversationId: conversation.id, active: false });
        if (imageError) {
          send({
            type: 'assistant.image.failed',
            conversationId: conversation.id,
            text: '图片未成功生成。',
          });
        }
        const activeEffects = effectsForState(this.effectStates?.value, this._effectKey(conversation));
        conversation.tokens = (Number(conversation.tokens) || 0)
          + estimateTokens(text)
          + estimateTokens(displayText);
        const decremented = decrementEffectState({ effects: activeEffects });
        if (decremented.changed) {
          await this.#saveCharacterEffects(conversation, decremented.effects);
        }
        await this.conversations.save();
        const battery = batteryFor(conversation.tokens);
        if (this.backup) {
          if (imageResult) {
            await this.backup.append(conversation, 'assistant', '', {
              image: imageResult.id,
              mode: conversation.mode || 'chat',
            }).catch(() => {});
          }
          await this.backup.append(conversation, 'assistant', displayText, {
            mode: conversation.mode || 'chat',
            bubbles,
            tokens: conversation.tokens,
            battery,
          }).catch(() => {});
          for (const mediaId of stickerIds) {
            await this.backup.append(conversation, 'assistant', '', {
              image: mediaId,
              sticker: true,
              mode: conversation.mode || 'chat',
            }).catch(() => {});
          }
          if (imageError) {
            await this.backup.append(conversation, 'system', '图片未成功生成。', {
              source: 'image',
            }).catch(() => {});
          }
        }
        send({
          type: 'battery.updated',
          conversationId: conversation.id,
          tokens: conversation.tokens,
          battery,
        });
        if (activeEffects.length > 0) {
          send({
            type: 'effect.updated',
            conversationId: conversation.id,
            effects: decremented.effects,
          });
        }
        send({ type: 'assistant.done', conversationId: conversation.id });
      } catch (error) {
        send({ type: 'assistant.typing', conversationId: conversation.id, active: false });
        throw error;
      } finally {
        this.busy.delete(conversation.id);
      }
      return;
    }
    send({ type: 'error', error: 'unknown frame type: ' + String(frame.type) });
  }

  async #authenticate(request) {
    const url = new URL(request.url || '/', 'http://localhost');
    const header = request.headers['x-rp-token'];
    const token = typeof header === 'string' && header ? header : (url.searchParams.get('token') || '');
    if (!token) return null;
    const hash = hashToken(token);
    const device = (this.devices.value.devices || []).find((entry) => entry.tokenHash === hash);
    if (!device) return null;
    device.lastSeenAt = new Date().toISOString();
    this.devices.save().catch(() => {});
    return device;
  }

  async _listWorldlines(characterId) {
    return this._worldlinesFor(characterId).map((line) => {
      const chapters = (this.conversations.value.conversations || [])
        .filter((entry) => entry.worldlineId === line.id)
        .sort((left, right) => (Number(left.index) || 0) - (Number(right.index) || 0));
      const active = chapters.find((entry) => entry.status === 'active') || chapters[chapters.length - 1] || null;
      return {
        ...line,
        chapterCount: chapters.length,
        activeChapterId: active?.id || null,
        activeChapterIndex: active?.index || null,
      };
    });
  }

  async _createWorldline(characterId, name, premise, premiseEnabled) {
    const character = (this.characters.value.characters || []).find((entry) => entry.id === characterId);
    if (!character) throw new Error('character not found');
    const now = new Date().toISOString();
    const id = 'w-' + randomUUID();
    const line = normalizeWorldline({
      id,
      characterId,
      name: name || '新的世界线',
      premise: premise || '',
      premiseEnabled: premiseEnabled !== false,
      memoryUser: worldlineMemoryUser(characterId, id),
      isDefault: false,
      createdAt: now,
      archived: false,
    }, characterId);
    this.worldlines.value.worldlines = [...(this.worldlines.value.worldlines || []), line];
    await this.worldlines.save();
    await this.#createConversation(characterId, '', id);
    return line;
  }

  async _updateWorldline(characterId, id, patch) {
    const line = this._worldline(id);
    if (!line || line.characterId !== characterId) throw new Error('worldline not found');
    const clean = (text) => String(text || '').replace(/\uFFFD/g, '').trim();
    if (typeof patch.name === 'string') line.name = clean(patch.name).slice(0, 40) || line.name;
    if (typeof patch.premise === 'string') line.premise = clean(patch.premise).slice(0, 4000);
    if (typeof patch.premiseEnabled === 'boolean') line.premiseEnabled = patch.premiseEnabled;
    await this.worldlines.save();
    return line;
  }

  async _archiveWorldline(characterId, id) {
    const line = this._worldline(id);
    if (!line || line.characterId !== characterId) throw new Error('worldline not found');
    if (line.isDefault) throw new Error('cannot archive the default worldline');
    line.archived = true;
    await this.worldlines.save();
    return line;
  }

  async #createConversation(characterId, summary = '', worldlineId = '') {
    const character = (this.characters.value.characters || []).find((entry) => entry.id === characterId)
      || (this.characters.value.characters || [])[0];
    if (!character) throw new Error('no character configured');
    const worldline = this._worldline(String(worldlineId || '')) || this._defaultWorldline(character.id);
    if (!worldline) throw new Error('no worldline configured');
    const list = this.conversations.value.conversations || [];
    const sameWorldline = list.filter((entry) => entry.worldlineId === worldline.id || (!entry.worldlineId && entry.characterId === character.id));
    const previous = sameWorldline.filter((entry) => entry.status !== 'archived').pop()
      || sameWorldline[sameWorldline.length - 1];
    const now = new Date().toISOString();
    const archived = [];
    for (const entry of sameWorldline) {
      if (entry.status === 'archived') continue;
      entry.status = 'archived';
      entry.worldlineId = worldline.id;
      entry.archivedAt = now;
      entry.endedRealTime = now;
      entry.endedWorldTime = conversationTime(entry).date.toISOString();
      archived.push(entry);
    }
    const index = sameWorldline.reduce((max, entry) => Math.max(max, Number(entry.index) || 0), 0) + 1;
    const conversation = {
      id: 'c-' + randomUUID(),
      characterId: character.id,
      worldlineId: worldline.id,
      sessionId: 'rp-' + randomUUID(),
      memoryUser: worldline.memoryUser || memoryUserFor(character.id),
      timeMode: previous?.timeMode === 'world' ? 'world' : 'real',
      worldOffsetMs: Number(previous?.worldOffsetMs) || 0,
      mode: 'chat',
      status: 'active',
      index,
      tokens: 0,
      imageCount: 0,
      effects: [],
      summary: String(summary || '').slice(0, 4000),
      title: character.name + ' · 第' + index + '章',
      createdAt: now,
      startedRealTime: now,
    };
    conversation.startedWorldTime = conversationTime(conversation).date.toISOString();
    this.conversations.value.conversations = [...list, conversation];
    await this.conversations.save();
    for (const entry of archived) {
      if (this.backup) await this.backup.markArchived(entry).catch(() => {});
    }
    if (this.backup) {
      await this.backup.ensure(conversation, []).catch(() => {});
      if (archived.length) this.backup.snapshot('chapter-archive').catch(() => {});
    }
    return conversation;
  }

  async #replaceConversation(old) {
    const fresh = await this.#createConversation(old.characterId, '', old.worldlineId);
    this.conversations.value.conversations = (this.conversations.value.conversations || [])
      .filter((entry) => entry.id !== old.id);
    await this.conversations.save();
    return fresh;
  }

  #conversation(id) {
    return (this.conversations.value.conversations || []).find((entry) => entry.id === id);
  }

  _effectKey(conversation) {
    return conversation?.worldlineId || conversation?.characterId || 'default';
  }

  _replyDelayMs() {
    const settings = this.settings?.value || {};
    const min = Math.max(0, Math.min(120000, Math.trunc(Number(settings.replyDelayMinMs) || 0)));
    const max = Math.max(min, Math.min(120000, Math.trunc(Number(settings.replyDelayMaxMs) || 0)));
    if (max <= 0) return 0;
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _worldline(id) {
    return (this.worldlines?.value?.worldlines || []).find((entry) => entry.id === id);
  }

  _worldlinesFor(characterId) {
    return (this.worldlines?.value?.worldlines || [])
      .filter((entry) => entry.characterId === characterId && !entry.archived)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  }

  _defaultWorldline(characterId) {
    const list = this._worldlinesFor(characterId);
    return list.find((entry) => entry.isDefault) || list[0] || null;
  }
}

function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function normalizeInputImage(value) {
  if (!value || typeof value !== 'object') return null;
  const data = String(value.data || '').replace(/\s+/g, '');
  if (!data) return null;
  if (data.length > 6 * 1024 * 1024) throw new Error('image too large');
  const buffer = Buffer.from(data, 'base64');
  if (buffer.length === 0 || buffer.toString('base64') !== data) throw new Error('invalid image base64');
  const mediaType = String(value.mediaType || 'image/jpeg').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mediaType)) {
    throw new Error('unsupported image type');
  }
  return { data, mediaType, name: String(value.name || 'photo').slice(0, 80) };
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  });
  response.end(text);
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
