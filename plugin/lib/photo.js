const PHOTO_RE = /\[\[PHOTO:\s*([^\]]+?)\s*\]\]/i;
const PHOTO_RE_G = /\[\[PHOTO:\s*[^\]]+?\]\]/gi;

export function photoPrompt(character, conversation) {
  const image = character?.image || {};
  const cards = Array.isArray(image.cards) ? image.cards.filter(Boolean) : [];
  if (image.enabled !== true || cards.length === 0) return '';
  const lines = [
    '[发图能力]',
    '你可以在自然的时候给用户看照片、自拍或现场照。',
    '需要发图时，在回复最后单独一行输出隐藏标记：',
    '[[PHOTO: 角色卡名 | 画幅 | 英文画面标签]]',
    '角色卡名必须是：' + cards.join(', ') + '。',
    '画幅只能是 portrait（竖版）、landscape（横版）或 square（方形）。',
    '先根据当前对话自己决定：自拍/半身/全身、地点、时间与天气、动作、表情、服装状态、镜头和光线。',
    '单人自拍、站姿、半身像优先 portrait；双人、房间、街景、桌面、横向构图优先 landscape；头像或物件可用 square。',
    '把这些决定写成 6–12 个英文 Danbooru tag，要具体，并与当前场景一致；不要每次都重复同一套。',
    '如果用户要求看某个东西或某个动作，要包含进去；不要凭空换地点或换衣服。',
    '聊天模式更像随手自拍；见面模式可以更像现场照片。',
    '画面标签只能用英文，不要写中文。',
    '正文不要提“生成图片”“模型”“AI”“图片文件”，用“给你看我的照片”“你看这个”这类自然说法。',
    '示例：[[PHOTO: chigusa_aine | portrait | upper body, sitting by window, evening light, looking at viewer, soft smile, casual clothes]]',
    '本轮最多 1 张。',
  ];
  if (image.extraPrompt) lines.push('额外画面要求：' + image.extraPrompt);
  return lines.join('\n');
}

export function parsePhotoMarker(text) {
  const value = String(text || '');
  const match = value.match(PHOTO_RE);
  if (!match) return { text: value.trim(), photo: null };
  const raw = match[1];
  const parts = raw.split('|');
  const card = (parts.length > 1 ? parts.shift() : '').trim();
  let orientation = 'portrait';
  if (parts.length > 0 && /^(portrait|landscape|square)$/i.test(parts[0].trim())) {
    orientation = parts.shift().trim().toLowerCase();
  }
  const tags = parts.join('|').trim();
  const cleaned = value.replace(PHOTO_RE_G, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleaned, photo: { card, orientation, tags } };
}
