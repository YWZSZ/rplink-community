function text(value) {
  return String(value || '').trim();
}

function stickerPack(value) {
  const raw = text(value);
  if (!raw) return '';
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  let base = parts[parts.length - 1] || normalized;
  // 兼容旧面板粘贴完整路径时留下的拼接值。
  if (!normalized.includes('/') && /^[A-Za-z]Users/i.test(normalized)) {
    const marker = normalized.toLowerCase().lastIndexOf('stickers');
    if (marker >= 0 && marker + 8 < normalized.length) {
      base = normalized.slice(marker + 8).replace(/^[^A-Za-z0-9_-]+/, '');
    }
  }
  return base.replace(/[^a-zA-Z0-9_-]/g, '');
}

function extractAddressing(source) {
  const value = text(source);
  if (!value) return '';
  const patterns = [
    /称呼(?:用户|你|对方)?为[“"「『]([^”"」』\n]{1,20})[”"」』]/,
    /称呼(?:用户|你)[：:]\s*([^\n，。；]{1,20})/,
    /(?:叫|称)(?:用户|你)[：:]\s*([^\n，。；]{1,20})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match && text(match[1])) return text(match[1]);
  }
  return '';
}

export function defaultCharacter() {
  return {
    id: 'demo',
    name: '未命名角色',
    tagline: '',
    core: {
      identity: '',
      personality: '',
      values: '',
      speechStyle: '',
      boundaries: '不替用户决定行动、感受或台词；不无条件服从；可以拒绝、沉默或保留。',
      addressing: '',
    },
    appearance: {
      summary: '',
      tags: '',
    },
    relationship: {
      initial: '',
    },
    image: {
      enabled: false,
      cards: [],
      maxPerChapter: 3,
      extraPrompt: '',
    },
    stickers: {
      enabled: false,
      pack: '',
      maxPerReply: 3,
    },
    legacyCard: '',
    card: '',
  };
}

export function normalizeCharacter(input = {}) {
  const value = input && typeof input === 'object' ? input : {};
  const card = text(value.card);
  const core = value.core && typeof value.core === 'object' ? value.core : {};
  const appearance = value.appearance && typeof value.appearance === 'object' ? value.appearance : {};
  const relationship = value.relationship && typeof value.relationship === 'object' ? value.relationship : {};
  const image = value.image && typeof value.image === 'object' ? value.image : {};
  const stickers = value.stickers && typeof value.stickers === 'object' ? value.stickers : {};
  const hasCore = Object.values(core).some((item) => text(item));
  const legacy = text(value.legacyCard) || card;
  const addressing = text(core.addressing)
    || extractAddressing([legacy, core.speechStyle, core.identity].filter(Boolean).join('\n'));
  return {
    id: text(value.id),
    name: text(value.name) || '角色',
    tagline: text(value.tagline),
    core: {
      identity: text(core.identity) || (!hasCore ? card : ''),
      personality: text(core.personality),
      values: text(core.values),
      speechStyle: text(core.speechStyle),
      boundaries: text(core.boundaries),
      addressing,
    },
    appearance: {
      summary: text(appearance.summary),
      tags: text(appearance.tags),
    },
    relationship: {
      initial: text(relationship.initial),
    },
    image: {
      enabled: image.enabled === true,
      cards: Array.isArray(image.cards)
        ? image.cards.map((item) => text(item).replace(/\.json$/i, '')).filter(Boolean)
        : [],
      maxPerChapter: Math.max(1, Math.min(20, Math.trunc(Number(image.maxPerChapter) || 3))),
      extraPrompt: text(image.extraPrompt),
    },
    stickers: {
      enabled: stickers.enabled === true,
      pack: stickerPack(stickers.pack),
      maxPerReply: Math.max(1, Math.min(3, Math.trunc(Number(stickers.maxPerReply) || 3))),
    },
    legacyCard: text(value.legacyCard) || card,
    card,
  };
}

export function characterPrompt(character) {
  const value = normalizeCharacter(character);
  const core = value.core;
  const blocks = [];
  if (core.identity) blocks.push('身份：' + core.identity);
  if (core.personality) blocks.push('人格：' + core.personality);
  if (core.values) blocks.push('价值观：' + core.values);
  if (core.speechStyle) blocks.push('说话风格：' + core.speechStyle);
  if (core.addressing) blocks.push('对用户的称呼：' + core.addressing);
  if (core.boundaries) blocks.push('底线：' + core.boundaries);
  if (blocks.length === 0 && value.card) {
    return '[角色卡]\n' + value.card;
  }
  if (value.appearance.summary || value.appearance.tags) {
    blocks.push('[外貌]\n' + [value.appearance.summary, value.appearance.tags ? '标签：' + value.appearance.tags : ''].filter(Boolean).join('\n'));
  }
  if (value.relationship.initial) {
    blocks.push('[与用户的关系]\n' + value.relationship.initial);
  }
  return blocks.length ? '[角色核心]\n' + blocks.join('\n') : '';
}
