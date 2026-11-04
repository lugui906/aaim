/* ============ 11 设置抽屉：骨架 + 表单组件 ============ */
const Form = {
  field(label, input, hint) {
    return el('div', { class: 'field' }, el('label', { text: label }), input, hint ? el('div', { class: 'hint', text: hint }) : null);
  },
  text(value, onchange, opts = {}) {
    const i = el('input', { type: 'text', value: value == null ? '' : value, placeholder: opts.ph || '', autocomplete: 'off', spellcheck: 'false' });
    i.addEventListener('change', () => onchange(i.value.trim()));
    return i;
  },
  pass(value, onchange, ph) {
    const wrap = el('div', { class: 'row' });
    const i = el('input', { type: 'password', value: value || '', placeholder: ph || 'sk-...', autocomplete: 'off' });
    const eye = el('button', { class: 'btn sm', text: '👁', title: '显示/隐藏' });
    eye.addEventListener('click', () => { i.type = i.type === 'password' ? 'text' : 'password'; });
    i.addEventListener('change', () => onchange(i.value.trim()));
    wrap.append(i, eye);
    return wrap;
  },
  num(value, onchange, { min, max, step } = {}) {
    const i = el('input', { type: 'number', value: value, min: min, max: max, step: step || 1 });
    i.addEventListener('change', () => { const v = Number(i.value); if (!isNaN(v)) onchange(v); });
    return i;
  },
  area(value, onchange, ph) {
    const t = el('textarea', { placeholder: ph || '' });
    t.value = value || '';
    t.addEventListener('change', () => onchange(t.value));
    return t;
  },
  select(options, value, onchange) {
    const s = el('select');
    for (const [v, label] of options) s.append(el('option', { value: v, text: label, selected: String(v) === String(value) }));
    s.addEventListener('change', () => onchange(s.value));
    return s;
  },
  toggle(label, desc, value, onchange) {
    const sw = el('div', { class: 'sw' + (value ? ' on' : '') });
    sw.addEventListener('click', () => {
      const on = !sw.classList.contains('on');
      sw.classList.toggle('on', on);
      onchange(on);
    });
    return el('div', { class: 'switch' }, el('div', { class: 'lbl', text: label }, desc ? el('small', { text: desc }) : null), sw);
  },
  sect(text) { return el('div', { class: 'sect', text }); },
  kv(k, v) { return el('div', { class: 'kv' }, el('span', { text: k }), el('b', { text: v })); }
};

