import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { splitForMode, modeRules } from './modes.js';
import { characterPrompt } from './characters.js';
import { effectBlock } from './effects.js';
import { effectsForState } from './effect-state.js';
import { photoPrompt, parsePhotoMarker } from './photo.js';
import { stickerPrompt } from './stickers.js';
import { parseStickerMarkers } from './stickers.js';
import { worldlineBlock } from './worldlines.js';
import { frameworkText, modeOverrides } from './prompts.js';
import { timeBlock } from './time.js';

export class BotBridge {
  constructor({ ctx, dataDir, config, characters, settings, prompts, effectStates, memory, stickers, worldlines, logger }) {
    this.ctx = ctx;
    this.dataDir = dataDir;
    this.config = config;
    this.characters = characters;
    this.settings = settings;
    this.prompts = prompts;
    this.effectStates = effectStates;
    this.memory = memory;
    this.stickers = stickers;
    this.worldlines = worldlines;
    this.logger = logger;
    this.handles = new Map();
  }

  character(characterId) {
    const list = this.characters.value.characters || [];
    return list.find((character) => character.id === characterId) || list[0];
  }

  async ensureAgent(conversation) {
    const existing = this.handles.get(conversation.sessionId);
    const mode = conversation.mode === 'meeting' ? 'meeting' : 'chat';
    if (existing) {
      if (existing.rpMode === mode) return existing;
      this.handles.delete(conversation.sessionId);
      await existing.dispose().catch(() => {});
    }

    const character = this.character(conversation.characterId);
    if (!character) throw new Error('no character configured');

    const cwd = join(this.dataDir, 'characters', character.id, 'workspace');
    await mkdir(cwd, { recursive: true });

    const cardText = () => characterPrompt(this.character(conversation.characterId));
    const modelSettings = this.settings?.value || {};
    const chatMax = Number(modelSettings.chatMaxTokens) || Number(modelSettings.maxTokens) || 600;
    const meetingMax = Number(modelSettings.meetingMaxTokens) || Number(modelSettings.maxTokens) || 3000;
    const agentOptions = {
      provider: modelSettings.provider || this.config.provider || 'deepseek-official',
      model: modelSettings.model || this.config.model || 'deepseek-v4-flash',
      reasoningEffort: modelSettings.reasoningEffort || this.config.reasoningEffort || 'off',
      maxTokens: mode === 'meeting' ? meetingMax : chatMax,
    };
    const setup = async (agentCtx) => {
      agentCtx.systemPrompt.suppressRuntimeContext();
      let mounted = false;
      if (this.config.usePreset === true) {
        try {
          const presets = this.ctx.get?.('agentPresets');
          if (presets && typeof presets.mount === 'function') {
            await presets.mount(agentCtx, 'rp');
            mounted = true;
          }
        } catch (error) {
          this.logger?.warn?.('[rp-bot] preset rp unavailable, using complete section: ' + String(error?.message || error));
        }
      }
      if (mounted) {
        agentCtx.systemPrompt.variable('rp_character', cardText);
      } else {
        agentCtx.systemPrompt.variable('rp_framework', () => frameworkText(this.prompts));
        agentCtx.systemPrompt.variable('rp_character', cardText);
        agentCtx.systemPrompt.variable('rp_previous', () => previousBlock(conversation));
        agentCtx.systemPrompt.variable('rp_worldline', () => worldlineBlock(this.worldlines?.value, conversation));
        agentCtx.systemPrompt.variable('rp_photo', () => photoPrompt(this.character(conversation.characterId), conversation));
        agentCtx.systemPrompt.variable('rp_sticker', () => {
          const character = this.character(conversation.characterId);
          const pack = character?.stickers?.pack;
          return stickerPrompt(character, this.stickers?.tagListSync(pack) || []);
        });
        agentCtx.systemPrompt.variable('rp_mode', () => modeRules(conversation.mode || 'chat', modeOverrides(this.prompts)));
        agentCtx.systemPrompt.section({
          name: 'rp:complete',
          order: 0,
          complete: true,
          interpolate: true,
          text: ['{{rp_framework}}', '', '{{rp_previous}}', '', '{{rp_worldline}}', '', '{{rp_character}}', '', '{{rp_photo}}', '', '{{rp_sticker}}', '', '{{rp_mode}}'].join('\n'),
        });
      }
    };

    let handle;
    try {
      handle = await this.ctx.agents.resume({
        resumeSessionId: conversation.sessionId,
        agentOptions,
        setup,
      });
      this.logger?.info?.('[rp-bot] resumed session ' + conversation.sessionId);
    } catch (error) {
      try {
        await appendFile(join(this.dataDir, 'resume-error.log'), String(error?.stack || error) + '\n');
      } catch { /* ignore debug log failure */ }
      this.logger?.info?.('[rp-bot] resume failed, creating session: ' + String(error?.message || error));
      handle = await this.ctx.agents.create({
        sessionId: conversation.sessionId,
        meta: { cwd },
        agentOptions,
        setup,
      });
    }

    this.handles.set(conversation.sessionId, handle);
    handle.rpMode = mode;
    return handle;
  }

