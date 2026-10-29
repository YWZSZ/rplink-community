window.__ModuleLoader__.load({
  id: 'dsh-rp-bot',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require('react');
    var h = React.createElement;

    var STYLE_ID = 'dsh-rp-bot-style';

    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return;
      var style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
.dsh-rp-card{border:1px solid var(--dsw-alias-border-secondary,rgba(120,140,170,.28));border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:14px;background:var(--dsw-alias-bg-layer-1,#111827);color:var(--dsw-alias-label-primary,#eef2f8);max-width:860px}
.dsh-rp-title{font-size:15px;font-weight:600;margin:0}
.dsh-rp-sub{font-size:12px;color:var(--dsw-alias-label-secondary,#9aa8bd);line-height:1.6}
.dsh-rp-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dsh-rp-section{border-top:1px solid var(--dsw-alias-border-secondary,rgba(120,140,170,.2));padding-top:12px;display:flex;flex-direction:column;gap:10px}
.dsh-rp-section-title{font-size:13px;font-weight:600;margin:0}
.dsh-rp-pill{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1b2436);color:var(--dsw-alias-label-secondary,#9aa8bd);border:1px solid var(--dsw-alias-border-secondary,rgba(120,140,170,.25))}
.dsh-rp-pill[data-online='true']{color:var(--dsw-alias-state-success-primary,#57d68a);border-color:rgba(87,214,138,.35)}
.dsh-rp-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:18px;letter-spacing:2px}
.dsh-rp-list{display:flex;flex-direction:column;gap:6px}
.dsh-rp-item{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:7px 10px;border:1px solid var(--dsw-alias-border-secondary,rgba(120,140,170,.2));border-radius:8px;background:var(--dsw-alias-bg-layer-2,#151d2c);font-size:13px}
.dsh-rp-item[data-selected='true']{border-color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-rp-btn{appearance:none;border:1px solid rgba(120,140,170,.35) !important;background:#1b2436 !important;color:#eef2f8 !important;border-radius:8px;padding:6px 11px;font:inherit;font-size:12px;cursor:pointer;line-height:1.2}
.dsh-rp-btn-primary{background:#4d6bfe !important;border-color:#4d6bfe !important;color:#ffffff !important}
.dsh-rp-btn-danger{background:#1b2436 !important;color:#ff7b8a !important;border-color:rgba(255,123,138,.35) !important}
.dsh-rp-btn:disabled{opacity:.45;cursor:not-allowed}
.dsh-rp-input,.dsh-rp-textarea{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#151d2c);border:1px solid var(--dsw-alias-border-secondary,rgba(120,140,170,.25));border-radius:8px;color:var(--dsw-alias-label-primary,#eef2f8);padding:7px 9px;font:inherit;font-size:13px}
.dsh-rp-textarea{min-height:180px;resize:vertical;line-height:1.5}
.dsh-rp-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary,#9aa8bd)}
.dsh-rp-error{font-size:12px;color:var(--dsw-alias-state-error-primary,#ff7b8a);white-space:pre-wrap}
`;
      document.head.appendChild(style);
    }

    async function request(path, options) {
      var response = await fetch(path, {
        method: options?.method || 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: options?.body === undefined ? {} : { 'content-type': 'application/json' },
        body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      });
      var payload = await response.json().catch(function () { return { ok: false, error: 'HTTP ' + response.status }; });
      if (!response.ok || payload.ok === false) throw new Error(payload.error || 'HTTP ' + response.status);
      return payload;
    }

    function Panel() {
      var [state, setState] = React.useState(null);
      var [characters, setCharacters] = React.useState([]);
      var [settings, setSettings] = React.useState(null);
      var [prompts, setPrompts] = React.useState(null);
      var [templates, setTemplates] = React.useState([]);
      var [templateDraft, setTemplateDraft] = React.useState(null);
      var [view, setView] = React.useState('main');
      var [memory, setMemory] = React.useState(null);
      var [draft, setDraft] = React.useState(null);
      var [error, setError] = React.useState('');
      var [busy, setBusy] = React.useState('');

      async function refreshAll() {
        try {
          var next = await request('/api/rp-bot/state');
          var chars = await request('/api/rp-bot/characters');
          var config = await request('/api/rp-bot/settings');
          var promptData = await request('/api/rp-bot/prompts');
          var templateData = await request('/api/rp-bot/effect-templates');
          var mem = await request('/api/rp-bot/memory');
          setState(next);
          setCharacters(chars.characters || []);
          setSettings(config.settings || null);
          setPrompts(promptData.prompts || null);
          setTemplates(templateData.templates || []);
          setMemory(mem.memory || null);
          setDraft(function (current) {
            if (current !== null) return current;
            return (chars.characters || [])[0] || null;
          });
          setError('');
        } catch (err) {
          setError(String(err?.message || err));
        }
      }

      React.useEffect(function () {
        installStyles();
        refreshAll();
        var timer = setInterval(function () {
          request('/api/rp-bot/state').then(setState).catch(function () {});
        }, 5000);
        return function () { clearInterval(timer); };
      }, []);

      async function run(id, action) {
        setBusy(id);
        setError('');
        try { await action(); }
        catch (err) { setError(String(err?.message || err)); }
        finally { setBusy(''); }
      }

      function newCode() {
        run('pairing', async function () {
          var next = await request('/api/rp-bot/pairing', { method: 'POST', body: {} });
          setState(function (current) { return { ...(current || {}), pairing: next.pairing }; });
        });
      }

      function revoke(device) {
        if (!window.confirm('移除「' + (device.name || 'Android') + '」后，这台设备会立即失去访问权限。')) return;
        run(device.id, async function () {
          await request('/api/rp-bot/devices/revoke', { method: 'POST', body: { id: device.id } });
          await refreshAll();
        });
      }

      function saveCharacter() {
        if (!draft) return;
        run('character', async function () {
          var next = await request('/api/rp-bot/characters', { method: 'POST', body: draft });
          setCharacters(next.characters || []);
          setDraft(next.character || null);
        });
      }

      function deleteCharacter() {
        if (!draft || !draft.id) return;
        if (!window.confirm('删除角色「' + (draft.name || '') + '」？')) return;
        run('character', async function () {
          await request('/api/rp-bot/characters/delete', { method: 'POST', body: { id: draft.id } });
          setDraft(null);
          await refreshAll();
        });
      }

      function saveSettings() {
        if (!settings) return;
        run('settings', async function () {
          var next = await request('/api/rp-bot/settings', { method: 'POST', body: settings });
          setSettings(next.settings || null);
        });
      }

      function savePrompts() {
        if (!prompts) return;
        run('prompts', async function () {
          var next = await request('/api/rp-bot/prompts', { method: 'POST', body: prompts });
          setPrompts(next.prompts || null);
        });
      }

      function splitLines(value) {
        return String(value || '').split(/\n+/).map(function (item) { return item.trim(); }).filter(Boolean);
      }

      function splitIds(value) {
        return String(value || '').split(/[,\s]+/).map(function (item) { return item.trim(); }).filter(Boolean);
      }

      function editTemplate(template) {
        setTemplateDraft({
          ...template,
          enabled: template.enabled !== false,
          triggersText: (template.triggers || []).join('\n'),
          commandsText: (template.commands || []).join('\n'),
          overridesText: (template.overrides || []).join(', '),
        });
      }

      function newTemplate() {
        setTemplateDraft({
          id: '', name: '', group: '', level: 1, enabled: true,
          triggersText: '', commandsText: '', overridesText: '',
          prompt: '', intensity: 0.6, durationTurns: 8,
        });
      }

      function saveTemplate() {
        if (!templateDraft) return;
        run('template', async function () {
          var body = {
            id: templateDraft.id,
            name: templateDraft.name,
            group: templateDraft.group,
            level: Number(templateDraft.level) || 0,
            enabled: templateDraft.enabled !== false,
            triggers: splitLines(templateDraft.triggersText),
            commands: splitLines(templateDraft.commandsText),
            overrides: splitIds(templateDraft.overridesText),
            prompt: templateDraft.prompt,
            intensity: Number(templateDraft.intensity) || 0.6,
            durationTurns: Number(templateDraft.durationTurns) || 0,
          };
          var next = await request('/api/rp-bot/effect-templates', { method: 'POST', body: body });
          setTemplates(next.templates || []);
          if (next.template) editTemplate(next.template);
        });
      }

      function deleteTemplate() {
        if (!templateDraft || !templateDraft.id) return;
        if (!window.confirm('删除效果「' + (templateDraft.name || '') + '」？')) return;
        run('template', async function () {
          var next = await request('/api/rp-bot/effect-templates/delete', { method: 'POST', body: { id: templateDraft.id } });
          setTemplates(next.templates || []);
          setTemplateDraft(null);
        });
      }

      if (state === null || settings === null) {
        return h('div', { className: 'dsh-rp-card' }, h('div', { className: 'dsh-rp-sub' }, error || '读取 RPLink 状态…'));
      }

      if (view === 'effects') {
        return h('div', { className: 'dsh-rp-card' },
          h('div', { className: 'dsh-rp-row', style: { justifyContent: 'space-between', alignItems: 'center' } },
            h('button', { type: 'button', className: 'dsh-rp-btn', onClick: function () { setView('main'); setTemplateDraft(null); } }, '← 返回'),
            h('h2', { style: { margin: 0, fontSize: 16 } }, '效果库'),
            h('button', { type: 'button', className: 'dsh-rp-btn', onClick: newTemplate }, '新建效果'),
          ),
          h('div', { className: 'dsh-rp-sub' }, '剧情触发词保留消息；/ 命令剥离消息，不调用模型。同组按 level 覆盖，level 越大越强。'),
          error ? h('div', { className: 'dsh-rp-error' }, error) : null,
          h('div', { className: 'dsh-rp-list', style: { marginTop: 10 } },
            (templates || []).map(function (template) {
              return h('div', {
                key: template.id,
                'data-selected': templateDraft?.id === template.id,
                className: 'dsh-rp-item',
                style: { cursor: 'pointer' },
                onClick: function () { editTemplate(template); },
              },
                h('span', null, template.name + (template.group ? ' · ' + template.group + ' L' + template.level : '')),
                h('span', { className: 'dsh-rp-sub' }, template.enabled === false ? '停用' : '启用'),
              );
            }),
          ),
          templateDraft
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 } },
                h('label', { className: 'dsh-rp-field' }, '名称',
                  h('input', { className: 'dsh-rp-input', value: templateDraft.name || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, name: event.target.value }); } }),
                ),
                h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 } },
                  h('label', { className: 'dsh-rp-field' }, '分组',
                    h('input', { className: 'dsh-rp-input', value: templateDraft.group || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, group: event.target.value }); } }),
                  ),
                  h('label', { className: 'dsh-rp-field' }, '等级',
                    h('input', { className: 'dsh-rp-input', type: 'number', value: templateDraft.level || 1, onChange: function (event) { setTemplateDraft({ ...templateDraft, level: Number(event.target.value) }); } }),
                  ),
                  h('label', { className: 'dsh-rp-field' }, '启用',
                    h('input', { type: 'checkbox', checked: templateDraft.enabled !== false, onChange: function (event) { setTemplateDraft({ ...templateDraft, enabled: event.target.checked }); } }),
                  ),
                ),
                h('label', { className: 'dsh-rp-field' }, '剧情触发词（每行一个，保留消息）',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: templateDraft.triggersText || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, triggersText: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '/ 命令（每行一个，不发给模型）',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: templateDraft.commandsText || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, commandsText: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '状态描述',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '110px' }, value: templateDraft.prompt || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, prompt: event.target.value }); } }),
                ),
                h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                  h('label', { className: 'dsh-rp-field' }, '强度 0–1',
                    h('input', { className: 'dsh-rp-input', type: 'number', step: '0.1', value: templateDraft.intensity ?? 0.6, onChange: function (event) { setTemplateDraft({ ...templateDraft, intensity: Number(event.target.value) }); } }),
                  ),
                  h('label', { className: 'dsh-rp-field' }, '持续轮数',
                    h('input', { className: 'dsh-rp-input', type: 'number', value: templateDraft.durationTurns ?? 8, onChange: function (event) { setTemplateDraft({ ...templateDraft, durationTurns: Number(event.target.value) }); } }),
                  ),
                ),
                h('label', { className: 'dsh-rp-field' }, '跨组覆盖（可选，逗号分隔模板 id）',
                  h('input', { className: 'dsh-rp-input', value: templateDraft.overridesText || '', onChange: function (event) { setTemplateDraft({ ...templateDraft, overridesText: event.target.value }); } }),
                ),
                h('div', { className: 'dsh-rp-row' },
                  h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-primary', disabled: busy === 'template', onClick: saveTemplate }, '保存效果'),
                  templateDraft.id
                    ? h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-danger', disabled: busy === 'template', onClick: deleteTemplate }, '删除效果')
                    : null,
                ),
              )
            : h('div', { className: 'dsh-rp-sub', style: { marginTop: 10 } }, '选择效果编辑，或新建。'),
        );
      }

      var pairing = state.pairing;

      return h('div', { className: 'dsh-rp-card' },
        h('div', { className: 'dsh-rp-row', style: { justifyContent: 'space-between' } },
          h('div', null,
            h('h2', { className: 'dsh-rp-title' }, 'RPLink'),
            h('div', { className: 'dsh-rp-sub' }, '角色扮演 bot 的局域网服务。'),
          ),
          h('span', { className: 'dsh-rp-pill', 'data-online': state.running === true }, state.running ? '运行中' : '未运行'),
        ),
        error === '' ? null : h('div', { className: 'dsh-rp-error' }, error),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '连接'),
          h('div', { className: 'dsh-rp-sub' }, '地址 ', h('code', null, 'https://' + (state.address || '—') + ':' + (state.port || '—'))),
          h('div', { className: 'dsh-rp-sub' }, 'CA 指纹 ', h('code', null, (state.caFingerprint || '').slice(0, 24) + '…')),
          pairing
            ? h('div', { className: 'dsh-rp-row', style: { alignItems: 'flex-start', gap: 14 } },
                h('img', { src: '/api/rp-bot/qr?ts=' + Date.now(), alt: '配对二维码', width: 160, height: 160, style: { background: '#fff', borderRadius: 10, padding: 6 } }),
                h('div', { className: 'dsh-rp-sub' },
                  h('div', { className: 'dsh-rp-code' }, pairing.code),
                  h('div', null, '有效期至 ' + new Date(pairing.expiresAt).toLocaleTimeString()),
                  h('div', { style: { wordBreak: 'break-all' } }, pairing.url),
                ),
              )
            : h('div', { className: 'dsh-rp-sub' }, '还没有配对码。'),
          h('div', { className: 'dsh-rp-row' },
            h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-primary', disabled: busy === 'pairing', onClick: newCode }, pairing ? '重新生成配对码' : '生成配对码'),
          ),
          h('div', { className: 'dsh-rp-list' },
            (state.devices || []).length === 0
              ? h('div', { className: 'dsh-rp-sub' }, '还没有设备。')
              : state.devices.map(function (device) {
                  return h('div', { key: device.id, className: 'dsh-rp-item' },
                    h('span', null, (device.name || 'Android') + ' · ' + (device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '—')),
                    h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-danger', onClick: function () { revoke(device); } }, '移除'),
                  );
                }),
          ),
        ),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '角色'),
          h('div', { className: 'dsh-rp-list' },
            characters.map(function (character) {
              return h('div', {
                key: character.id,
                'data-selected': draft?.id === character.id,
                className: 'dsh-rp-item',
                style: { cursor: 'pointer' },
                onClick: function () { setDraft({ ...character }); },
              },
                h('span', null, character.name + (character.tagline ? ' · ' + character.tagline : '')),
                h('span', { className: 'dsh-rp-sub' }, character.id),
              );
            }),
          ),
          h('div', { className: 'dsh-rp-row' },
            h('button', { type: 'button', className: 'dsh-rp-btn', onClick: function () {
              setDraft({
                id: '', name: '', tagline: '',
                core: { identity: '', personality: '', values: '', speechStyle: '', boundaries: '' },
                appearance: { summary: '', tags: '' },
                relationship: { initial: '' },
                legacyCard: '', card: '',
              });
            } }, '新建角色'),
          ),
          draft
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('label', { className: 'dsh-rp-field' }, '名字',
                  h('input', { className: 'dsh-rp-input', value: draft.name || '', onChange: function (event) { setDraft({ ...draft, name: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '一句话',
                  h('input', { className: 'dsh-rp-input', value: draft.tagline || '', onChange: function (event) { setDraft({ ...draft, tagline: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '身份',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '70px' }, value: draft.core?.identity || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), identity: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '人格',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '70px' }, value: draft.core?.personality || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), personality: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '价值观',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: draft.core?.values || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), values: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '说话风格',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: draft.core?.speechStyle || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), speechStyle: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '对用户的称呼',
                  h('input', { className: 'dsh-rp-input', value: draft.core?.addressing || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), addressing: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '底线',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: draft.core?.boundaries || '', onChange: function (event) { setDraft({ ...draft, core: { ...(draft.core || {}), boundaries: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '外貌',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: draft.appearance?.summary || '', onChange: function (event) { setDraft({ ...draft, appearance: { ...(draft.appearance || {}), summary: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '外貌标签（生图用）',
                  h('input', { className: 'dsh-rp-input', value: draft.appearance?.tags || '', onChange: function (event) { setDraft({ ...draft, appearance: { ...(draft.appearance || {}), tags: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '与用户的关系（初始）',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '60px' }, value: draft.relationship?.initial || '', onChange: function (event) { setDraft({ ...draft, relationship: { ...(draft.relationship || {}), initial: event.target.value } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '启用生图',
                  h('input', { type: 'checkbox', checked: draft.image?.enabled === true, onChange: function (event) { setDraft({ ...draft, image: { ...(draft.image || {}), enabled: event.target.checked } }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '允许的生图模型（逗号分隔，由自定义 provider 解释）',
                  h('input', { className: 'dsh-rp-input', value: (draft.image?.cards || []).join(', '), onChange: function (event) { setDraft({ ...draft, image: { ...(draft.image || {}), cards: event.target.value.split(',').map(function (item) { return item.trim(); }).filter(Boolean) } }); } }),
                ),
                h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                  h('label', { className: 'dsh-rp-field' }, '每章最多几张',
                    h('input', { className: 'dsh-rp-input', type: 'number', value: draft.image?.maxPerChapter || 3, onChange: function (event) { setDraft({ ...draft, image: { ...(draft.image || {}), maxPerChapter: Number(event.target.value) } }); } }),
                  ),
                  h('label', { className: 'dsh-rp-field' }, '生图追加提示词（英文 tag）',
                    h('input', { className: 'dsh-rp-input', value: draft.image?.extraPrompt || '', onChange: function (event) { setDraft({ ...draft, image: { ...(draft.image || {}), extraPrompt: event.target.value } }); } }),
                  ),
                ),
                h('label', { className: 'dsh-rp-field' }, '启用表情包',
                  h('input', { type: 'checkbox', checked: draft.stickers?.enabled === true, onChange: function (event) { setDraft({ ...draft, stickers: { ...(draft.stickers || {}), enabled: event.target.checked } }); } }),
                ),
                h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                  h('label', { className: 'dsh-rp-field' }, '表情包目录名',
                    h('input', { className: 'dsh-rp-input', value: draft.stickers?.pack || '', onChange: function (event) { setDraft({ ...draft, stickers: { ...(draft.stickers || {}), pack: event.target.value } }); } }),
                  ),
                  h('label', { className: 'dsh-rp-field' }, '每次最多几个',
                    h('input', { className: 'dsh-rp-input', type: 'number', value: draft.stickers?.maxPerReply || 3, onChange: function (event) { setDraft({ ...draft, stickers: { ...(draft.stickers || {}), maxPerReply: Number(event.target.value) } }); } }),
                  ),
                ),

                h('div', { className: 'dsh-rp-row' },
                  h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-primary', disabled: busy === 'character', onClick: saveCharacter }, '保存角色'),
                  draft.id
                    ? h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-danger', disabled: busy === 'character', onClick: deleteCharacter }, '删除角色')
                    : null,
                ),
              )
            : null,
        ),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '模型'),
          h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 } },
            h('label', { className: 'dsh-rp-field' }, 'Provider',
              h('input', { className: 'dsh-rp-input', value: settings.provider || '', onChange: function (event) { setSettings({ ...settings, provider: event.target.value }); } }),
            ),
            h('label', { className: 'dsh-rp-field' }, 'Model',
              h('input', { className: 'dsh-rp-input', value: settings.model || '', onChange: function (event) { setSettings({ ...settings, model: event.target.value }); } }),
            ),
            h('label', { className: 'dsh-rp-field' }, 'Reasoning',
              h('select', { className: 'dsh-rp-input', value: settings.reasoningEffort || 'off', onChange: function (event) { setSettings({ ...settings, reasoningEffort: event.target.value }); } },
                h('option', { value: 'off' }, 'off'),
                h('option', { value: 'low' }, 'low'),
                h('option', { value: 'high' }, 'high'),
                h('option', { value: 'max' }, 'max'),
              ),
            ),
            h('label', { className: 'dsh-rp-field' }, '聊天 max tokens',
              h('input', { className: 'dsh-rp-input', type: 'number', value: settings.chatMaxTokens || 600, onChange: function (event) { setSettings({ ...settings, chatMaxTokens: Number(event.target.value) }); } }),
            ),
            h('label', { className: 'dsh-rp-field' }, '见面 max tokens',
              h('input', { className: 'dsh-rp-input', type: 'number', value: settings.meetingMaxTokens || 3000, onChange: function (event) { setSettings({ ...settings, meetingMaxTokens: Number(event.target.value) }); } }),
            ),
            h('label', { className: 'dsh-rp-field' }, '回复超时（毫秒）',
              h('input', { className: 'dsh-rp-input', type: 'number', value: settings.replyTimeoutMs || 120000, onChange: function (event) { setSettings({ ...settings, replyTimeoutMs: Number(event.target.value) }); } }),
            ),
            h('div', { className: 'dsh-rp-row', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
              h('label', { className: 'dsh-rp-field' }, '回复延迟下限（秒，0=不加）',
                h('input', { className: 'dsh-rp-input', type: 'number', min: '0', step: '0.1', value: (Number(settings.replyDelayMinMs) || 0) / 1000, onChange: function (event) { setSettings({ ...settings, replyDelayMinMs: Math.max(0, Number(event.target.value) || 0) * 1000 }); } }),
              ),
              h('label', { className: 'dsh-rp-field' }, '回复延迟上限（秒）',
                h('input', { className: 'dsh-rp-input', type: 'number', min: '0', step: '0.1', value: (Number(settings.replyDelayMaxMs) || 0) / 1000, onChange: function (event) { setSettings({ ...settings, replyDelayMaxMs: Math.max(0, Number(event.target.value) || 0) * 1000 }); } }),
              ),
            ),
          ),
          h('div', { className: 'dsh-rp-row' },
            h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-primary', disabled: busy === 'settings', onClick: saveSettings }, '保存模型设置'),
          ),
        ),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '效果库'),
          h('div', { className: 'dsh-rp-sub' }, '编写剧情触发词和 / 命令；同组按等级覆盖。'),
          h('div', { className: 'dsh-rp-row' },
            h('button', { type: 'button', className: 'dsh-rp-btn', onClick: function () { setView('effects'); } }, '打开效果库（' + (templates || []).length + '）'),
          ),
        ),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '提示词'),
          h('div', { className: 'dsh-rp-sub' }, '修改后下一轮生效，不需要重启。角色卡在“角色”里改。'),
          prompts
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
                h('label', { className: 'dsh-rp-field' }, '扮演框架',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '90px' }, value: prompts.framework || '', onChange: function (event) { setPrompts({ ...prompts, framework: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '聊天模式规则',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '120px' }, value: prompts.chat || '', onChange: function (event) { setPrompts({ ...prompts, chat: event.target.value }); } }),
                ),
                h('label', { className: 'dsh-rp-field' }, '见面模式规则',
                  h('textarea', { className: 'dsh-rp-textarea', style: { minHeight: '150px' }, value: prompts.meeting || '', onChange: function (event) { setPrompts({ ...prompts, meeting: event.target.value }); } }),
                ),
                h('div', { className: 'dsh-rp-row' },
                  h('button', { type: 'button', className: 'dsh-rp-btn dsh-rp-btn-primary', disabled: busy === 'prompts', onClick: savePrompts }, '保存提示词'),
                ),
              )
            : h('div', { className: 'dsh-rp-sub' }, '读取提示词…'),
        ),

        h('div', { className: 'dsh-rp-section' },
          h('h3', { className: 'dsh-rp-section-title' }, '记忆'),
          h('div', { className: 'dsh-rp-sub' }, 'OpenViking ',
            h('span', { className: 'dsh-rp-pill', 'data-online': memory?.healthy === true }, memory?.healthy ? '已连接' : '不可用'),
            ' ', h('code', null, memory?.endpoint || '—'), ' ', (memory?.version || '')),
          memory?.error ? h('div', { className: 'dsh-rp-error' }, memory.error) : null,
          h('div', { className: 'dsh-rp-row' },
            h('button', { type: 'button', className: 'dsh-rp-btn', onClick: function () { run('memory', async function () { var mem = await request('/api/rp-bot/memory'); setMemory(mem.memory || null); }); } }, '刷新记忆状态'),
          ),
        ),
      );
    }

    function apply(ctx) {
      installStyles();
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register(
          { name: 'settings.section', id: 'dsh-rp-bot', order: 81, label: () => 'RPLink' },
          () => h(Panel),
        ),
      );
    }

    module.exports = { apply, inject: ['slots'] };
    return module.exports;
  },
});
