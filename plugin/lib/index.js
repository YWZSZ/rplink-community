import { copyFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { BotBridge } from './bridge.js';
import { MemoryClient } from './memory.js';
import { ChatBackup } from './chat-backup.js';
import { normalizeCharacter } from './characters.js';
import { defaultTemplates } from './effect-templates.js';
import { effectsForState, normalizeEffectState, setEffectsForState } from './effect-state.js';
import { ImageService } from './images.js';
import { StickerService } from './stickers.js';
import { defaultPrompts } from './prompts.js';
import { emptyWorldlines, ensureWorldlines, normalizeWorldline } from './worldlines.js';
import { JsonStore, defaultCharacter } from './store.js';
import { RpServer } from './server.js';

export const name = 'dsh-rp-bot';
export const inject = ['agents', 'sessions', 'webServer', 'attachments'];

export async function apply(ctx, rawConfig = {}) {
  const config = {
    port: 3450,
    bindAddress: '0.0.0.0',
    pairCode: '000000',
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'off',
    maxTokens: 800,
    replyTimeoutMs: 120000,
    autoStart: true,
    ...rawConfig,
  };
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh');
  const dataDir = config.dataDir || join(dshHome, 'rp-bot');
  await mkdir(dataDir, { recursive: true });

  const characters = new JsonStore(join(dataDir, 'characters.json'), {
    version: 1,
    characters: [defaultCharacter()],
  });
  const conversations = new JsonStore(join(dataDir, 'conversations.json'), {
    version: 1,
    conversations: [],
  });
  const worldlines = new JsonStore(join(dataDir, 'worldlines.json'), emptyWorldlines());
  const devices = new JsonStore(join(dataDir, 'devices.json'), {
    version: 1,
    devices: [],
  });
  const settings = new JsonStore(join(dataDir, 'settings.json'), {
    version: 1,
    provider: config.provider,
    model: config.model,
    reasoningEffort: config.reasoningEffort,
    maxTokens: config.maxTokens,
    chatMaxTokens: 600,
    meetingMaxTokens: 3000,
    replyDelayMinMs: 0,
    replyDelayMaxMs: 0,
    replyTimeoutMs: config.replyTimeoutMs,
    memoryEndpoint: config.memoryEndpoint || '',
  });
  const prompts = new JsonStore(join(dataDir, 'prompts.json'), defaultPrompts());
  const effectTemplates = new JsonStore(join(dataDir, 'effect-templates.json'), {
    version: 1,
    templates: defaultTemplates(),
  });
  const effectStates = new JsonStore(join(dataDir, 'effect-states.json'), {
    version: 1,
    characters: {},
  });
  await Promise.all([
    characters.ready,
    conversations.ready,
    worldlines.ready,
    devices.ready,
    settings.ready,
    prompts.ready,
    effectTemplates.ready,
    effectStates.ready,
  ]);
  if (!Number(settings.value.chatMaxTokens)) settings.value.chatMaxTokens = 600;
  if (!Number(settings.value.meetingMaxTokens)) settings.value.meetingMaxTokens = 3000;
  if (!Number.isFinite(Number(settings.value.replyDelayMinMs))) settings.value.replyDelayMinMs = 0;
  if (!Number.isFinite(Number(settings.value.replyDelayMaxMs))) settings.value.replyDelayMaxMs = 0;
  await settings.save();
  characters.value.characters = (characters.value.characters || []).map(normalizeCharacter);
  if (!characters.value.characters.length) {
    characters.value.characters = [defaultCharacter()];
  }
  await characters.save();
  effectStates.value = normalizeEffectState(effectStates.value);
  worldlines.value.worldlines = (worldlines.value.worldlines || []).map((entry) => normalizeWorldline(entry));
  const migrated = ensureWorldlines({
    characters: characters.value,
    conversations: conversations.value,
    worldlines: worldlines.value,
    effectStates: effectStates.value,
  });
  if (migrated.changed) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = join(dataDir, 'backups', 'worldlines-' + stamp);
    await mkdir(backupDir, { recursive: true }).catch(() => {});
    for (const name of ['characters.json', 'conversations.json', 'effect-states.json', 'worldlines.json']) {
      await copyFile(join(dataDir, name), join(backupDir, name)).catch(() => {});
    }
  }
  worldlines.value = migrated.worldlines;
  conversations.value = migrated.conversations;
  effectStates.value = migrated.effectStates;
  if (migrateConversationEffects(conversations.value.conversations || [], effectStates.value)) {
    await conversations.save();
  }
  await Promise.all([worldlines.save(), conversations.save(), effectStates.save()]);

  const chatBackup = new ChatBackup({ dataDir, characters, logger: ctx.logger });
  const imageService = new ImageService({ dataDir, config, logger: ctx.logger });
  const stickerService = new StickerService({ dataDir, logger: ctx.logger });
  await imageService.init();
  await stickerService.init();
  await chatBackup.init();
  const memoryEndpoint = String(settings.value.memoryEndpoint || config.memoryEndpoint || '').trim();
  const memory = memoryEndpoint
    ? new MemoryClient({
      endpoint: memoryEndpoint,
      logger: ctx.logger,
      commitEvery: config.memoryCommitEvery || 4,
    })
    : null;

  const bridge = new BotBridge({
    ctx,
    dataDir,
    config,
    characters,
    settings,
    prompts,
    effectStates,
    worldlines,
    stickers: stickerService,
    memory,
    logger: ctx.logger,
  });
  const server = new RpServer({
    ctx,
    config,
    dataDir,
    characters,
    conversations,
    devices,
    settings,
    prompts,
    effectTemplates,
    effectStates,
    worldlines,
    backup: chatBackup,
    images: imageService,
    stickers: stickerService,
    bridge,
    logger: ctx.logger,
  });

  await server.normalizeChapters();
  await chatBackup.backfill(conversations.value.conversations || [], bridge);
  await chatBackup.snapshot('startup');
  const backupTimer = setInterval(() => {
    chatBackup.snapshot('daily').catch(() => {});
  }, 24 * 60 * 60 * 1000);
  backupTimer.unref?.();

  if (config.autoStart !== false) {
    try {
      await server.start();
    } catch (error) {
      ctx.logger?.error?.('[rp-bot] failed to start: ' + String(error?.message || error));
    }
  }

  const stateHandler = (request, response) => {
    server.handleAdmin(request, response).catch((error) => {
      sendJson(response, 500, { ok: false, error: String(error?.message || error) });
    });
  };

  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/rp-bot',
      handler: stateHandler,
    }),
    'rp-bot: settings admin',
  );

  ctx.effect(() => () => server.close(), 'rp-bot: server lifecycle');
  ctx.effect(() => () => clearInterval(backupTimer), 'rp-bot: chat backup timer');
  ctx.logger?.info?.(`[rp-bot] loaded; data=${dataDir}; port=${config.port}`);
}

function migrateConversationEffects(conversations, states) {
  let changed = false;
  for (const conversation of conversations) {
    if (!Array.isArray(conversation.effects) || conversation.effects.length === 0) continue;
    const characterId = conversation.characterId;
    const stateKey = conversation.worldlineId || characterId;
    if (!characterId) continue;
    const existing = effectsForState(states, stateKey);
    for (const effect of conversation.effects) {
      if (!effect || !effect.label || !effect.prompt) continue;
      if (existing.some((entry) => entry.id && effect.id && entry.id === effect.id)) continue;
      existing.push(effect);
    }
    setEffectsForState(states, stateKey, existing);
    conversation.effects = [];
    changed = true;
  }
  return changed;
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

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