  async reconfigure(conversation) {
    const handle = this.handles.get(conversation.sessionId);
    if (!handle) return false;
    this.handles.delete(conversation.sessionId);
    await handle.dispose().catch(() => {});
    return true;
  }

  async reconfigureAll() {
    for (const [sessionId, handle] of this.handles.entries()) {
      this.handles.delete(sessionId);
      await handle.dispose().catch(() => {});
    }
  }

  async history(conversation, limit = 0) {
    const handle = await this.ensureAgent(conversation);
    const session = resolveSession(handle, this.ctx, conversation.sessionId);
    if (!session) return [];
    const result = [];
    for (const message of session.deriveMessages()) {
      if (message?.role !== 'user' && message?.role !== 'assistant') continue;
      const source = message.source || message.metadata?.source || {};
      if (message.role === 'user' && source?.kind && source.kind !== 'user' && source.kind !== 'client') {
        continue;
      }
      const text = (message.content || [])
        .filter((part) => part?.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .replace(/\[\[RP-TURN-CONTEXT\]\][\s\S]*?\[\[\/RP-TURN-CONTEXT\]\]/g, '')
        .trim();
      if (!text
        || text.startsWith('<openviking-context')
        || text.startsWith('<memory ')
        || text.startsWith('Relevant memory from OpenViking.')
        || text.startsWith('Current runtime context.')
        || text.startsWith('Current runtime context:')
        || text.startsWith('Time sampled while preparing turn')) continue;
      if (message.role === 'assistant') {
        const cleaned = parseStickerMarkers(parsePhotoMarker(text).text || text).text;
        for (const bubble of splitForMode(cleaned, conversation.mode || 'chat')) result.push({ role: 'assistant', text: bubble });
      } else {
        result.push({ role: 'user', text });
      }
    }
    return limit > 0 ? result.slice(-limit) : result;
  }

  async send(conversation, text, onDelta, image = null) {
    const handle = await this.ensureAgent(conversation);
    const session = resolveSession(handle, this.ctx, conversation.sessionId);
    if (!session) throw new Error('session not available');
    const before = countAssistantMessages(session.deriveMessages());
    const character = this.character(conversation.characterId);

    conversation.memoryBlock = '';
    if (text) {
      try {
        conversation.memoryBlock = await this.memory?.recall(text, character, conversation.memoryUser) || '';
      } catch (error) {
        this.logger?.warn?.('[rp-bot] memory recall failed: ' + String(error?.message || error));
      }
    }

    const turn = turnContext(
      conversation,
      character,
      effectsForState(this.effectStates?.value, conversation.worldlineId || conversation.characterId),
    );
    let content;
    if (image) {
      if (!this.ctx.attachments?.admitPromptContent) throw new Error('attachments API unavailable');
      const parts = [{ type: 'text', text: turn }];
      parts.push({
        type: 'image',
        data: image.data,
        mediaType: image.mediaType,
        name: image.name,
      });
      if (text) parts.push({ type: 'text', text });
      content = await this.ctx.attachments.admitPromptContent(parts);
    } else {
      content = [{ type: 'text', text: turn + (text ? '\n\n' + text : '') }];
    }

    await handle.agent.followup({
      id: 'msg-' + randomUUID(),
      role: 'user',
      content,
      source: { kind: 'user' },
    });

    let sent = '';
    let idle = false;
    handle.agent.whenIdle().then(() => {
      idle = true;
    }).catch(() => {
      idle = true;
    });

    const deadline = Date.now() + Number(this.settings?.value?.replyTimeoutMs || this.config.replyTimeoutMs || 120000);
    while (Date.now() < deadline) {
      await delay(150);
      const messages = session.deriveMessages();
      const assistantMessages = messages.filter((message) => message?.role === 'assistant');
      const full = assistantMessages.length > before
        ? assistantText(assistantMessages[assistantMessages.length - 1])
        : '';
      if (full && full.length > sent.length) {
        onDelta(full.slice(sent.length));
        sent = full;
      }
      if (idle && assistantMessages.length > before) break;
    }

    if (!sent) throw new Error('no reply from agent before timeout');
    if (text) {
      const cleanReply = parseStickerMarkers(parsePhotoMarker(sent).text || sent).text;
      this.memory?.record(conversation, text, cleanReply || sent).catch((error) => {
        this.logger?.warn?.('[rp-bot] memory record failed: ' + String(error?.message || error));
      });
    }
    return sent;
  }

  async drawPrompt(conversation, request) {
    const character = this.character(conversation.characterId);
    if (!character) throw new Error('no character configured');
    const cards = Array.isArray(character.image?.cards) ? character.image.cards.filter(Boolean) : [];
    if (!cards.length) throw new Error('no image models configured');
    const recent = await this.history(conversation, 12).catch(() => []);
    const context = recent.map((message) => (message.role === 'user' ? '用户：' : '角色：') + message.text).join('\n');
    const cwd = join(this.dataDir, 'characters', character.id, 'workspace');
    await mkdir(cwd, { recursive: true });
    const instruction = [
      '[绘图提示词助手]',
      '你不参与角色扮演，只把用户的绘图请求和最近对话转换成生图参数。',
      '角色卡：',
      characterPrompt(character),
      '允许的生图模型：' + cards.join(', '),
      '最近对话：',
      context || '（无）',
      '用户绘图请求：' + request,
      '同时根据画面选择画幅：单人自拍/半身/站姿用 portrait；双人、房间、街景、桌面、横向构图用 landscape；头像/物件可用 square。',
      '只输出一行 JSON，不要解释、不要 markdown：',
      '{"card":"允许的模型名","orientation":"portrait|landscape|square","tags":"6-12 个英文 Danbooru 标签，包含人物动作、表情、服装、场景、镜头；要结合上下文"}',
    ].join('\n');
    const sessionId = 'rp-draw-' + randomUUID();
    const options = this.settings?.value || {};
    const handle = await this.ctx.agents.create({
      sessionId,
      meta: { cwd },
      agentOptions: {
        provider: options.provider || this.config.provider || 'deepseek-official',
        model: options.model || this.config.model || 'deepseek-v4-flash',
        reasoningEffort: 'off',
        maxTokens: 500,
      },
      setup: (agentCtx) => {
        agentCtx.systemPrompt.suppressRuntimeContext();
        agentCtx.systemPrompt.section({
          name: 'draw:complete',
          order: 0,
          complete: true,
          text: instruction,
        });
      },
    });
    try {
      await handle.agent.followup({
        id: 'msg-' + randomUUID(),
        role: 'user',
        content: [{ type: 'text', text: '请根据以上信息生成绘图参数。' }],
        source: { kind: 'user' },
      });
      const session = resolveSession(handle, this.ctx, sessionId);
      let idle = false;
      handle.agent.whenIdle().then(() => { idle = true; }).catch(() => { idle = true; });
      const deadline = Date.now() + 45000;
      let text = '';
      while (Date.now() < deadline) {
        await delay(150);
        if (!session) continue;
        const assistant = session.deriveMessages().filter((message) => message?.role === 'assistant');
        text = assistantText(assistant[assistant.length - 1]) || text;
        if (idle && text) break;
      }
      if (!text) throw new Error('draw prompt model timeout');
      let card = cards[0];
      let orientation = 'portrait';
      let tags = '';
      const json = text.match(/\{[\s\S]*\}/);
      if (json) {
        const parsed = JSON.parse(json[0]);
        if (cards.includes(parsed.card)) card = parsed.card;
        if (['portrait', 'landscape', 'square'].includes(String(parsed.orientation || '').toLowerCase())) {
          orientation = String(parsed.orientation).toLowerCase();
        }
        tags = String(parsed.tags || '').trim();
      } else {
        const line = text.split('\n').map((item) => item.trim()).find(Boolean) || '';
        const parts = line.split('|');
        if (cards.includes(parts[0])) card = parts[0];
        tags = (parts.length > 1 ? parts.slice(1).join('|') : line).trim();
      }
      if (!tags) throw new Error('draw prompt has no tags');
      return { card, orientation, tags: tags.slice(0, 800) };
    } finally {
      await handle.dispose().catch(() => {});
    }
  }

  async stop(conversation) {
    const handle = this.handles.get(conversation.sessionId);
    if (!handle) return false;
    await handle.agent.cancel({ kind: 'user' });
    return true;
  }

  async close() {
    for (const handle of this.handles.values()) {
      await handle.dispose().catch(() => {});
    }
    this.handles.clear();
  }
}

function countAssistantMessages(messages) {
  return messages.filter((message) => message?.role === 'assistant').length;
}

function memoryBlock(conversation) {
  const block = String(conversation?.memoryBlock || '').trim();
  return block ? '[相关记忆]\n' + block : '';
}

function turnContext(conversation, character, activeEffects = []) {
  const lines = ['[[RP-TURN-CONTEXT]]', '以下为当前轮状态，覆盖之前轮次中的旧状态。'];
  const time = timeBlock(conversation);
  if (time) lines.push(time);
  const effects = effectBlock(activeEffects);
  if (effects) lines.push(effects);
  const memory = memoryBlock(conversation);
  if (memory) lines.push(memory);
  const image = character?.image || {};
  const cards = Array.isArray(image.cards) ? image.cards.filter(Boolean) : [];
  if (image.enabled === true && cards.length > 0) {
    const max = Math.max(1, Number(image.maxPerChapter) || 3);
    const used = Number(conversation?.imageCount) || 0;
    const remaining = Math.max(0, max - used);
    lines.push('本轮可发图：' + remaining + ' 张' + (remaining <= 0 ? '（不要输出 [[PHOTO...]]）' : ''));
  } else {
    lines.push('本轮不可发图。');
  }
  lines.push('[[/RP-TURN-CONTEXT]]');
  return lines.join('\n');
}

function previousBlock(conversation) {
  const summary = String(conversation?.summary || '').trim();
  return summary ? '[前情]\n' + summary : '';
}

function assistantText(message) {
  return (message?.content || [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

function resolveSession(handle, ctx, sessionId) {
  const candidate = handle?.agent?.session;
  if (candidate && typeof candidate.deriveMessages === 'function') return candidate;
  return ctx.sessions.get(sessionId);
}

function lastAssistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const text = (message.content || [])
      .filter((part) => part?.type === 'text')
      .map((part) => part.text)
      .join('\n');
    if (text) return text;
  }
  return '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
