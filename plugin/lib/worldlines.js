import { randomUUID } from 'node:crypto';

export function emptyWorldlines() {
  return { version: 1, worldlines: [] };
}

export function defaultMainline(characterId, now = new Date().toISOString()) {
  return {
    id: 'w-' + randomUUID(),
    characterId,
    name: '主线',
    premise: '',
    premiseEnabled: true,
    memoryUser: memoryUserFor(characterId),
    isDefault: true,
    createdAt: now,
    archived: false,
  };
}

export function normalizeWorldline(input, characterId = '') {
  const value = input && typeof input === 'object' ? input : {};
  const id = String(value.id || 'w-' + randomUUID());
  const clean = (text) => String(text || '').replace(/\uFFFD/g, '').trim();
  return {
    id,
    characterId: String(value.characterId || characterId),
    name: clean(value.name).slice(0, 40) || '世界线',
    premise: clean(value.premise).slice(0, 4000),
    premiseEnabled: value.premiseEnabled !== false,
    memoryUser: String(value.memoryUser || worldlineMemoryUser(characterId || value.characterId, id)),
    isDefault: value.isDefault === true,
    createdAt: value.createdAt || new Date().toISOString(),
    archived: value.archived === true,
  };
}

export function worldlineMemoryUser(characterId, worldlineId) {
  const base = memoryUserFor(characterId);
  const clean = String(worldlineId || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  return clean ? base + '--' + clean : base;
}

export function memoryUserFor(characterId) {
  const raw = String(characterId || 'default').toLowerCase();
  const clean = raw.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return 'char-' + (clean || 'default');
}

export function worldlineBlock(worldlines, conversation) {
  const id = conversation?.worldlineId;
  if (!id) return '';
  const line = (worldlines?.worldlines || []).find((entry) => entry.id === id);
  if (!line || line.premiseEnabled === false || !line.premise.trim()) return '';
  return [
    '[世界线前提]',
    line.name + '：' + line.premise.trim(),
  ].join('\n');
}

export function ensureWorldlines({ characters, conversations, worldlines, effectStates }) {
  const list = Array.isArray(worldlines?.worldlines) ? worldlines.worldlines : [];
  const conversationsList = Array.isArray(conversations?.conversations) ? conversations.conversations : [];
  const charactersList = Array.isArray(characters?.characters) ? characters.characters : [];
  let changed = false;

  const defaults = new Map();
  for (const character of charactersList) {
    let line = list.find((entry) => entry.characterId === character.id && entry.isDefault && !entry.archived);
    if (!line) {
      line = defaultMainline(character.id);
      list.push(line);
      changed = true;
    }
    defaults.set(character.id, line);
  }

  for (const conversation of conversationsList) {
    if (!conversation.worldlineId) {
      const line = defaults.get(conversation.characterId);
      if (!line) continue;
      conversation.worldlineId = line.id;
      if (!conversation.memoryUser) conversation.memoryUser = line.memoryUser;
      changed = true;
    }
    const line = list.find((entry) => entry.id === conversation.worldlineId);
    if (line && conversation.memoryUser !== line.memoryUser) {
      conversation.memoryUser = line.memoryUser;
      changed = true;
    }
  }

  const state = effectStates || {};
  if (!state.worldlines || typeof state.worldlines !== 'object') state.worldlines = {};
  const chars = state.characters || {};
  for (const character of charactersList) {
    const line = defaults.get(character.id);
    if (!line) continue;
    if (!state.worldlines[line.id] && Array.isArray(chars[character.id])) {
      state.worldlines[line.id] = chars[character.id];
      changed = true;
    }
  }

  return {
    changed,
    worldlines: { version: 1, worldlines: list },
    conversations: { ...(conversations || {}), conversations: conversationsList },
    effectStates: { ...state, version: 1 },
  };
}
