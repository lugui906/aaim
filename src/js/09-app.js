/* ============ 09 应用装配：输入区 / 设置抽屉 / 导入导出 / 启动 ============ */
const App = {
  attachments: [],   // {kind:'image'|'file', name, dataUrl, text, chars}
  listening: false,

  /* ---------------- 输入区 ---------------- */
  initComposer() {
    const ta = $('#prompt');
    ta.addEventListener('input', () => autoGrow(ta));
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && State.settings.sendWithEnter && !e.isComposing) { e.preventDefault(); this.send(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.send(); }
    });
    $('#btnSend').addEventListener('click', () => this.send());
    $('#btnStop').addEventListener('click', () => { Agent.stop(); toast('已请求停止'); });
    $('#btnAttach').addEventListener('click', () => $('#fileInput').click());
    $('#fileInput').addEventListener('change', (e) => { this.addFiles(Array.from(e.target.files || [])); e.target.value = ''; });
    $('#btnMic').addEventListener('click', () => this.toggleMic());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Agent.busy) { Agent.stop(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); $('#prompt').focus(); }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); UI.newSession(); }
    });
    // 拖拽
    ['dragenter', 'dragover'].forEach((ev) => document.addEventListener(ev, (e) => { e.preventDefault(); document.body.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => { if (ev === 'dragleave' && e.relatedTarget) return; if (ev === 'drop') e.preventDefault(); document.body.classList.remove('dragging'); }));
    document.addEventListener('drop', (e) => { const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []); if (fs.length) this.addFiles(fs); });
  },

  async addFiles(files) {
    const okList = [];
    for (const f of files) {
      if (f.size > 40 * 1024 * 1024) { toast(`${f.name} 超过 40MB，已跳过`, 'err'); continue; }
      const name = f.name;
      try {
        if (/^image\//.test(f.type)) {
          const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
          this.attachments.push({ kind: 'image', name, dataUrl, size: f.size });
        } else if (DocParser.isOffice(name) || /\.pdf$/i.test(name) || f.type === 'application/pdf') {
          // PDF / DOCX / XLSX / PPTX / XLS / CSV → 统一走解析器
          const t = toast(`${name} 解析中…`, '', 60000);
          let r;
          try { r = await DocParser.read(f, name); }
          finally { t.remove(); }
          const text = (r.text || '').slice(0, 200000);
          if (!text.trim()) throw new Error('没有提取到文字内容');
          this.attachments.push({ kind: 'file', name, text, chars: text.length, size: f.size, docKind: r.meta && r.meta.kind, meta: r.meta });
          const label = { docx: 'Word', xlsx: 'Excel', pptx: 'PPT', pdf: 'PDF' }[r.meta && r.meta.kind] || (r.meta && r.meta.kind) || '文本';
          okList.push(`${label}《${name}》${text.length} 字` + (r.meta && r.meta.slides ? ` / ${r.meta.slides} 页` : '') + (r.meta && r.meta.sheets ? ` / ${r.meta.sheets} 表` : ''));
        } else if (/\.(txt|md|markdown|csv|json|js|mjs|ts|tsx|py|html|css|xml|yaml|yml|log|ini|conf|sh|java|c|cpp|h|rs|go|rb|php|sql|toml)$/i.test(name) || /^text\//.test(f.type)) {
          const text = await f.text();
          this.attachments.push({ kind: 'file', name, text: text.slice(0, 200000), chars: text.length, size: f.size, docKind: 'text' });
          okList.push(`《${name}》${text.length} 字`);
        } else {
          const hint = DocParser.unsupportedHint(name);
          toast(hint || `${name}：暂不支持该类型（支持 PDF / Word / Excel / PPT / 文本 / 图片）`, 'err', hint ? 7000 : 4600);
        }
      } catch (e) {
        toast(`${name} 解析失败：${e.message}`, 'err', 7000);
      }
    }
    this.renderAttachments();
    if (okList.length) {
      toast(okList.length === 1 ? '已解析 ' + okList[0] : `已解析 ${okList.length} 个文件`, 'ok', 2000);
    }
  },

  async readPdf(file) { return readPdfBlob(file); },

  renderAttachments() {
    const box = $('#attachBox');
    box.innerHTML = '';
    box.style.display = this.attachments.length ? 'flex' : 'none';
    this.attachments.forEach((a, i) => {
      const node = el('span', { class: 'a' },
        a.kind === 'image' ? el('img', { src: a.dataUrl }) : '📎',
        el('span', { text: a.name + (a.chars ? ` (${a.chars} 字)` : '') }),
        el('span', { class: 'rm', text: '✕', onclick: () => { this.attachments.splice(i, 1); this.renderAttachments(); } }));
      box.append(node);
    });
  },

  toggleMic() {
    if (this.listening) { ASR.stop(); this.listening = false; $('#btnMic').style.color = ''; return; }
    this.listening = true; $('#btnMic').style.color = 'var(--accent)';
    const ta = $('#prompt');
    const base = ta.value;
    ASR.start((t, final) => { ta.value = base + t; autoGrow(ta); if (final) { this.listening = false; $('#btnMic').style.color = ''; } }, () => { this.listening = false; $('#btnMic').style.color = ''; });
  },

  send() {
    const ta = $('#prompt');
    const text = ta.value.trim();
    if (!text && !this.attachments.length) return;
    const images = this.attachments.filter((a) => a.kind === 'image').map((a) => ({ name: a.name, dataUrl: a.dataUrl }));
    const files = this.attachments.filter((a) => a.kind === 'file').map((a) => ({ name: a.name, chars: a.chars }));
    let content = text;
    const fileTexts = this.attachments.filter((a) => a.kind === 'file');
    if (fileTexts.length) {
      content += '\n\n' + fileTexts.map((f) => `【附件：${f.name}】\n${truncate(f.text, 12000)}`).join('\n\n');
    }
    ta.value = ''; autoGrow(ta);
    const display = text || '（仅附件）';
    this.attachments = []; this.renderAttachments();
    // content 含附件全文（给模型），display 只放用户原文（给界面）
    Agent.enqueue(content || '（见附件）', { images, files, display });
    $('#prompt').focus();
  },

  /* ---------------- Agent 钩子 → DOM ---------------- */
  bindAgent() {
    const box = () => $('#messages');
    const setSumm = (t) => { if (t && t.summ) t.summ.textContent = UI.stepsLabel(t.toolCount, t.totalMs, t.failed); };
    Agent.hooks = {
      onQueue: (n) => {
        const badge = $('#queueBadge'), foot = document.querySelector('.side-foot');
        if (badge) { badge.textContent = n ? `排队 ${n}` : ''; badge.style.display = n ? 'inline-flex' : 'none'; }
        if (foot) foot.classList.toggle('show', n > 0);
      },
      onUser: (m) => {
        const e = box().querySelector('.empty'); if (e) e.remove();
        box().append(UI.userNode(m)); scrollBottom(true);
        this.setRunning(true);
      },
      onStepsStart: () => {
        // 思考块：独立可折叠，默认收起；流式时仍可见标题行
        const thinkInner = el('div', { class: 'inner' }, el('div', { class: 'thinking md' }));
        const thinkSumm = el('span', { class: 'stxt', text: '思考中…' });
        const thinkBox = el('details', { class: 'steps thinkbox', style: 'display:none' },
          el('summary', {}, thinkSumm), thinkInner);
        const thinkBody = thinkInner.querySelector('.thinking');

        // 工具调用块：一行摘要
        const inner = el('div', { class: 'inner' });
        const summ = el('span', { class: 'stxt', text: '正在处理…' });
        const details = el('details', { class: 'steps', open: true }, el('summary', {}, summ), inner);

        // 产物区：常显
        const arts = el('div', { class: 'artifacts', style: 'display:none' });
        const bowl = el('div', { class: 'bubble md', html: '<span class="cursor"></span>' });

        const viz = el('div', { class: 'vizout' });
        const body = el('div', { class: 'body' }, thinkBox, details, viz, arts, bowl);
        const node = el('div', { class: 'msg agent' }, body);
        box().append(node); scrollBottom(true);
        UI.turn = {
          node, details, inner, summ, thinkBox, thinkSumm, thinkBody, viz, arts, bowl,
          stepMap: new Map(), toolCount: 0, totalMs: 0, failed: 0,
          rawText: '', rawThink: '', lastPaint: 0, lastThinkPaint: 0, artIds: new Set()
        };
      },
      onStepStart: () => { const t = UI.turn; if (t && !t.toolCount) t.summ.textContent = '正在思考…'; },
      onDelta: (d, all) => {
        const t = UI.turn; if (!t) return;
        t.rawText = all;
        const now = performance.now();
        if (now - t.lastPaint > 70) {
          t.lastPaint = now;
          t.bowl.innerHTML = MD.render(all) + '<span class="cursor"></span>';
          scrollBottom();
        }
      },
      onThink: (d, all) => {
        const t = UI.turn; if (!t || !State.settings.showThinking) return;
        t.rawThink = all;
        t.thinkBox.style.display = '';
        t.thinkSumm.textContent = '思考中…' + (all.length > 30 ? `（${all.length} 字）` : '');
        const now = performance.now();
        if (now - t.lastThinkPaint > 120) {
          t.lastThinkPaint = now;
          t.thinkBody.innerHTML = MD.render(truncate(all, 4000));
        }
        scrollBottom();
      },
      onAssistantDone: (m, step) => {
        const t = UI.turn; if (!t) return;
        t.bowl.innerHTML = MD.render(m.content || '');
        MD.highlight(t.bowl);
        if (!m.content && m.tool_calls && m.tool_calls.length) t.bowl.style.display = 'none';
        // ★ 非流式提供商 / 演示模型一次性返回 thinking 时，onThink 不会被调用，这里兜底
        if (m.thinking && !t.rawThink) t.rawThink = m.thinking;
        // 思考块收尾：折叠起来，标题显示字数
        if (t.rawThink && State.settings.showThinking) {
          t.thinkBox.style.display = '';
          t.thinkBody.innerHTML = MD.render(truncate(t.rawThink, 4000));
          t.thinkSumm.textContent = '思考过程 · ' + t.rawThink.length + ' 字';
          t.thinkBox.open = false;
        }
        scrollBottom();
      },
      onToolStart: (call) => {
        const t = UI.turn; if (!t) return;
        t.toolCount++;
        const row = UI.stepNode({ name: call.name, args: call.arguments, state: 'running' });
        t.inner.append(row);
        t.stepMap.set(call.id, row);
        t.summ.textContent = `正在执行 ${call.name}…`;
        scrollBottom();
      },
      onToolEnd: (call, out, step) => {
        const t = UI.turn; if (!t) return;
        t.totalMs += out.ms || 0;
        if (out.ok === false) t.failed++;
        const row = t.stepMap.get(call.id);
        if (row) {
          const rg = row.querySelector('.rg');
          rg.className = 'rg ' + (out.ok ? 'ok' : 'err');
          rg.textContent = (out.ok ? '成功' : '失败') + (out.ms ? ' · ' + fmtMs(out.ms) : '');
        }
        if (out.display) {
          const d = out.display;
          if (UI.isArtifactDisplay(d)) {
            // 文件产物：放到常显产物条，不进折叠区
            const items = d.kind === 'artifacts' ? (d.items || []) : [d.art];
            for (const a of items) {
              if (!a || t.artIds.has(a.id)) continue;
              t.artIds.add(a.id);
              t.arts.style.display = '';
              t.arts.append(UI.artifactsBar([a]).firstChild);
            }
          } else if (UI.isVisualDisplay(d)) {
            // 图表/流程图/图片/沙箱：直接可见
            if (d.kind === 'frame') {
              // 只让刚生成的那个自动跑；历史预览保持静止，避免多个页面同时运行
              const key = d._uid || d._key || ('f:' + String(d.title || '') + ':' + String(d.html || '').length + ':' + (d.height || 220));
              d._key = key;
              UI._autoRunKey = key;
            }
            const card = UI.displayNode(d, { name: call.name });
            t.viz.append(card);
            // 图表/图片依赖真实布局尺寸，等一帧再渲染
            requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch { } });
          } else {
            t.inner.append(UI.displayNode(d, { name: call.name }));
          }
        }
        setSumm(t);
        scrollBottom();
      },
      onUsage: () => { UI.updateHeader(); },
      onWarn: (msg) => toast(msg, '', 5000),
      onDone: (text, ms) => {
        this.setRunning(false);
        const t = UI.turn;
        if (t) {
          if (t.toolCount > 0) { t.details.open = false; setSumm(t); }
          else if (t.details.parentNode) t.details.remove();
        }
        UI.renderMessages();
        UI.updateHeader();
        UI.updateMemoryBadge();
      },
      onError: (e) => {
        this.setRunning(false);
        const t = UI.turn;
        const msg = (e && e.message) || String(e);
        // 预算触顶：给「继续执行」，而不是让用户以为程序坏了
        if (e && e.budget) {
          const node = el('div', { class: 'msg agent' }, el('div', { class: 'body' },
            el('div', { class: 'errbox warnbox' },
              el('div', { class: 'errhd', text: '预算护栏触发' }),
              el('div', { class: 'errmsg', text: msg }),
              el('div', { class: 'errhint', text: e.budget.reset
                ? '这是为了防止一次对话花太多钱。点「继续执行」会清零本会话统计后接着做，也可以在 设置 → 预算 里调高或关掉限制。'
                : '单轮工具调用过多会被拦下，避免死循环。点「继续执行」会接着再跑一轮。' }),
              el('div', { class: 'acts' },
                el('button', { class: 'btn sm primary', text: '继续执行', onclick: () => {
                  Agent.resetBudget();
                  node.remove();
                  Agent.regenerate();
                } }),
                el('button', { class: 'btn sm', text: '调高上限', onclick: () => Drawer.open('budget') }),
                el('button', { class: 'btn sm ghost', text: '关闭护栏', onclick: () => {
                  State.settings.budget.unlimited = true; State.saveSettings();
                  toast('已关闭 token / 费用上限（工具次数防死循环仍保留）', 'ok');
                  Drawer.render();
                } })))));
          if (t && t.node.parentNode) t.node.replaceWith(node); else $('#messages').append(node);
          scrollBottom(true);
          return;
        }
        let hint = '';
        if (/Failed to fetch|NetworkError|load failed/i.test(msg)) hint = '常见原因：① 浏览器 CORS 拦截（设置 → 模型 填代理地址）② Base URL 写错 ③ file:// 下部分浏览器限制请求。';
        else if (/401|403/.test(msg)) hint = 'Key 无效或无权限。';
        else if (/429/.test(msg)) hint = '触发限流，稍后再试或降低并发。';
        const node = el('div', { class: 'msg agent' }, el('div', { class: 'body' },
          el('div', { class: 'errbox' },
            el('div', { class: 'errhd', text: '请求失败' }),
            el('div', { class: 'errmsg', text: msg }),
            hint ? el('div', { class: 'errhint', text: hint }) : null,
            el('div', { class: 'acts' },
              el('button', { class: 'btn sm primary', text: '重试', onclick: () => Agent.regenerate() }),
              el('button', { class: 'btn sm', text: '打开设置', onclick: () => Drawer.open('model') })))));
        if (t && t.node.parentNode) t.node.replaceWith(node); else $('#messages').append(node);
        scrollBottom(true);
      },
      onAborted: () => {
        this.setRunning(false);
        const t = UI.turn;
        if (t) {
          if (t.toolCount > 0) { t.details.open = false; setSumm(t); }
          if (!t.rawText) t.bowl.innerHTML = '<span style="color:var(--text-placeholder)">（已停止）</span>';
        }
        UI.renderMessages();
      },
      onIdle: () => { this.setRunning(false); UI.updateHeader(); }
    };
  },

  setRunning(run) {
    Agent.busy = run;
    $('#btnSend').style.display = run ? 'none' : '';
    $('#btnStop').style.display = run ? '' : 'none';
    $('#prompt').placeholder = run ? '正在执行，可继续输入排队…' : '给 Agent 一个任务…';
  },

  /* ---------------- 导入导出 ---------------- */
  exportSession(fmt) {
    const s = State.current();
    if (!s.messages.length) return toast('当前会话为空', 'err');
    if (fmt === 'json') {
      downloadBlob(new Blob([JSON.stringify(s, null, 2)], { type: MIME.json }), safeName(s.title) + '.json');
      return;
    }
    let md = `# ${s.title}\n\n> 导出时间：${fmtTime(Date.now())}　模型：${curModelLabel()}\n\n`;
    for (const m of s.messages) {
      if (m.role === 'user') md += `## 🧑 用户\n\n${m.content}\n\n`;
      else if (m.role === 'assistant') {
        md += `## 🤖 Agent\n\n`;
        if (m.tool_calls && m.tool_calls.length) md += m.tool_calls.map((c) => `- 工具 \`${c.name}\`：\`${truncate(JSON.stringify(c.arguments), 300)}\``).join('\n') + '\n\n';
        if (m.thinking) md += `> 思考：${m.thinking.replace(/\n/g, ' ')}\n\n`;
        md += `${m.content || ''}\n\n`;
      } else if (m.role === 'tool') md += `> 工具结果 ${m.name}：${truncate(m.content, 600)}\n\n`;
    }
    downloadBlob(new Blob([md], { type: MIME.md }), safeName(s.title) + '.md');
  },
  exportSettings() {
    const clone = JSON.parse(JSON.stringify(State.settings));
    // 导出时不带 Key
    for (const p of Object.values(clone.providers)) p.apiKey = '';
    clone.search.deepseekKey = clone.search.tavilyKey = clone.search.serperKey = '';
    clone.image.arkKey = clone.image.qwenKey = '';
    downloadBlob(new Blob([JSON.stringify({ settings: clone, plugins: State.plugins }, null, 2)], { type: MIME.json }), 'aaim-agent-config.json');
    toast('已导出（不含 API Key）', 'ok');
  },
  importSettings(file) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const j = JSON.parse(r.result);
        if (j.settings) State.settings = mergeDefaults(j.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
        if (Array.isArray(j.plugins)) { State.plugins = j.plugins; this.loadPlugins(); }
        State.saveSettings();
        UI.updateHeader(); Drawer.render();
        toast('配置已导入', 'ok');
      } catch (e) { toast('导入失败：' + e.message, 'err'); }
    };
    r.readAsText(file);
  },
  exportAudit() {
    if (!State.audit.length) return toast('暂无审计记录', 'err');
    downloadBlob(new Blob([JSON.stringify(State.audit, null, 2)], { type: MIME.json }), 'aaim-agent-audit.json');
  },

  /* ---------------- 插件（L6） ---------------- */
  loadPlugins() {
    for (const p of State.plugins) {
      try {
        Tools.register({
          name: p.name, desc: p.desc, params: p.params || { type: 'object', properties: {} },
          category: 'plugin', sensitive: !!p.sensitive, enabled: p.enabled !== false,
          async run(args) {
            const r = await Sandbox.runJS(`var args = ${JSON.stringify(args || {})};\n${p.code}`, { timeout: 8000 });
            if (!r.ok) return { ok: false, summary: '插件执行失败：' + r.error };
            const res = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
            return { ok: true, summary: `插件 ${p.name} 返回：\n${truncate(res, 3000)}`, display: { kind: 'code', code: p.code, result: res, logs: r.logs } };
          }
        });
      } catch (e) { console.warn('插件注册失败', p.name, e); }
    }
  },

  /* ---------------- 启动 ---------------- */
  boot() {
    // 主题
    document.documentElement.dataset.theme = State.settings.theme || 'dark';
    this.loadPlugins();
    UI.init();
    this.initComposer();
    this.bindAgent();
    this.setRunning(false);
    // 顶栏按钮
    $('#btnNew').addEventListener('click', () => UI.newSession());
    // 移动端侧栏：四种关闭方式（按钮 / 遮罩 / 选会话 / Esc）
    $('#btnMenu').addEventListener('click', () => this.toggleNav());
    $('#btnNavClose').addEventListener('click', () => this.closeNav());
    $('#navMask').addEventListener('click', () => this.closeNav());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) { e.stopPropagation(); this.closeNav(); }
    }, true);
    // 视口变宽时自动收起，避免残留状态
    window.addEventListener('resize', debounce(() => { if (window.innerWidth > 900) this.closeNav(false); }, 150));
    $('#btnTheme').addEventListener('click', () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t; State.settings.theme = t; State.saveSettings();
      this.setThemeIcon(t);
    });
    this.setThemeIcon(State.settings.theme);
    $('#btnSettings').addEventListener('click', () => Drawer.open('model'));
    // 更多菜单
    const menu = $('#moreMenu');
    $('#btnMore').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('open'); UI.updateMemoryBadge(); });
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.classList.remove('open'); });
    menu.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
      menu.classList.remove('open');
      const k = b.dataset.m;
      if (k === 'memory') Drawer.open('memory');
      if (k === 'spec') Drawer.open('spec');
      if (k === 'export') this.exportMenu();
      if (k === 'usage') Drawer.open('budget');
      if (k === 'clear') this.clearSession();
      if (k === 'import') $('#importFile').click();
    }));
    // 本机文件
    $('#btnLocal').addEventListener('click', () => this.pickLocalFiles());
    $('#importFile').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) this.importSettings(f); e.target.value = ''; });
    if ('speechSynthesis' in window) { TTS.load(); speechSynthesis.onvoiceschanged = () => TTS.load(); }
    // 用量条 & 状态
    UI.updateHeader();
    UI.updateMemoryBadge();
    // 规格面板等首次渲染
    Drawer.init();
    // 欢迎
    if (!State.sessions.length) { const s = newSession('欢迎使用'); State.sessions.push(s); State.currentId = s.id; State.saveSessions(); UI.renderSessions(); }
    if (!curKeyReady() && State.settings.provider === 'mock') {
      toast('当前是内置演示模型（无需 Key）。要接真模型：右上角 ⚙ → 模型', '', 6000);
    }
    $('#prompt').focus();
    // 后台清理过期产物（14 天 / 最多 80 个），避免 IndexedDB 无限增长
    setTimeout(() => { if (typeof ArtifactStore !== 'undefined') ArtifactStore.prune().catch(() => { }); }, 3000);
    console.log('[Aaim Agent] ready', APP.version, '工具数', Tools.active().length);
  },

  setThemeIcon(theme) {
    const ICON_SUN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/></svg>';
    const ICON_MOON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.7 8.7 0 1 0 11.3 11.3z"/></svg>';
    const b = $('#btnTheme');
    if (!b) return;
    b.innerHTML = theme === 'dark' ? ICON_SUN : ICON_MOON;
    b.title = theme === 'dark' ? '切换到浅色' : '切换到深色';
  },

  /* ---------------- 移动端侧栏开合 ---------------- */
  toggleNav() {
    if (document.body.classList.contains('nav-open')) this.closeNav();
    else this.openNav();
  },
  openNav() {
    document.body.classList.add('nav-open');
    const b = $('#btnMenu');
    if (b) b.setAttribute('aria-expanded', 'true');
    const c = $('#btnNavClose');
    if (c) c.focus({ preventScroll: true });
  },
  closeNav(restoreFocus = true) {
    if (!document.body.classList.contains('nav-open')) return;
    document.body.classList.remove('nav-open');
    const b = $('#btnMenu');
    if (b) {
      b.setAttribute('aria-expanded', 'false');
      if (restoreFocus) b.focus({ preventScroll: true });
    }
  },

  clearSession() {
    const s = State.current();
    if (!s.messages.length) return toast('已经是空会话');
    openModal({
      title: '清空当前会话', bodyHTML: '<div>将删除本会话的全部消息，不可撤销。要保留副本请先导出。</div>', okText: '清空', okClass: 'danger',
      onOk: () => { s.messages = []; s.title = '新会话'; State.saveSessions(); UI.renderMessages(); UI.updateHeader(); UI.renderSessions(); }
    });
  },

  /** 打开本机文件（可被 Agent 直接修改） */
  async pickLocalFiles() {
    if (!LocalFiles.supported()) {
      return toast('当前浏览器不支持直接读写本机文件（需 Chrome/Edge 86+）。可改用 ＋ 附件做只读解析。', 'err', 6000);
    }
    try {
      const recs = await LocalFiles.openPicker({ multiple: true });
      if (!recs.length) return;
      const list = LocalFiles.list();
      const box = $('#messages');
      const e = box.querySelector('.empty'); if (e) e.remove();
      box.append(el('div', { class: 'msg agent' }, el('div', { class: 'body' },
        el('div', { class: 'toolcard' },
          el('div', { class: 'hd' }, el('b', { text: '已打开本机文件' }), el('span', { class: 'badge', text: recs.length + ' 个' })),
          el('div', {}, recs.map((r) => el('div', { class: 'memrow' },
            el('span', { class: 'fileico', text: '📄' }),
            el('span', { class: 'memtxt', text: `${r.name} · ${fmtBytes(r.size)}${r.text != null ? ' · ' + r.text.length + ' 字' : ' · 二进制'}` })))),
          el('div', { class: 'acts' },
            el('button', { class: 'btn sm primary', text: '让 Agent 看看这些文件', onclick: () => {
              $('#prompt').value = `我已经打开了本机文件：${recs.map((r) => r.name).join('、')}。请先读一遍，然后告诉我它的结构和作用。`;
              autoGrow($('#prompt')); $('#prompt').focus();
            } }))))));
      scrollBottom(true);
      toast(`已授权 ${recs.length} 个文件（可读可写）`, 'ok');
      UI.updateHeader();
    } catch (e) {
      if (e.name !== 'AbortError') toast('打开失败：' + e.message, 'err', 5000);
    }
  },

  exportMenu() {
    openModal({
      title: '导出 / 分享', bodyHTML: `
        <div class="hint" style="margin-bottom:10px">会话导出保留完整工具调用记录；配置导出不含 API Key。</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn block" data-act="md">📝 当前会话 → Markdown</button>
          <button class="btn block" data-act="json">🧾 当前会话 → JSON</button>
          <button class="btn block" data-act="cfg">⚙ 设置与插件 → JSON</button>
          <button class="btn block" data-act="audit">🕵 工具审计记录 → JSON</button>
          <button class="btn block" data-act="print">🖨 打印 / 存为 PDF</button>
        </div>`, hideCancel: true, okText: '关闭',
      onOk: (body) => {
        body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
          const a = b.dataset.act;
          if (a === 'md') this.exportSession('md');
          if (a === 'json') this.exportSession('json');
          if (a === 'cfg') this.exportSettings();
          if (a === 'audit') this.exportAudit();
          if (a === 'print') window.print();
        }));
        return false; // 保持打开
      }
    });
  }
};
