/* ============ 08 消息渲染 / 步骤面板 / 工具结果卡片 ============ */
const UI = {
  turn: null,           // 当前回合的 DOM 句柄
  _frames: new Map(),   // 沙箱 iframe 缓存（避免重渲染重启）
  _autoRunKey: '',      // 只自动运行最新那一个，其余需用户点击
  _sbx: new Map(),      // 对应的沙箱句柄（可 stop）

  streaming: false,
  lastAssistantText: '',

  init() {
    this.renderSessions();
    this.renderMessages();
    this.updateHeader();
    this.bindSandboxBridge();
  },

  /* ---------------- 会话列表 ---------------- */
  renderSessions() {
    const box = $('#sessions');
    box.innerHTML = '';
    const list = State.sessions.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt - a.updatedAt);
    if (!list.length) { box.append(el('div', { class: 'sgroup', text: '还没有会话' })); }
    const groups = { '今天': [], '昨天': [], '更早': [] };
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (const s of list) {
      const d = new Date(s.updatedAt); d.setHours(0, 0, 0, 0);
      if (d.getTime() >= today.getTime()) groups['今天'].push(s);
      else if (d.getTime() >= today.getTime() - 86400000) groups['昨天'].push(s);
      else groups['更早'].push(s);
    }
    for (const [g, arr] of Object.entries(groups)) {
      if (!arr.length) continue;
      box.append(el('div', { class: 'sgroup', text: g }));
      for (const s of arr) {
        const item = el('div', { class: 'sitem' + (s.id === State.currentId ? ' active' : ''), title: s.title + '\n' + fmtTime(s.updatedAt) },
              el('span', { class: 't', text: s.title || '未命名' }),
          el('span', { class: 'x', html: Icons.close(11), title: '删除会话', onclick: (e) => { e.stopPropagation(); this.deleteSession(s.id); } }));
        item.addEventListener('click', () => {
          State.currentId = s.id; State.saveSessions();
          this.renderSessions(); this.renderMessages(); this.updateHeader();
          if (typeof App !== 'undefined') App.closeNav(false);
        });
        item.addEventListener('dblclick', () => this.renameSession(s));
        box.append(item);
      }
    }
  },
  deleteSession(id) {
    const s = State.sessions.find((x) => x.id === id);
    openModal({
      title: '删除会话', bodyHTML: `<div>确定删除「${esc(s ? s.title : '')}」？此操作不可撤销。</div>`, okText: '删除', okClass: 'danger', onOk: () => {
        State.sessions = State.sessions.filter((x) => x.id !== id);
        if (State.currentId === id) State.currentId = (State.sessions[0] || {}).id || '';
        State.saveSessions(); this.renderSessions(); this.renderMessages(); this.updateHeader();
      }
    });
  },
  renameSession(s) {
    openModal({
      title: '重命名会话', bodyHTML: `<div class="field"><input type="text" id="rnInput" value="${esc(s.title)}"></div>`, okText: '保存',
      onOk: (body) => { const v = body.querySelector('#rnInput').value.trim(); if (v) s.title = v; State.saveSessions(); this.renderSessions(); this.updateHeader(); }
    });
  },
  newSession() {
    const s = newSession('新会话');
    State.sessions.unshift(s); State.currentId = s.id; State.saveSessions();
    this.renderSessions(); this.renderMessages(); this.updateHeader();
    if (typeof App !== 'undefined') App.closeNav(false);
    $('#prompt').focus();
  },

  /** 沙箱子页里的运行时错误：合并提示，避免错误循环刷屏 */
  _sbxErrAt: 0,
  sandboxRunError(msg) {
    const now = Date.now();
    if (now - this._sbxErrAt < 3000) return;
    this._sbxErrAt = now;
    toast('沙箱内脚本报错：' + truncate(String(msg), 80), 'err', 4000);
  },

  /** 顶栏模式 chip：单 Agent / 企业团队 */
  updateModeChip() {
    const chip = $('#modeChip');
    if (!chip) return;
    const on = !!(State.org && State.org.enabled);
    const txt = $('#modeChipText');
    const n = (State.org && State.org.nodes) ? State.org.nodes.filter((x) => x.role !== 'inspector').length : 0;
    if (txt) txt.textContent = on ? '企业团队' + (n ? ` · ${n} 人` : '') : '单 Agent';
    chip.classList.toggle('on', on);
    chip.title = on ? '当前：企业式多 Agent 团队（点击切回单 Agent）' : '当前：单 Agent（点击切换到企业团队模式）';
    const oc = $('#orgCount');
    if (oc) oc.textContent = n ? String(n) : '';
  },

  /** 组织变动时刷新徽标与面板 */
  orgChanged() {
    this.updateModeChip();
    const n = (State.org && State.org.nodes) ? State.org.nodes.length : 0;
    const a = $('#orgCount');
    if (a) { a.textContent = n ? String(n) : ''; a.style.display = n ? '' : 'none'; }
    if (typeof OrgUI !== 'undefined') { try { OrgUI.render(); } catch { } }
  },

  updateMemoryBadge() {
    const n = (typeof Memory !== 'undefined') ? Memory.count() : 0;
    const a = $('#memCount');
    if (a) { a.textContent = n ? String(n) : ''; a.style.display = n ? '' : 'none'; }
    const b = $('#usageInline');
    if (b) { const u = State.usage; const t = u.inTok + u.outTok; b.textContent = t ? `${t} tok` : ''; }
  },

  /* ---------------- 顶栏 ---------------- */
  updateHeader() {
    const s = State.current();
    $('#topTitle').textContent = s.title || '新会话';
    const u = State.usage;
    // 侧栏不再显示 tok / 工具数（已并入 ⋯ 菜单的「用量与预算」）
    const b = State.settings.budget, used = (u.inTok + u.outTok) / Math.max(1, b.maxTokens);
    const bar = $('#usageBar i');
    if (bar) bar.style.width = Math.min(100, used * 100) + '%';
  },

  /* ---------------- 消息区 ---------------- */
  renderMessages() {
    const box = $('#messages');
    box.innerHTML = '';
    const s = State.current();
    if (!s.messages.length) { box.append(this.emptyState()); return; }
    const msgs = s.messages;
    let i = 0;
    while (i < msgs.length) {
      const m = msgs[i];
      if (m.role === 'user') { box.append(this.userNode(m)); i++; continue; }
      // 把连续的 assistant / tool 归并为一个回合组
      const group = [];
      while (i < msgs.length && msgs[i].role !== 'user') { group.push(msgs[i]); i++; }
      if (group.length) box.append(this.turnNode(group));
    }
    scrollBottom(true);
  },

  emptyState() {
    const briefs = [
      ['搜一下最新动态', '搜索 2026 年 AI Agent 的主要趋势，给 3 条结论'],
      ['改本机代码', '打开我的 config.json，把 debug 改成 false'],
      ['出个表格', '把 A 12 套 3600、B 8 套 2400、C 5 套 1500 做成 Excel'],
      ['画张图', '画一张 1–5 月销售额与成本的折线图']
    ];
    const fill = (p) => { const ta = $('#prompt'); ta.value = p; autoGrow(ta); ta.focus(); ta.setSelectionRange(p.length, p.length); };
    const on = !!(State.org && State.org.enabled);
    return el('div', { class: 'empty' },
      el('h2', { text: on ? '把目标交给团队' : '今天想做什么？' }),
      on
        ? null
        : el('button', {
            class: 'org-cta',
            onclick: () => { $('#modeChip').click(); },
            title: '领导拆解任务、分派给小领导与执行者，每份产出都要过独立检查者'
          },
          el('span', { class: 'org-cta-ico', html: Icons.flow ? Icons.flow(18) : '' }),
          el('span', { class: 'org-cta-tx' },
            el('b', { text: '开启企业模式' }),
            el('span', { text: '多个 Agent 分工协作：大领导拆解 → 小领导分派 → 执行者交付 → 检查者审核' })),
          el('span', { class: 'org-cta-go', text: '→' })),
      el('div', { class: 'pills' }, briefs.map(([t, p]) => el('button', { onclick: () => fill(p), title: p }, t))));
  },

  userNode(m) {
    if (m.silent) {
      return el('div', { class: 'msg silent' }, el('div', { class: 'body' }, el('span', { text: m.content })));
    }
    const body = el('div', { class: 'body' });
    if (m.images && m.images.length) {
      const g = el('div', { class: 'imgrid' });
      for (const im of m.images) g.append(el('figure', {}, el('img', { src: im.dataUrl, alt: im.name || '' })));
      body.append(g);
    }
    const shown = this.userDisplayText(m);
    if (shown) body.append(el('div', { class: 'bubble', html: MD.render(shown) }));
    // 附件小卡放在气泡下方，紧凑排列，便于看出"带着什么文件在问"
    if (m.files && m.files.length) {
      body.append(el('div', { class: 'attach files' }, m.files.map((f) =>
        el('span', { class: 'a', title: f.name }, 
          el('span', { class: 'artico', html: Icons.file(12) }),
          el('span', { class: 'aname', text: f.name }),
          f.chars ? el('span', { class: 'achars', text: f.chars + ' 字' }) : null))));
    }
    body.append(el('div', { class: 'msg-tools' },
      el('button', { class: 'btn sm ghost', text: '复制', onclick: () => copyText(m.content || '') }),
      el('button', { class: 'btn sm ghost', text: '编辑重发', onclick: () => { $('#prompt').value = this.userDisplayText(m); autoGrow($('#prompt')); $('#prompt').focus(); } })));
    return el('div', { class: 'msg user' }, body);
  },

  /** 用户消息在界面上显示什么：只显示自己写的那句话，不渲染附件全文 */
  userDisplayText(m) {
    if (!m) return '';
    if (m.display != null && String(m.display).trim()) return String(m.display);
    // 兼容旧数据：content 里可能拼了【附件：xxx】全文
    const raw = String(m.content || '');
    const i = raw.indexOf('\n\n【附件：');
    if (i > 0) return raw.slice(0, i).trim();
    if (/^【附件：/.test(raw)) return '（仅附件）';
    return raw;
  },

  /** 一个回合组：折叠的工具摘要 + 可折叠的思考 + 回答 + 产物 */
  turnNode(group) {
    const calls = [];
    for (const m of group) if (m.role === 'assistant' && m.tool_calls) calls.push(...m.tool_calls);
    const tools = group.filter((m) => m.role === 'tool');
    const think = group.filter((m) => m.role === 'assistant' && m.thinking).map((m) => m.thinking).join('\n\n').trim();
    const answer = group.filter((m) => m.role === 'assistant' && m.content).map((m) => m.content).join('\n\n').trim();
    const totalMs = tools.reduce((a, m) => a + (m.ms || 0), 0);
    const failed = tools.filter((m) => m.ok === false).length;
    const arts = this.artifactsOf(group);

    const body = el('div', { class: 'body' });
    const n = Math.max(calls.length, tools.length);

    // 思考过程：可折叠，默认收起
    if (think && State.settings.showThinking) {
      body.append(el('details', { class: 'steps thinkbox' },
        el('summary', {}, el('span', { class: 'stxt', text: `思考过程 · ${think.length} 字` })),
        el('div', { class: 'inner' }, el('div', { class: 'thinking md', html: MD.render(truncate(think, 4000)) }))));
    }

    // 工具调用：一行摘要，默认收起
    if (n > 0) {
      const inner = el('div', { class: 'inner' });
      // 按位置配对「调用」与「结果」；结果多于调用时（历史数据）也要渲染出来
      const maxN = Math.max(calls.length, tools.length);
      for (let i2 = 0; i2 < maxN; i2++) {
        const c = calls[i2] || null;
        const t = tools[i2] || {};
        const name = (c && c.name) || t.name || '工具';
        if (calls.length) {
          inner.append(this.stepNode({ name, args: (c && c.arguments) || {}, state: t.ok === false ? 'err' : 'ok', ms: t.ms }));
        }
        const d = t.display;
        if (d && !this.isDirectDisplay(d)) {
          inner.append(this.withOrgAction(this.displayNode(d, t), name, t.content, d));
        }
      }
      body.append(el('details', { class: 'steps' },
        el('summary', {}, el('span', { class: 'stxt', text: this.stepsLabel(n, totalMs, failed) })), inner));
    }

    // 可视输出（图表/流程图/图片/沙箱）：直接可见
    const vizItems = group.filter((m) => this.isVisualDisplay(m.display));
    if (vizItems.length) {
      const viz = el('div', { class: 'vizout' });
      for (const m of vizItems) {
        // 历史重渲染时，只有被标记为最新且仍存活的那个才继续跑
        if (m.display && m.display.kind === 'frame') {
          const k = m.display._key;
          if (!k || this._autoRunKey !== k) {
            // 临时压制自动运行
          }
        }
        viz.append(this.withOrgAction(this.displayNode(m.display, m), m.name || '工具', m.content, m.display));
      }
      body.append(viz);
    }

    // 产物：始终可见，不用展开
    if (arts.length) body.append(this.artifactsBar(arts));

    if (answer) body.append(el('div', { class: 'bubble md', html: MD.render(answer) }));
    if (answer) body.append(el('div', { class: 'msg-tools' },
      el('button', { class: 'btn sm ghost', html: Icons.copy(13) + '<span>复制</span>', onclick: () => copyText(answer) }),
      el('button', { class: 'btn sm ghost', html: Icons.speaker(13) + '<span>朗读</span>', onclick: () => TTS.speak(answer) }),
      el('button', { class: 'btn sm ghost', html: Icons.retry(13) + '<span>重试</span>', onclick: () => Agent.regenerate() })));
    return el('div', { class: 'msg agent' }, body);
  },

  /** 从一组消息里收集产物（文件类 display） */
  artifactsOf(group) {
    const out = [];
    for (const m of group) {
      const d = m.display;
      if (!d) continue;
      if (d.kind === 'file' && d.art) out.push(d.art);
      else if (d.kind === 'fileframe' && d.art) out.push(d.art);
      else if (d.kind === 'artifacts' && d.items) out.push(...d.items);
    }
    return out;
  },
  /** 文件型产物：显示为可下载卡片，不进折叠区 */
  isArtifactDisplay(d) {
    return d && ((d.kind === 'file' && d.art) || (d.kind === 'fileframe' && d.art) || d.kind === 'artifacts');
  },
  /** 可视输出：图表 / 流程图 / 图片 / 沙箱演示，应当直接可见（用户要看的成果，不是日志） */
  isVisualDisplay(d) {
    return d && ['chart', 'mermaid', 'images', 'frame', 'orgtree', 'orgdeliver', 'orgreview', 'orgmsg'].includes(d.kind);
  },
  /** 既不进折叠区、也不用放进产物条的输出 */
  isDirectDisplay(d) {
    return this.isArtifactDisplay(d) || this.isVisualDisplay(d);
  },

  /** 产物条：常显，可直接下载 */
  artifactsBar(arts) {
    const bar = el('div', { class: 'artifacts' });
    for (const a of arts) {
      bar.append(el('div', { class: 'artfile' },
        el('span', { class: 'artico', html: fileIcon(a.kind, 16) }),
        el('div', { class: 'artmeta' },
          el('span', { class: 'artname', text: a.name, title: a.name }),
          el('span', { class: 'artsize', text: fmtBytes(a.size) })),
        el('button', { class: 'artbtn', title: '下载', html: Icons.download(14), onclick: (e) => this.clickArtifactBtn(e, () => downloadArtifact(a)) }),
        a.mime === MIME.html ? el('button', { class: 'artbtn', title: '在新窗口打开', html: Icons.external(14), onclick: (e) => this.clickArtifactBtn(e, () => openArtifact(a)) }) : null));
    }
    return bar;
  },

  /** 一行摘要文案：「4 个工具调用 · 3.2 秒」 */
  stepsLabel(n, ms, failed) {
    const parts = [`${n} 个工具调用`];
    if (ms) parts.push(fmtMs(ms));
    if (failed) parts.push(`${failed} 个失败`);
    return parts.join(' · ');
  },

  stepNode({ name, args, state = 'running', ms, error }) {
    const rgTxt = { running: '执行中', ok: '成功', err: '失败', denied: '已拒绝' }[state] || state;
    return el('div', { class: 'step' },
      el('div', { class: 'hd' },
        el('span', { class: 'nm', text: name }),
        el('span', { class: 'rg ' + (state === 'running' ? 'running' : state === 'ok' ? 'ok' : 'err'), text: rgTxt + (ms ? ' · ' + fmtMs(ms) : '') }),
        el('span', { style: 'flex:1' }),
        el('button', { class: 'btn sm ghost', text: '参数', onclick: () => openModal({ title: '工具参数 · ' + name, bodyHTML: `<pre>${esc(JSON.stringify(args, null, 2))}</pre>`, hideCancel: true, okText: '关闭' }) })));
  },

  toolNode(m) {
    const node = el('div', { class: 'msg agent' }, el('div', { class: 'av', text: '⚙' }),
      el('div', { class: 'body' }, this.displayNode(m.display, m)));
    return node;
  },

  /* ---------------- 工具结果卡片（D7/K2/K3 等） ---------------- */
  displayNode(d, m) {
    if (!d) return el('div', { class: 'toolcard' }, el('div', { class: 'hd', text: (m && m.name) + ' 已执行' }));
    const kind = d.kind;
    if (kind === 'search') {
      const card = el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: '搜索 · ' + d.provider }), el('span', { class: 'badge', text: d.results.length + ' 条' }), el('span', { text: truncate(d.query, 50) })));
      const list = el('div', { class: 'sres' });
      d.results.forEach((r) => {
        list.append(el('div', { class: 'it' },
          el('h4', {}, el('a', { href: r.url, target: '_blank', rel: 'noopener', text: r.title })),
          el('div', { class: 'u', text: truncate(r.url, 90) }),
          el('div', { class: 'sn', text: r.snippet }),
          el('div', { class: 'meta' },
            r.date ? el('span', { text: '🕒 ' + r.date }) : null,
            r.score != null ? el('span', { text: '★ 相关度 ' + Number(r.score).toFixed(3) }) : null,
            r.authority != null ? el('span', { text: '🏛 权威度 ' + r.authority }) : null,
            el('button', { class: 'btn sm ghost', text: '抓全文', onclick: () => this.fetchIntoChat(r.url) }))));
      });
      card.append(list);
      if (d.errs && d.errs.length) card.append(el('div', { class: 'hint', text: '降级记录：' + d.errs.join(' | ') }));
      return card;
    }
    if (kind === 'fetch') {
      return el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: '抓取正文' }), el('span', { class: 'badge', text: d.chars + ' 字' }), el('a', { href: d.url, target: '_blank', rel: 'noopener', text: truncate(d.url, 60) })),
        el('div', { style: 'font-size:12px;color:var(--dim)', text: '通道：' + d.via + (d.title ? ' · ' + d.title : '') }));
    }
    if (kind === 'code') {
      return el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: '沙箱执行' }), el('span', { class: 'badge', text: d.error ? '报错' : '成功' })),
        el('pre', { style: 'margin:0 0 6px;background:#0a101c;border:1px solid var(--line);border-radius:8px;padding:8px;font-family:var(--mono);font-size:11.5px;overflow:auto;max-height:200px', text: truncate(d.code, 3000) }),
        d.error ? el('div', { style: 'color:var(--err);font-size:12.5px', text: d.error }) : el('pre', { style: 'margin:0;background:#0a101c;border:1px solid var(--line);border-radius:8px;padding:8px;font-family:var(--mono);font-size:11.5px;overflow:auto;max-height:220px', text: truncate(d.result, 4000) }));
    }
    if (kind === 'frame' || kind === 'fileframe') {
      const title = d.title || (d.art && d.art.name) || '沙箱预览';
      const card = el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: title }), el('span', { class: 'badge', text: 'sandbox' }), el('span', { style: 'flex:1' })));
      if (d.art) card.append(this.artifactNode(d.art));

      // 幻灯片 / 独立 HTML 文件：走 blob 预览
      if (d.previewUrl || d.art) {
        const holder = el('div', { class: 'frame' });
        card.append(holder);
        holder.append(el('div', { class: 'bar' }, el('span', { text: '预览（需联网加载 reveal.js）' })));
        const slot = el('div');
        holder.append(slot);
        setTimeout(async () => {
          let url = d.previewUrl;
          if (!url && d.art) {
            const blob = await resolveArtifactBlob(d.art);
            if (!blob) { slot.append(el('div', { class: 'hint', style: 'padding:16px', text: '预览不可用：内容已不在本地，请重新生成或下载。' })); return; }
            url = URL.createObjectURL(blob);
          }
          slot.append(el('iframe', { sandbox: 'allow-scripts allow-popups', src: url, style: 'height:420px' }));
        }, 0);
        return card;
      }

      /* 内联 HTML 沙箱
         策略：默认不自动执行（避免「重渲染就把所有页面重跑一遍」导致卡死/闪退），
         只有最新生成的那一个自动运行，其余给「运行」按钮让用户点。 */
      const html = String(d.html || '');
      // 只用唯一 id 做 key；没有 id 的历史数据才退回内容签名
      const key = d._uid || d._key || ('f:' + title + ':' + html.length + ':' + (d.height || 220));
      d._key = key;

      const holder = el('div', { class: 'frame' });
      const bar = el('div', { class: 'bar' }, el('span', { text: '沙箱内渲染 · 交互事件会回传给 Agent' }), el('span', { style: 'flex:1' }));
      const stage = el('div');
      holder.append(bar, stage);
      card.append(holder);

      const renderIdle = (msg) => {
        stage.innerHTML = '';
        stage.append(el('div', { class: 'sbxidle' },
          el('span', { text: msg || '预览未运行' }),
          el('button', { class: 'btn sm', text: '运行预览', onclick: () => run() })));
        bar.querySelectorAll('.barstop,.barrun').forEach((b) => b.remove());
        bar.append(el('button', { class: 'barrun', text: '运行', onclick: () => run() }));
      };

      const run = () => {
        // 已有活着的实例就复用（重渲染时不重启）
        let sbx = this._sbx.get(key);
        if (sbx) {
          stage.innerHTML = '';
          stage.append(sbx.iframe);
        } else {
          stage.innerHTML = '';
          sbx = Sandbox.renderHTML(stage, html, { height: d.height || 220, title });
          this._sbx.set(key, sbx);
          this._frames.set(key, sbx.iframe);
          // 缓存上限：超过就销毁最旧的，避免长会话堆积
          if (this._sbx.size > 8) {
            const k0 = this._sbx.keys().next().value;
            const old = this._sbx.get(k0);
            if (old) old.destroy();
            this._sbx.delete(k0); this._frames.delete(k0);
          }
        }
        bar.querySelectorAll('.barstop,.barrun').forEach((b) => b.remove());
        bar.append(el('button', { class: 'barstop', text: '停止', title: '掐断这个预览', onclick: () => {
          const s2 = this._sbx.get(key);
          if (s2) { s2.stop(); this._sbx.delete(key); this._frames.delete(key); }
          if (this._autoRunKey === key) this._autoRunKey = '';
          renderIdle('已停止');
        } }));
      };

      if (this._autoRunKey === key) run();
      else renderIdle();
      return card;
    }
    if (kind === 'chart') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: '图表' + (d.title ? ' · ' + d.title : '') }), el('span', { style: 'flex:1' }),
        el('button', { class: 'btn sm ghost', text: '导出 PNG', onclick: () => this.exportChart(card) })));
      const holder = el('div', { style: 'min-height:340px' }, el('div', { class: 'hint', style: 'padding:24px 0;text-align:center', text: '图表渲染中…（首次加载 ECharts 约 1MB）' }));
      card.append(holder);
      Charts.render(holder, d.option, { height: 340 })
        .then(() => { const h = holder.querySelector('.hint'); if (h) h.remove(); })
        .catch((e) => { holder.innerHTML = ''; holder.append(el('div', { style: 'color:var(--err);font-size:12.5px', text: '图表渲染失败：' + e.message })); });
      return card;
    }
    if (kind === 'mermaid') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: 'Mermaid 图' }), el('span', { style: 'flex:1' }),
        el('button', { class: 'btn sm ghost', text: '导出 SVG', onclick: () => { const svg = card.querySelector('svg'); if (svg) downloadBlob(new Blob([svg.outerHTML], { type: MIME.svg }), safeName(d.caption || 'diagram') + '.svg'); } })));
      const holder = el('div', { style: 'overflow:auto;background:var(--bg2);border-radius:8px;padding:8px' });
      if (d.svg) holder.innerHTML = d.svg;
      else holder.append(el('pre', { text: d.error || '' }));
      card.append(holder);
      return card;
    }
    if (kind === 'images') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: '生成图片' }), el('span', { class: 'badge', text: d.items.length + ' 张' }), el('span', { text: truncate(d.prompt, 40) })));
      const g = el('div', { class: 'imgrid' });
      d.items.forEach((it, i) => g.append(el('figure', {}, el('img', { src: it.url, alt: it.alt }),
        el('figcaption', {}, el('span', { text: '#' + (i + 1) }),
          el('button', { class: 'btn sm ghost', text: '下载', onclick: async () => { try { const b = await (await fetch(it.url)).blob(); downloadBlob(b, safeName('image-' + (i + 1)) + '.png'); } catch { toast('下载失败（可能是跨域限制），请右键另存', 'err'); } } })))));
      card.append(g);
      return card;
    }
    if (kind === 'kb') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: '知识库命中' }), el('span', { class: 'badge', text: (d.hits || []).length + ' 段' })));
      for (const h of d.hits || []) card.append(el('div', { style: 'margin:6px 0;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg2)' },
        el('div', { style: 'font-size:11.5px;color:var(--accent2)', text: `${h.docName} · 片段 #${h.idx} · score ${Number(h.score).toFixed(3)}` }),
        el('div', { style: 'font-size:12.5px;color:var(--muted)', text: truncate(h.text, 400) })));
      return card;
    }
    if (kind === 'artifacts') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: '已生成文件' })));
      for (const a of d.items) card.append(this.artifactNode(a));
      return card;
    }
    if (kind === 'memory') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' },
        el('b', { text: d.action === 'search' ? '长期记忆检索' : d.action === 'clear' ? '已清空记忆' : d.action === 'remove' ? '已删除记忆' : '已记住' }),
        d.total != null ? el('span', { class: 'badge', text: '共 ' + d.total + ' 条' }) : null));
      const items = d.item ? [d.item] : (d.hits || []);
      for (const it of items) card.append(el('div', { class: 'memrow' },
        el('span', { class: 'memdot' }),
        el('span', { class: 'memtxt', text: it.text }),
        d.action === 'search' ? null : el('button', {
          class: 'btn sm ghost', text: '删除',
          onclick: () => { Memory.remove(it.id); card.remove(); UI.updateMemoryBadge(); toast('已删除'); }
        })));
      if (!items.length) card.append(el('div', { class: 'hint', text: '没有匹配的记忆' }));
      return card;
    }
    if (kind === 'localfiles') {
      const card = el('div', { class: 'toolcard' }, el('div', { class: 'hd' }, el('b', { text: '本机文件' }), el('span', { class: 'badge', text: (d.list || []).length + ' 个' })));
      if (!(d.list || []).length) {
        card.append(el('div', { class: 'hint', text: '还没有授权文件。点输入框左侧的文件夹按钮选择（浏览器要求用户亲自选中，网页不能自行遍历磁盘）。' }));
      } else {
        for (const f of d.list) card.append(el('div', { class: 'memrow' },
          el('span', { class: 'fileico', html: Icons.file(14) }),
          el('span', { class: 'memtxt', text: f.name + ' · ' + fmtBytes(f.size) + (f.chars != null ? ' · ' + f.chars + ' 字' : ' · 二进制') })));
      }
      return card;
    }
    if (kind === 'localfileRead') {
      return el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: d.name }), el('span', { class: 'badge', text: `第 ${d.start}–${d.end} / ${d.total} 行` })),
        el('pre', { class: 'codeprev', text: d.preview || '' }));
    }
    if (kind === 'writeplan') {
      const card = el('div', { class: 'toolcard writeplan' },
        el('div', { class: 'hd' },
          el('b', { text: '待写入 · ' + d.name }),
          el('span', { class: 'badge add', text: '+' + d.diff.added }),
          el('span', { class: 'badge del', text: '-' + d.diff.removed }),
          el('span', { style: 'flex:1' }),
          el('span', { class: 'badge', text: d.mode === 'replace' ? '整文件覆盖' : '精确替换' })));
      const dv = el('div', { class: 'diff' });
      (d.diff.rows || []).forEach((r) => dv.append(el('div', { class: 'dl ' + (r.t === '+' ? 'add' : r.t === '-' ? 'del' : '') },
        el('span', { class: 'ln', text: r.n }), el('span', { class: 'sg', text: r.t === ' ' ? '' : r.t }), el('span', { class: 'tx', text: r.s }))));
      card.append(dv);
      const btn = el('button', { class: 'btn primary', text: '写入文件', onclick: async (e) => {
        const b = e.currentTarget;
        if (d.mode === 'replace' && State.settings.localConfirm !== false) {
          const ok = await confirmDialog('覆盖整个文件？', `<div>将用新内容<b>整体替换</b>「${esc(d.name)}」，原有内容不再保留。</div><div class="hint" style="margin-top:8px">可改用精确替换（patch）只改动的部分。</div>`, '确认覆盖');
          if (!ok) return;
        }
        b.disabled = true; b.textContent = '写入中…';
        try { const r = await LocalFiles.write(d.fileId, d.content); b.textContent = '已写入 ✓'; toast(`已写入 ${r.name}（${r.chars} 字符）`, 'ok'); }
        catch (err) { b.disabled = false; b.textContent = '写入文件'; toast('写入失败：' + err.message, 'err', 5600); }
      } });
      card.append(el('div', { class: 'acts' }, btn, el('span', { class: 'hint', text: '浏览器要求由用户点击才能落盘' })));
      return card;
    }
    if (kind === 'saveplan') {
      const card = el('div', { class: 'toolcard writeplan' },
        el('div', { class: 'hd' }, el('b', { text: '待另存 · ' + d.filename }), el('span', { class: 'badge', text: d.content.length + ' 字符' })));
      card.append(el('pre', { class: 'codeprev', text: truncate(d.content, 2000) }));
      card.append(el('div', { class: 'acts' },
        el('button', { class: 'btn primary', text: '选择位置并保存', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true; b.textContent = '保存中…';
          try { const r = await LocalFiles.saveAs(d.filename, d.content); b.textContent = '已保存 ✓'; toast(`已保存 ${r.name}`, 'ok'); }
          catch (err) { b.disabled = false; b.textContent = '选择位置并保存'; if (err.name !== 'AbortError') toast('保存失败：' + err.message, 'err', 5000); }
        } })));
      return card;
    }
    if (kind === 'delegate') {
      return el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: '子 Agent 结论' }), el('span', { class: 'badge', text: (d.trace || []).length + ' 步' })),
        el('div', { class: 'md', html: MD.render(d.answer || '') }),
        el('details', { style: 'margin-top:6px' }, el('summary', { style: 'font-size:12px;color:var(--dim)', text: '子 Agent 轨迹' }),
          el('pre', { style: 'font-size:11px;overflow:auto;max-height:200px', text: JSON.stringify(d.trace, null, 2) })));
    }
    if (kind === 'denied') {
      return el('div', { class: 'toolcard' }, el('div', { class: 'hd', text: '⚠ 已跳过工具 ' + d.name + '（用户拒绝）' }));
    }
    if (kind === 'orgtree') {
      const nodes = (State.org && State.org.nodes) ? State.org.nodes : [];
      const card = el('div', { class: 'toolcard' },
        el('div', { class: 'hd' }, el('b', { text: '组织结构' }),
          el('span', { class: 'badge', text: nodes.length + ' 人' }), el('span', { style: 'flex:1' }),
          el('button', { class: 'btn sm ghost', text: '打开面板', onclick: () => OrgUI.applyMode(true) })));
      for (const a of nodes) {
        const d = Org.depth(a.id);
        card.append(el('div', { class: 'memrow' },
          el('span', { class: 'orgindent', style: `width:${d * 14}px` }),
          el('span', { class: 'memdot', style: a.role === 'inspector' ? 'background:var(--warn)' : '' }),
          el('span', { class: 'memtxt', text: `${a.name}（${ORG_ROLES[a.role] ? ORG_ROLES[a.role].label : a.role}）` }),
          el('span', { class: 'badge', text: ({ idle: '待命', running: '执行中', done: '完成', blocked: '未通过', error: '出错' })[a.status] || a.status })));
      }
      return card;
    }
    return el('div', { class: 'toolcard' }, el('div', { class: 'hd', text: (m && m.name) || '工具结果' }));
  },

  /** 把工具结果作为材料交给团队（企业模式） */
  sendToolToOrg(name, text, display) {
    if (typeof OrgUI === 'undefined') return;
    // 优先用结构化展示内容（比模型看到的截断文本更完整、更好读）
    let body = '';
    if (display) {
      if (display.kind === 'search' && display.results) {
        body = `搜索「${display.query || ''}」（${display.provider || ''}）结果：\n\n` +
          display.results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet || ''}`).join('\n\n');
      } else if (display.kind === 'fetch') {
        body = `抓取 ${display.url || ''}\n\n${display.text || ''}`;
      } else if (display.kind === 'code') {
        body = `代码：\n${display.code || ''}\n\n结果：\n${display.result || display.error || ''}`;
      } else if (display.kind === 'kb' && display.hits) {
        body = display.hits.map((h, i) => `[${i + 1}] ${h.docName} #${h.idx}\n${h.text}`).join('\n\n');
      }
    }
    if (!body) body = String(text || '');
    if (!body && display) body = JSON.stringify(display).slice(0, 8000);
    OrgUI.attachText(`${name} 返回结果`, body, 'tool');
    if (!(State.org && State.org.enabled)) $('#modeChip').click();
    setTimeout(() => { const g = $('#orgGoal'); if (g) g.focus(); }, 200);
    toast('已作为材料附加，写清目标后点发送即可交给团队', 'ok', 3200);
  },

  /** 给任意工具卡片挂上「交给团队」入口 */
  withOrgAction(card, name, text, display) {
    if (!card || !card.classList || !card.classList.contains('toolcard')) return card;
    const hd = card.querySelector('.hd');
    if (!hd || hd.querySelector('.org-send')) return card;
    hd.append(el('span', { style: 'flex:1' }), el('button', {
      class: 'org-send', title: '把这份结果作为材料交给团队',
      html: (Icons.flow ? Icons.flow(12) : '') + '<span>交给团队</span>',
      onclick: (e) => { e.stopPropagation(); this.sendToolToOrg(name, text, display); }
    }));
    return card;
  },

  /** 产物按钮统一入口：点击时给视觉反馈，避免「点了没反应」 */
  async clickArtifactBtn(e, fn) {
    const btn = e && e.currentTarget;
    if (btn) { btn.classList.add('busy'); btn.disabled = true; }
    try { await fn(); }
    catch (err) { toast('操作失败：' + (err && err.message || err), 'err', 5000); }
    finally { if (btn) { btn.classList.remove('busy'); btn.disabled = false; } }
  },

  artifactNode(art) {
    return el('div', { class: 'attach', style: 'margin:4px 0' },
      el('span', { class: 'a', style: 'font-size:12.5px' },
        el('span', { class: 'artico', html: fileIcon(art.kind, 15) }),
        el('b', { text: art.name }),
        el('span', { style: 'color:var(--text-placeholder)', text: fmtBytes(art.size) })),
      el('button', { class: 'btn sm', html: Icons.download(13) + '<span>下载</span>', onclick: (e) => this.clickArtifactBtn(e, () => downloadArtifact(art)) }),
      art.mime === MIME.html ? el('button', { class: 'btn sm ghost', html: Icons.external(13) + '<span>新窗口打开</span>', onclick: (e) => this.clickArtifactBtn(e, () => openArtifact(art)) }) : null);
  },

  exportChart(card) {
    const cv = card.querySelector('canvas');
    if (!cv) return toast('没有可导出的画布', 'err');
    cv.toBlob((b) => downloadBlob(b, 'chart.png'));
  },

  async fetchIntoChat(url) {
    if (Agent.busy) return toast('正在执行中，稍后再试', 'err');
    Agent.enqueue('请抓取并总结这个页面：' + url, {});
  },

  bindSandboxBridge() {
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.source === 'aaim-sandbox' || d.__aaimFrame && d.type === 'event') this.sandboxEvent(d);
    });
  },
  /** 沙箱回传的交互事件
     关键：这是高频来源（动画/拖拽类页面每秒可达 60 次）。
     绝不能每条都（1）塞进会话消息（2）同步写 localStorage —— 那会 O(n²) 卡死并最终闪退。 */
  _evt: { map: new Map(), lastSave: 0, saveTimer: null },

  sandboxEvent(d) {
    if (!d || d.type !== 'event') return;
    const now = Date.now();
    const s = State.current();
    if (!Array.isArray(s.sandboxLog)) s.sandboxLog = [];

    const name = String(d.name || 'event').slice(0, 40);

    // 1) 同名事件在 600ms 窗口内合并：只保留一条，累加次数与最新 payload
    const st = this._evt.map.get(name) || { count: 0, lastAt: 0, firstToast: false };
    st.count++;
    const tooSoon = now - st.lastAt < 600;
    st.lastAt = now;
    this._evt.map.set(name, st);

    const open = s.sandboxLog.find((x) => x.name === name);
    if (open) {
      open.count = st.count;
      open.payload = d.payload;
      open.ts = now;
    } else {
      s.sandboxLog.push({ ts: now, name, payload: d.payload, count: st.count });
      // 2) 硬上限：只保留最近 40 条，绝不无界增长
      if (s.sandboxLog.length > 40) s.sandboxLog.shift();
    }

    // 3) 每种事件名只提示一次，且高频事件完全不提示（避免 toast 刷屏占满 DOM）
    if (!st.firstToast && !tooSoon) {
      st.firstToast = true;
      toast(`沙箱回传：${name}`, '', 2000);
    }

    // 4) 审计只记合并后的事件（否则每秒 60 条纯属浪费），并保留上限
    if (!tooSoon) {
      State.audit.push({ ts: now, tool: 'sandbox_event', args: { name, payload: d.payload }, ok: true, ms: 0, summary: name });
      if (State.audit.length > 500) State.audit.splice(0, State.audit.length - 500);
    }

    // 5) 延迟合并写盘，最多每 1.5 秒一次，杜绝每条都全量序列化
    if (!this._evt.saveTimer) {
      this._evt.saveTimer = setTimeout(() => {
        this._evt.saveTimer = null;
        try { State.saveSessions(); } catch { }
      }, 1500);
    }
  }

};
