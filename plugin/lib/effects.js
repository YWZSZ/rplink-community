export function normalizeEffects(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id || ''),
      templateId: String(entry.templateId || ''),
      label: String(entry.label || '').trim().slice(0, 80),
      group: String(entry.group || '').trim().slice(0, 40),
      level: Math.max(0, Math.min(99, Math.trunc(Number(entry.level) || 0))),
      prompt: String(entry.prompt || '').trim().slice(0, 3000),
      intensity: Math.max(0, Math.min(1, Number(entry.intensity) || 0.5)),
      remainingTurns: Number.isFinite(Number(entry.remainingTurns)) ? Math.max(0, Math.trunc(Number(entry.remainingTurns))) : null,
      overrides: Array.isArray(entry.overrides) ? entry.overrides.map(String).filter(Boolean) : [],
      source: String(entry.source || '').slice(0, 80),
      appliedAt: entry.appliedAt || entry.createdAt || new Date().toISOString(),
    }))
    .filter((entry) => entry.label && entry.prompt);
}

export function effectBlock(input) {
  const effects = Array.isArray(input) ? normalizeEffects(input) : normalizeEffects(input?.effects);
  if (!effects.length) return '';
  const lines = ['[当前状态]'];
  for (const effect of effects) {
    const meta = [];
    if (effect.intensity > 0) meta.push('强度 ' + effect.intensity);
    if (effect.remainingTurns !== null) meta.push('剩余 ' + effect.remainingTurns + ' 轮');
    lines.push('- ' + effect.label + (meta.length ? '（' + meta.join('，') + '）' : '') + '：' + effect.prompt);
  }
  return lines.join('\n');
}

export function decrementEffects(conversation) {
  const before = normalizeEffects(conversation.effects);
  const after = [];
  for (const effect of before) {
    if (effect.remainingTurns === null) {
      after.push(effect);
    } else if (effect.remainingTurns > 1) {
      after.push({ ...effect, remainingTurns: effect.remainingTurns - 1 });
    }
  }
  conversation.effects = after;
  return after.length !== before.length;
}
