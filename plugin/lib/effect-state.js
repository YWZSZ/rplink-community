import { randomUUID } from 'node:crypto';
import { normalizeEffects } from './effects.js';

export function emptyEffectState() {
  return { version: 2, characters: {}, worldlines: {} };
}

export function effectsForState(state, key) {
  const worldlines = state?.worldlines && typeof state.worldlines === 'object' ? state.worldlines : {};
  const characters = state?.characters && typeof state.characters === 'object' ? state.characters : {};
  return normalizeEffects(worldlines[key] ?? characters[key]);
}

export function setEffectsForState(state, key, effects) {
  if (!state.worldlines || typeof state.worldlines !== 'object') state.worldlines = {};
  state.worldlines[key] = normalizeEffects(effects);
  return state;
}

export function normalizeEffectState(input) {
  if (!input || typeof input !== 'object') return emptyEffectState();
  const characters = {};
  const worldlines = {};
  for (const [key, value] of Object.entries(input.characters || {})) {
    characters[key] = normalizeEffects(value);
  }
  for (const [key, value] of Object.entries(input.worldlines || {})) {
    worldlines[key] = normalizeEffects(value);
  }
  return { version: 2, characters, worldlines };
}

/**
 * Apply a template to one character's active effects.
 * Returns { status: 'applied'|'refreshed'|'blocked', effects, effect?, blocker? }.
 */
export function applyTemplate(state, template, source = 'trigger') {
  const current = normalizeEffects(state.effects);
  const same = current.find((effect) => effect.templateId === template.id);
  if (same) {
    const refreshed = {
      ...same,
      label: template.name,
      prompt: template.prompt,
      intensity: template.intensity,
      remainingTurns: template.durationTurns,
      source,
      appliedAt: new Date().toISOString(),
    };
    const effects = current.map((effect) => (effect.id === same.id ? refreshed : effect));
    return { status: 'refreshed', effects, effect: refreshed };
  }

  if (template.group) {
    const groupEffects = current.filter((effect) => effect.group === template.group);
    const highest = groupEffects.reduce((max, effect) => Math.max(max, Number(effect.level) || 0), -1);
    if (highest > template.level) {
      const blocker = groupEffects.find((effect) => effect.level === highest);
      return { status: 'blocked', effects: current, blocker };
    }
  }

  const blockers = current.filter((effect) => Array.isArray(effect.overrides) && effect.overrides.includes(template.id));
  if (blockers.length) {
    return { status: 'blocked', effects: current, blocker: blockers[0] };
  }

  let next = current;
  if (template.group) {
    next = next.filter((effect) => effect.group !== template.group || effect.level > template.level);
  }
  if (template.overrides.length) {
    next = next.filter((effect) => !template.overrides.includes(effect.templateId));
  }

  const effect = {
    id: 'eff-' + randomUUID(),
    templateId: template.id,
    label: template.name,
    group: template.group,
    level: template.level,
    prompt: template.prompt,
    intensity: template.intensity,
    remainingTurns: template.durationTurns,
    overrides: [...template.overrides],
    source,
    appliedAt: new Date().toISOString(),
  };
  return { status: 'applied', effects: [...next, effect], effect };
}

export function applyAdHoc(state, input, source = 'manual') {
  const current = normalizeEffects(state.effects);
  const effect = {
    id: 'eff-' + randomUUID(),
    templateId: '',
    label: String(input.label || '').trim().slice(0, 80),
    group: '',
    level: 0,
    prompt: String(input.prompt || '').trim().slice(0, 2000),
    intensity: Math.max(0, Math.min(1, Number(input.intensity) || 0.5)),
    remainingTurns: Number.isFinite(Number(input.remainingTurns)) && Number(input.remainingTurns) > 0
      ? Math.min(100, Math.trunc(Number(input.remainingTurns)))
      : null,
    overrides: [],
    source,
    appliedAt: new Date().toISOString(),
  };
  return { status: 'applied', effects: [...current, effect], effect };
}

export function decrementEffectState(state) {
  const before = normalizeEffects(state.effects);
  const after = [];
  for (const effect of before) {
    if (effect.remainingTurns === null) {
      after.push(effect);
    } else if (effect.remainingTurns > 1) {
      after.push({ ...effect, remainingTurns: effect.remainingTurns - 1 });
    }
  }
  return { effects: after, changed: JSON.stringify(before) !== JSON.stringify(after) };
}