const Drawer = {
  tab: 'model',
  TABS: [['model', '模型'], ['search', '搜索'], ['image', '图片'], ['kb', '知识库'], ['memory', '记忆'], ['local', '本机文件'], ['tools', '工具'], ['budget', '预算'], ['spec', '规格'], ['about', '关于']],

  init() {
    $('#drawerClose').addEventListener('click', () => this.close());
    // 知识库导入：File 选择后解析并入库（支持 Word / Excel / PPT / PDF / 文本）
    $('#kbFile').addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (!files.length) return;
      for (const f of files) {
        const t = toast(`解析 ${f.name}…`, '', 60000);
        try {
          let text = '';
          const ext = DocParser.ext(f.name);
          if (DocParser.isOffice(f.name) || ext === 'pdf') {
            const r = await DocParser.read(f, f.name);
            text = r.text || '';
          } else {
            text = await f.text();
          }
          if (!text.trim()) throw new Error('没有提取到文字内容');
          const doc = KB.addDoc(f.name, text);
          toast(`已入库 ${f.name}（${doc.chunks} 段 / ${text.length} 字）`, 'ok');
        } catch (err) {
          toast(`${f.name} 导入失败：${err.message}`, 'err', 7000);
        } finally { t.remove(); }
      }
      this.render();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('open')) this.close(); });
  },
  open(tab) {
    this.tab = tab || this.tab || 'model';
    $('#drawer').classList.add('open');
    this.render();
  },
  close() { $('#drawer').classList.remove('open'); },

  render() {
    const tabs = $('#drawerTabs');
    tabs.innerHTML = '';
    for (const [k, label] of this.TABS) {
      tabs.append(el('div', { class: 'tab' + (k === this.tab ? ' on' : ''), text: label, onclick: () => { this.tab = k; this.render(); } }));
    }
    const body = $('#drawerBody');
    body.innerHTML = '';
    const fn = { model: this.renderModel, search: this.renderSearch, image: this.renderImage, kb: this.renderKb, memory: this.renderMemory, local: this.renderLocal, tools: this.renderTools, budget: this.renderBudget, spec: this.renderSpec, about: this.renderAbout }[this.tab];
    if (fn) fn.call(this, body);
    body.scrollTop = 0;
  },

  save() { State.saveSettings(); UI.updateHeader(); },

  /* ---------------- 模型 ---------------- */
  renderModel(b) {
    const s = State.settings;
    b.append(Form.sect('提供商'));
    b.append(Form.field('当前提供商', Form.select(Object.entries(PROVIDERS).map(([k, p]) => [k, p.label]), s.provider, (v) => {
      s.provider = v; this.save(); App.setRunning(Agent.busy); this.render();
    }), PROVIDERS[s.provider].hint));

    const c = s.providers[s.provider] || (s.providers[s.provider] = { baseUrl: '', apiKey: '', model: '' });
    if (s.provider !== 'mock') {
      b.append(Form.field('Base URL', Form.text(c.baseUrl, (v) => { c.baseUrl = v; this.save(); }), '例如 ' + (PROVIDERS[s.provider].defaultBase || 'https://...') + '（不带末尾斜杠）'));
      b.append(Form.field('API Key', Form.pass(c.apiKey, (v) => { c.apiKey = v; this.save(); }), '仅存于本机 localStorage；单文件无法真正保密'));
    }
    const isOpenAI = PROVIDERS[s.provider].style === 'openai';
    b.append(Form.field(isOpenAI ? '模型名 / 接入点 ID' : '模型名', Form.text(c.model, (v) => { c.model = v; this.save(); }), '可填 ' + (PROVIDERS[s.provider].models || []).join(' / ')));
    const quick = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:-4px' });
    for (const m of PROVIDERS[s.provider].models || []) {
      quick.append(el('button', { class: 'btn sm', text: m, onclick: () => { c.model = m; this.save(); this.render(); } }));
    }
    b.append(quick);

    b.append(Form.sect('生成参数'));
    b.append(Form.field('温度 temperature', Form.num(s.temperature, (v) => { s.temperature = clamp(v, 0, 2); this.save(); }, { min: 0, max: 2, step: 0.1 }), '0 更确定，1 更发散'));
    b.append(Form.field('最大输出 token', Form.num(s.maxTokens, (v) => { s.maxTokens = clamp(v, 64, 32000); this.save(); }, { min: 64, max: 32000, step: 64 })));
    b.append(Form.field('最大步数（ReAct 循环上限）', Form.num(s.maxSteps, (v) => { s.maxSteps = clamp(v, 1, 24); this.save(); }, { min: 1, max: 24 }), '每步 = 一次模型推理 + 工具执行'));
    b.append(Form.field('上下文预算（token）', Form.num(s.contextLimit, (v) => { s.contextLimit = clamp(v, 2000, 200000); this.save(); }, { min: 2000, max: 200000, step: 1000 }), '超出则裁剪最早的对话回合'));
    b.append(Form.field('裁剪时保留最近条数', Form.num(s.keepRecent, (v) => { s.keepRecent = clamp(v, 2, 40); this.save(); }, { min: 2, max: 40 })));

    b.append(Form.sect('行为'));
    b.append(Form.toggle('流式输出', '逐字显示；关闭则等完整响应', s.stream, (v) => { s.stream = v; this.save(); }));
    b.append(Form.toggle('展示思考过程', '支持 reasoning_content 的模型会显示', s.showThinking, (v) => { s.showThinking = v; this.save(); }));
    b.append(Form.toggle('视觉（图片直发）', '把图片作为 vision 消息发送', s.vision, (v) => { s.vision = v; this.save(); }));
    b.append(Form.toggle('Enter 直接发送', 'Shift+Enter 换行；关闭后仅 Ctrl+Enter 发送', s.sendWithEnter, (v) => { s.sendWithEnter = v; this.save(); }));
    b.append(Form.toggle('工具调用前确认', '敏感工具（执行代码、生图）先弹窗确认', s.toolConfirm, (v) => { s.toolConfirm = v; this.save(); }));

    b.append(Form.sect('系统提示词'));
    b.append(Form.field('自定义指令（追加在内置提示之后）', Form.area(s.systemPrompt, (v) => { s.systemPrompt = v; this.save(); }), '例如：始终用表格回答；回答结尾给出三个延伸问题'));

    b.append(Form.sect('代理（绕 CORS）'));
    b.append(Form.field('代理地址', Form.text(s.proxy, (v) => { s.proxy = v; this.save(); }), '写 {url} 占位（推荐）或纯前缀。例：https://p.example.com/?url={url}。代理只做转发，不放业务逻辑。'));
  }
};
