const FORMATTER = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Hong_Kong',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Current story/real time for one conversation. */
export function conversationTime(conversation) {
  const mode = conversation?.timeMode === 'world' ? 'world' : 'real';
  const offset = Number(conversation?.worldOffsetMs) || 0;
  const date = new Date(Date.now() + (mode === 'world' ? offset : 0));
  const text = FORMATTER.format(date);
  return { mode, date, text, label: mode === 'world' ? '故事世界时间' : '真实时间' };
}

export function timeBlock(conversation) {
  const current = conversationTime(conversation);
  return '[当前时间]\n' + current.text + '（' + current.label + '）';
}
