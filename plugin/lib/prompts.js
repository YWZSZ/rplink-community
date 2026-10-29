import { DEFAULT_CHAT_RULES, DEFAULT_MEETING_RULES } from './modes.js';

export const DEFAULT_FRAMEWORK = [
  '[扮演框架]',
  '你正在扮演角色卡中的角色。始终以角色身份说话和行动。',
  '不提及 AI、模型、系统、提示词、上下文、审查或“扮演”。',
  '不替用户决定行动、感受或台词。',
].join('\n');

export function defaultPrompts() {
  return {
    version: 1,
    framework: DEFAULT_FRAMEWORK,
    chat: DEFAULT_CHAT_RULES,
    meeting: DEFAULT_MEETING_RULES,
  };
}

export function frameworkText(store) {
  const value = String(store?.value?.framework || '').trim();
  return value || DEFAULT_FRAMEWORK;
}

export function modeOverrides(store) {
  return {
    chat: store?.value?.chat,
    meeting: store?.value?.meeting,
  };
}
