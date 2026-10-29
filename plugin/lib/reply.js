/** Split one model reply into 1-3 chat bubbles. */
export function splitReply(text, max = 3) {
  const value = String(text || '').trim();
  if (!value) return [];
  let parts = value
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    parts = value
      .split(/(?<=[。！？!?…])\s*/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  if (parts.length <= 1) return [value];
  if (parts.length > max) {
    const head = parts.slice(0, max - 1);
    const tail = parts.slice(max - 1).join(' ');
    return [...head, tail];
  }
  return parts;
}

/** Delay before showing one bubble, roughly proportional to its length. */
export function bubbleDelay(text) {
  const length = String(text || '').length;
  return Math.min(1100, 380 + length * 22);
}
