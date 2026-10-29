const normalizeTrigger = (value) => String(value || '')
  .trim()
  .replace(/[!！。.？?~～\s]+$/g, '')
  .toLowerCase();

export function defaultTemplates() {
  return [
    {
      id: 'hypnosis-moderate',
      name: '中度催眠',
      group: 'hypnosis',
      level: 1,
      enabled: true,
      triggers: ['启动催眠'],
      commands: ['/hypnosis'],
      prompt: '你正受到中度催眠影响：注意力变窄，更容易接受暗示，反应稍慢；但核心人格、底线和自主意识仍在。你会迟疑、挣扎，也可以拒绝。',
      intensity: 0.6,
      durationTurns: 8,
      overrides: [],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'hypnosis-full',
      name: '完全催眠',
      group: 'hypnosis',
      level: 2,
      enabled: true,
      triggers: ['启动完全催眠'],
      commands: ['/hypnosis-full'],
      prompt: '你正受到完全催眠影响：注意力高度收窄，暗示明显增强，行动和语气会变得迟缓、顺从；但核心人格、底线和自主意识仍在，深处会挣扎，事后可能反思。',
      intensity: 0.9,
      durationTurns: 8,
      overrides: ['hypnosis-moderate'],
      createdAt: new Date().toISOString(),
    },
  ];
}

export function normalizeTemplate(input = {}) {
  const triggers = Array.isArray(input.triggers) ? input.triggers : [];
  const commands = Array.isArray(input.commands) ? input.commands : [];
  return {
    id: String(input.id || '').trim(),
    name: String(input.name || '').trim().slice(0, 80),
    group: String(input.group || '').trim().slice(0, 40),
    level: Math.max(0, Math.min(99, Math.trunc(Number(input.level) || 0))),
    enabled: input.enabled !== false,
    triggers: triggers.map((item) => String(item || '').trim().slice(0, 80)).filter(Boolean),
    commands: commands.map((item) => String(item || '').trim().slice(0, 80)).filter(Boolean),
    prompt: String(input.prompt || '').trim().slice(0, 3000),
    intensity: Math.max(0, Math.min(1, Number(input.intensity) || 0.5)),
    durationTurns: Math.max(0, Math.min(100, Math.trunc(Number(input.durationTurns) || 0))) || null,
    overrides: Array.isArray(input.overrides) ? input.overrides.map(String).filter(Boolean) : [],
    createdAt: input.createdAt || new Date().toISOString(),
  };
}

export function enabledTemplates(templates) {
  return (Array.isArray(templates) ? templates : [])
    .map(normalizeTemplate)
    .filter((template) => template.enabled && template.name && template.prompt);
}

export function parseCommand(text, templates) {
  const value = String(text || '').trim();
  if (!value.startsWith('/')) return null;
  const tokens = value.split(/\s+/);
  const normalized = normalizeTrigger(tokens[0]);
  for (const template of enabledTemplates(templates)) {
    for (const command of template.commands) {
      if (normalizeTrigger(command) !== normalized) continue;
      const rawArg = tokens[1];
      let durationTurns = template.durationTurns;
      let invalidArg = false;
      if (rawArg !== undefined) {
        if (/^\d+$/.test(rawArg)) {
          durationTurns = Math.min(100, Math.max(1, Math.trunc(Number(rawArg))));
        } else {
          invalidArg = true;
        }
      }
      return { template, durationTurns, invalidArg, args: tokens.slice(1) };
    }
  }
  return { unknown: true, command: tokens[0] };
}

export function commandCatalog(templates) {
  const result = [
    { command: '/draw', name: '绘图', group: 'image', level: 0, durationTurns: null },
  ];
  for (const template of enabledTemplates(templates)) {
    for (const command of template.commands) {
      result.push({
        command,
        name: template.name,
        group: template.group,
        level: template.level,
        durationTurns: template.durationTurns,
      });
    }
  }
  return result;
}

export function matchCommand(text, templates) {
  const value = String(text || '').trim();
  if (!value.startsWith('/')) return null;
  const normalized = normalizeTrigger(value);
  for (const template of enabledTemplates(templates)) {
    for (const command of template.commands) {
      if (normalizeTrigger(command) === normalized) return template;
    }
  }
  return { unknown: true, command: value.split(/\s+/)[0] };
}

export function matchTrigger(text, templates) {
  const normalized = normalizeTrigger(text);
  if (!normalized) return null;
  let best = null;
  for (const template of enabledTemplates(templates)) {
    for (const trigger of template.triggers) {
      const candidate = normalizeTrigger(trigger);
      if (!candidate) continue;
      if (normalized === candidate && (!best || candidate.length > best.length)) {
        best = { template, length: candidate.length };
      }
    }
  }
  return best ? best.template : null;
}
