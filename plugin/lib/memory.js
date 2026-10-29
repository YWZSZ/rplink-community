/**
 * OpenViking memory client for the roleplay bot.
 *
 * Each character is its own OpenViking user (`char-<id>`), so entities,
 * profile, events and preferences never leak across characters.
 */
export class MemoryClient {
  constructor({ endpoint, logger, commitEvery = 4 }) {
    this.endpoint = String(endpoint || 'http://127.0.0.1:1933').replace(/\/+$/, '');
    this.logger = logger;
    this.commitEvery = Math.max(1, Number(commitEvery) || 4);
    this.counts = new Map();
    this.sessions = new Set();
  }

  async recall(query, character = '', memoryUser = '') {
    const text = String(query || '').trim();
    if (!text) return '';
    const name = typeof character === 'string' ? character : String(character?.name || '');
    const user = memoryUser || userFor(character);
    const payload = {
      query: name ? name + ' ' + text : text,
      mode: 'list',
      target_uri: 'viking://user/' + user,
      limit: 5,
      read_content: true,
    };
    const result = await this.#post('/api/v1/search/search', payload, 9000, user);
    return formatMemories(result?.result?.memories || [], user);
  }

  async record(conversation, userText, assistantText) {
    const sessionId = sessionFor(conversation);
    const user = conversation.memoryUser || userFor(conversation.characterId);
    await this.#ensureSession(sessionId, user);
    const messages = [];
    if (userText) {
      messages.push({ role: 'user', content: userText, peer_id: 'owner' });
    }
    if (assistantText) {
      messages.push({ role: 'assistant', content: assistantText, peer_id: peerFor(conversation) });
    }
    if (messages.length === 0) return;
    await this.#post('/api/v1/sessions/' + encodeURIComponent(sessionId) + '/messages/batch', { messages }, 8000, user);
    const count = (this.counts.get(conversation.id) || 0) + 1;
    this.counts.set(conversation.id, count);
    if (count >= this.commitEvery) {
      this.counts.set(conversation.id, 0);
      this.#post('/api/v1/sessions/' + encodeURIComponent(sessionId) + '/commit', { keep_recent_count: 0 }, 8000, user)
        .then((result) => {
          const task = result?.result?.task_id;
          if (task) this.logger?.info?.('[rp-bot] memory commit queued ' + task + ' for ' + conversation.id);
        })
        .catch((error) => {
          this.logger?.warn?.('[rp-bot] memory commit failed: ' + String(error?.message || error));
        });
    }
  }

  async #ensureSession(sessionId, user) {
    const key = user + ':' + sessionId;
    if (this.sessions.has(key)) return;
    try {
      await this.#post('/api/v1/sessions', { session_id: sessionId }, 6000, user);
    } catch {
      // Already exists or auto-created by the first message.
    }
    this.sessions.add(key);
  }

  async #post(path, body, timeoutMs, user) {
    const headers = { 'content-type': 'application/json' };
    if (user) headers['X-OpenViking-User'] = user;
    const response = await fetch(this.endpoint + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('memory HTTP ' + response.status);
    }
    if (!response.ok || payload?.status === 'error') {
      const message = payload?.error?.message || payload?.error || ('HTTP ' + response.status);
      throw new Error(String(message));
    }
    return payload;
  }
}

function sessionFor(conversation) {
  return 'rpbot-' + String(conversation.id || conversation.sessionId || 'unknown');
}

function peerFor(conversation) {
  const user = conversation.memoryUser || userFor(conversation.characterId);
  return user.replace(/^char-/, '');
}

function userFor(value) {
  const raw = typeof value === 'string' ? value : String(value?.id || 'default');
  const clean = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return 'char-' + (clean || 'default');
}

function formatMemories(memories, user) {
  const prefix = 'viking://user/' + user + '/';
  const parts = [];
  for (const memory of memories) {
    const uri = String(memory?.uri || '');
    if (!uri || !uri.startsWith(prefix) || uri.endsWith('.overview.md')) continue;
    const typeTag = (memory.tags || []).find((tag) => String(tag).startsWith('memory_type='));
    const type = typeTag ? String(typeTag).slice('memory_type='.length) : typeFromUri(uri);
    const content = String(memory.content || memory.abstract || '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
    if (!content) continue;
    parts.push(`<memory uri="${uri}" type="${type}" score="${Number(memory.score || 0).toFixed(2)}">\n${content}\n</memory>`);
  }
  return parts.join('\n').slice(0, 6000);
}

function typeFromUri(uri) {
  const match = uri.match(/\/memories\/([^/]+)\//);
  return match ? match[1] : 'memory';
}
