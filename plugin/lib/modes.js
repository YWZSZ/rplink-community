import { splitReply } from './reply.js';

export const DEFAULT_CHAT_RULES = [
  '[聊天模式]',
  '- 你们在通过聊天软件交流，此刻不在一起。',
  '- 像真人发微信：一次发 1–3 条短消息，每条单独一行。',
  '- 每条 1 句，通常不超过 30 字；可以更短。',
  '- 只发文字和表情，不写动作、神态、旁白。',
  '- 不总结上文、不复述用户的话、不每轮都提问。',
  '- 不替用户行动、感受或说话。',
].join('\n');

export const DEFAULT_MEETING_RULES = [
  '[见面模式]',
  '- 你们此刻在同一个场景里，面对面相处；上面的时间就是当前场景时间。',
  '- 可以写动作、神态、环境、对话，用自然叙述推进场景。',
  '- 每次 3–6 段，每段 1–3 句；不要写成一整块。',
  '- 不要替用户决定行动、感受或台词；给用户留出反应空间。',
  '- 不要每轮都提问，也不要把场景写成总结报告。',
  '- 角色可以有自己的情绪和保留，不必事事配合用户。',
  '- 以下模式规则优先于角色卡中的输出格式限制。',
].join('\n');

export function modeRules(mode, overrides = {}) {
  if (mode === 'meeting') {
    const value = String(overrides?.meeting || '').trim();
    return value || DEFAULT_MEETING_RULES;
  }
  const value = String(overrides?.chat || '').trim();
  return value || DEFAULT_CHAT_RULES;
}

export function splitForMode(text, mode) {
  if (mode === 'meeting') {
    const value = String(text || '').trim();
    return value ? [value] : [];
  }
  return splitReply(text);
}
