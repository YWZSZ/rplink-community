/** Approximate token count for newly written chapter text. */
export function estimateTokens(text) {
  const value = String(text || '');
  let cjk = 0;
  let latin = 0;
  let digits = 0;
  for (const char of value) {
    const code = char.codePointAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3040 && code <= 0x30ff)) cjk += 1;
    else if (/[0-9]/.test(char)) digits += 1;
    else if (/[A-Za-z]/.test(char)) latin += 1;
  }
  return Math.max(1, Math.ceil(cjk + latin / 4 + digits / 3));
}

/** Battery percentage from chapter-new tokens. */
export function batteryFor(tokens) {
  const used = Math.max(0, Number(tokens) || 0);
  const u = used / 100000;
  const value = 1 + 99 / (1 + Math.pow(2 * u, 2));
  return Math.max(1, Math.min(100, Math.round(value)));
}
