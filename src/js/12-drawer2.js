/* ============ 12 设置抽屉：搜索 / 图片 / 知识库 / 工具 / 预算 / 规格 / 关于 ============ */
Object.assign(Drawer, {
  /* ---------------- 搜索 ---------------- */
  renderSearch(b) {
    const s = State.settings, c = s.search;
    b.append(Form.sect('搜索提供商'));
    b.append(Form.field('默认提供商', Form.select([
      ['deepseek', 'DeepSeek Search（/v1/tools/search）'],
      ['tavily', 'Tavily'], ['serper', 'Serper.dev'],
      ['custom', '自定义 HTTP 适配器'], ['none', '关闭搜索']
    ], c.provider, (v) => { c.provider = v; this.save(); this.render(); }), '失败会按 deepseek → tavily → serper → custom 顺序自动降级'));

    const health = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 8px' });
    for (const k of ['deepseek', 'tavily', 'serper']) {
      const h = State.searchHealth[k];
      health.append(el('span', { class: 'badge', text: k + '：' + (!h ? '未使用' : h.ok ? '正常 ' + h.ms + 'ms' : '失败') }));
    }
    b.append(health);

    b.append(Form.field('DeepSeek Key（留空则用模型里的 Key）', Form.pass(c.deepseekKey, (v) => { c.deepseekKey = v; this.save(); })));
    b.append(Form.field('Tavily Key', Form.pass(c.tavilyKey, (v) => { c.tavilyKey = v; this.save(); })));
    b.append(Form.field('Serper Key', Form.pass(c.serperKey, (v) => { c.serperKey = v; this.save(); })));

    b.append(Form.sect('参数面板'));
    b.append(Form.field('返回条数 count', Form.num(c.count, (v) => { c.count = clamp(v, 1, 20); this.save(); }, { min: 1, max: 20 })));
    b.append(Form.toggle('需要正文 need_content', '让接口直接返回正文，更慢但更准', c.needContent, (v) => { c.needContent = v; this.save(); }));
    b.append(Form.toggle('深读：抓取全文', '抓取时优先走 DeepSeek Fetch 转 Markdown', c.deepFetch, (v) => { c.deepFetch = v; this.save(); }));

    b.append(Form.sect('自定义适配器'));
    b.append(Form.field('接口 URL', Form.text(c.customUrl, (v) => { c.customUrl = v; this.save(); }), 'POST，需自行允许 CORS 或走代理'));
    b.append(Form.field('请求体模板', Form.area(c.customBody, (v) => { c.customBody = v; this.save(); }), '可用 {{query}} 与 {{count}} 占位，输出 JSON'));
    b.append(Form.field('结果数组路径', Form.text(c.customPath, (v) => { c.customPath = v; this.save(); }), '如 results / data.items'));
    b.append(el('div', { class: 'hint', text: '语法透传：site:example.com、lang:zh、"精确短语"、-排除词 会原样发给提供商，是否支持取决于它。' }));
  },

  /* ---------------- 图片 ---------------- */
  renderImage(b) {
    const s = State.settings, c = s.image;
    b.append(Form.sect('文生图提供商'));
    b.append(Form.field('提供商', Form.select([['openai', 'OpenAI gpt-image-1'], ['ark', '火山方舟 · 即梦 Seedream'], ['qwen', '通义万相（异步任务）']], c.provider, (v) => { c.provider = v; this.save(); this.render(); })));
    b.append(Form.field('尺寸 size', Form.text(c.size, (v) => { c.size = v; this.save(); }), '如 1024x1024 / 1792x1024 / 1024*1024（万相用 *）'));
    b.append(Form.field('质量 quality', Form.select([['standard', 'standard'], ['high', 'high']], c.quality, (v) => { c.quality = v; this.save(); })));
    b.append(Form.field('张数 n', Form.num(c.n, (v) => { c.n = clamp(v, 1, 4); this.save(); }, { min: 1, max: 4 })));
    if (c.provider === 'ark') {
      b.append(Form.field('方舟 Base URL', Form.text(c.arkBase, (v) => { c.arkBase = v; this.save(); })));
      b.append(Form.field('模型 / 接入点', Form.text(c.arkModel, (v) => { c.arkModel = v; this.save(); })));
      b.append(Form.field('方舟 Key（留空复用模型配置）', Form.pass(c.arkKey, (v) => { c.arkKey = v; this.save(); })));
    }
    if (c.provider === 'qwen') {
      b.append(Form.field('百炼 Base URL', Form.text(c.qwenBase, (v) => { c.qwenBase = v; this.save(); })));
      b.append(Form.field('模型名', Form.text(c.qwenModel, (v) => { c.qwenModel = v; this.save(); })));
      b.append(Form.field('百炼 Key（留空复用模型配置）', Form.pass(c.qwenKey, (v) => { c.qwenKey = v; this.save(); })));
    }
    b.append(el('div', { class: 'hint', text: '生图调用默认需要确认弹窗（可在「模型 → 工具调用前确认」关闭）。跨域被拦时填代理地址。' }));
  },

  /* ---------------- 知识库 ---------------- */
  renderKb(b) {
    const kb = State.kb, c = State.settings.kb;
    b.append(Form.sect('本地知识库'));
    b.append(el('div', { class: 'hint', text: `文档 ${kb.docs.length} 个 · 分块 ${kb.chunks.length} 段。内容仅保存在本机浏览器。` }));
    const addBtn = el('button', { class: 'btn block primary', text: '导入文档（Word / Excel / PPT / PDF / TXT）', style: 'margin:8px 0' });
    addBtn.addEventListener('click', () => $('#kbFile').click());
    b.append(addBtn);
    b.append(el('div', { class: 'hint', text: '支持 .docx / .xlsx / .pptx / .pdf / .txt / .md / .csv / .json。旧版 .doc/.ppt/.wps 请先另存为新格式。' }));

    b.append(Form.field('向量化提供商（可选）', Form.select([['none', '只用关键词 BM25'], ['openai', 'OpenAI embeddings'], ['qwen', '千问 text-embedding-v3'], ['custom', '自定义接口']], c.embedProvider, (v) => { c.embedProvider = v; this.save(); this.render(); }), '开启后 indexEmbeddings 会为每一块生成向量，检索时与 BM25 融合'));
    if (c.embedProvider !== 'none') {
      b.append(Form.field('嵌入模型', Form.text(c.embedModel, (v) => { c.embedModel = v; this.save(); })));
      b.append(Form.field(c.embedProvider === 'custom' ? '接口 URL' : 'Key（留空复用对应模型 Key）', c.embedProvider === 'custom' ? Form.text(c.embedKey, (v) => { c.embedKey = v; this.save(); }) : Form.pass(c.embedKey, (v) => { c.embedKey = v; this.save(); })));
      b.append(el('button', {
        class: 'btn block', text: '为现有分块生成向量', onclick: async (e) => {
          const btn = e.target; btn.disabled = true; btn.textContent = '向量化中…';
          try { const n = await KB.indexEmbeddings((p) => { btn.textContent = '向量化 ' + Math.round(p * 100) + '%'; }); toast('完成，已向量化 ' + n + ' 段', 'ok'); }
          catch (err) { toast(err.message, 'err'); }
          btn.disabled = false; btn.textContent = '为现有分块生成向量';
        }
      }));
    }
    b.append(Form.field('检索条数 top_k', Form.num(c.topK, (v) => { c.topK = clamp(v, 1, 12); this.save(); }, { min: 1, max: 12 })));

    if (kb.docs.length) {
      b.append(Form.sect('已导入'));
      for (const d of kb.docs) {
        b.append(el('div', { style: 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line)' },
          el('span', { style: 'flex:1;font-size:12.5px', text: truncate(d.name, 34) }),
          el('span', { class: 'badge', text: d.chunks + ' 段' }),
          el('button', { class: 'btn sm danger', text: '删除', onclick: () => { KB.removeDoc(d.id); this.render(); } })));
      }
      b.append(el('button', { class: 'btn block danger', text: '清空知识库', style: 'margin-top:10px', onclick: () => { KB.clear(); this.render(); toast('已清空', 'ok'); } }));
    }
  },

  /* ---------------- 工具 ---------------- */
  renderTools(b) {
    b.append(Form.sect('已注册工具'));
    const list = Tools.list();
    b.append(el('div', { class: 'hint', text: `共 ${list.length} 个，启用 ${Tools.active().length} 个。禁用的工具不会出现在模型的工具列表里。` }));
    for (const t of list) {
      b.append(Form.toggle(t.name + (t.sensitive ? ' 🔐' : ''), truncate(t.desc.split('\n')[0], 46), t.enabled !== false, (v) => {
        t.enabled = v;
        const p = State.plugins.find((x) => x.name === t.name); if (p) p.enabled = v;
        Store.set('plugins', State.plugins);
      }));
    }
    b.append(Form.sect('插件式工具（L6）'));
    b.append(el('div', { class: 'hint', text: '只需声明 name / desc / params（JSON Schema）与一段 JS 代码体；运行时在沙箱里执行，可用参数 args。' }));
    const add = el('button', { class: 'btn block primary', text: '＋ 添加插件工具', style: 'margin:8px 0' });
    add.addEventListener('click', () => this.pluginEditor());
    b.append(add);
    if (State.plugins.length) {
      for (const p of State.plugins) {
        b.append(el('div', { style: 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px dashed var(--line)' },
          el('span', { style: 'flex:1;font-size:12.5px', text: p.name }),
          el('button', { class: 'btn sm', text: '编辑', onclick: () => this.pluginEditor(p) }),
          el('button', { class: 'btn sm danger', text: '删除', onclick: () => {
            State.plugins = State.plugins.filter((x) => x !== p); Store.set('plugins', State.plugins);
            Tools.reg.delete(p.name); this.render();
          } })));
      }
    }
    b.append(Form.sect('审计'));
    b.append(Form.kv('本次运行工具调用', State.audit.length + ' 次'));
    b.append(el('button', { class: 'btn block', text: '导出审计 JSON', style: 'margin-top:6px', onclick: () => App.exportAudit() }));
  },

  pluginEditor(p) {
    const tpl = {
      name: p ? p.name : 'my_tool',
      desc: p ? p.desc : '一句话说明这个工具做什么、什么时候用',
      params: p ? p.params : { type: 'object', properties: { text: { type: 'string', description: '输入文本' } }, required: ['text'] },
      code: p ? p.code : 'return { length: String(args.text || "").length, upper: String(args.text || "").toUpperCase() };'
    };
    openModal({
      title: p ? '编辑插件工具' : '添加插件工具', okText: '保存并注册',
      bodyHTML: `<div class="field"><label>工具名（英文，唯一）</label><input type="text" id="plName" value="${esc(tpl.name)}"></div>
        <div class="field"><label>描述（模型据此决定何时调用）</label><input type="text" id="plDesc" value="${esc(tpl.desc)}"></div>
        <div class="field"><label>参数 Schema（JSON）</label><textarea id="plParams" style="min-height:120px">${esc(JSON.stringify(tpl.params, null, 2))}</textarea></div>
        <div class="field"><label>代码体（JS，可用 args，用 return 返回）</label><textarea id="plCode" style="min-height:110px">${esc(tpl.code)}</textarea></div>`,
      onOk: (body) => {
        const name = body.querySelector('#plName').value.trim();
        const desc = body.querySelector('#plDesc').value.trim();
        const params = safeJSON(body.querySelector('#plParams').value, null);
        const code = body.querySelector('#plCode').value;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return toast('工具名必须是英文标识符', 'err'), false;
        if (!desc) return toast('描述不能为空', 'err'), false;
        if (!params) return toast('参数 Schema 不是合法 JSON', 'err'), false;
        const obj = { name, desc, params, code, enabled: true, sensitive: true };
        State.plugins = State.plugins.filter((x) => x.name !== name).concat([obj]);
        Store.set('plugins', State.plugins);
        Tools.register({
          name, desc, params, category: 'plugin', sensitive: true,
          async run(args) {
            const r = await Sandbox.runJS(`var args = ${JSON.stringify(args || {})};\n${code}`, { timeout: 8000 });
            if (!r.ok) return { ok: false, summary: '插件执行失败：' + r.error };
            const res = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
            return { ok: true, summary: `插件 ${name} 返回：\n${truncate(res, 3000)}`, display: { kind: 'code', code, result: res, logs: r.logs } };
          }
        });
        toast('已注册工具 ' + name, 'ok');
        this.render();
      }
    });
  },

  /* ---------------- 预算 ---------------- */
  renderBudget(b) {
    const s = State.settings.budget, u = State.usage;
    const sp = Agent.spendOf();
    b.append(Form.sect('本会话用量'));
    b.append(Form.kv('输入 token', u.inTok.toLocaleString()));
    b.append(Form.kv('输出 token', u.outTok.toLocaleString()));
    b.append(Form.kv('模型调用次数', u.calls));
    b.append(Form.kv('工具调用次数', u.toolCalls));
    b.append(Form.kv('估算费用', '¥' + u.cost.toFixed(4)));
    b.append(Form.kv('护栏已计', sp.tok.toLocaleString() + ' tok / ¥' + sp.cost.toFixed(3)));
    b.append(el('div', { class: 'row', style: 'margin:8px 0 4px' },
      el('button', { class: 'btn sm', text: '清零本会话预算统计', onclick: () => { Agent.resetBudget(); this.render(); toast('已清零', 'ok'); } }),
      el('span', { style: 'flex:1' })));

    b.append(Form.sect('护栏（L3）'));
    b.append(Form.toggle('关闭 token / 费用上限', '关掉后只保留「每轮工具调用次数」防死循环；适合本地模型或不在乎花费时', !!s.unlimited, (v) => { s.unlimited = v; this.save(); this.render(); }));
    b.append(el('div', { class: 'hint', style: 'margin-bottom:6px' }, 'token 与费用按**每个会话**累计，新建会话自动归零；工具次数按**每一轮**计，避免单轮死循环。'));
    b.append(Form.field('token 上限', Form.num(s.maxTokens, (v) => { s.maxTokens = Math.max(1000, v); this.save(); }, { min: 1000, step: 1000 }), '输入+输出合计，超出即中止本轮'));
    b.append(Form.field('费用上限（元）', Form.num(s.maxCost, (v) => { s.maxCost = Math.max(0, v); this.save(); }, { min: 0, step: 0.1 })));
    b.append(Form.field('工具调用上限（次）', Form.num(s.maxToolCalls, (v) => { s.maxToolCalls = Math.max(1, v); this.save(); }, { min: 1 })));
    b.append(Form.field('输入单价（元 / 百万 token）', Form.num(s.priceIn, (v) => { s.priceIn = Math.max(0, v); this.save(); }, { min: 0, step: 0.1 }), '用于估算费用，按你实际套餐填'));
    b.append(Form.field('输出单价（元 / 百万 token）', Form.num(s.priceOut, (v) => { s.priceOut = Math.max(0, v); this.save(); }, { min: 0, step: 0.1 })));
    b.append(el('button', { class: 'btn block', text: '重置本轮统计', style: 'margin-top:10px', onclick: () => {
      State.usage = { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0, startedAt: 0 };
      State.audit = []; UI.updateHeader(); this.render(); toast('已重置', 'ok');
    } }));

    b.append(Form.sect('语音'));
    b.append(Form.toggle('回复自动朗读', '用浏览器 SpeechSynthesis 播报', State.settings.tts.enabled, (v) => { State.settings.tts.enabled = v; this.save(); }));
    b.append(Form.field('语速', Form.num(State.settings.tts.rate, (v) => { State.settings.tts.rate = clamp(v, 0.5, 2); this.save(); }, { min: 0.5, max: 2, step: 0.1 })));
    const voices = TTS.load();
    if (voices.length) {
      b.append(Form.field('音色', Form.select([['', '自动（优先中文）']].concat(voices.map((v) => [v.name, v.name + ' · ' + v.lang])), State.settings.tts.voice, (v) => { State.settings.tts.voice = v; this.save(); })));
    }
  },

  /* ---------------- 规格对照 ---------------- */
  /* ---------------- 长期记忆 ---------------- */
  renderMemory(b) {
    const list = Memory.list();
    b.append(Form.sect('长期记忆'));
    b.append(el('div', { class: 'hint', text: '跨会话保留的事实与偏好。当前对话的每一轮都会把这里的摘要注入系统提示，Agent 也可以自己用 remember 工具写入。' }));

    const input = el('textarea', { placeholder: '例：我在做 TSAI-OS，代码风格偏好 TypeScript；回答尽量短。', rows: '3' });
    input.style.minHeight = '70px';
    const addBtn = el('button', { class: 'btn primary sm', text: '添加', onclick: () => {
      const t = input.value.trim();
      if (!t) return toast('内容为空', 'err');
      Memory.add(t, 'user'); input.value = '';
      this.render(); UI.updateMemoryBadge(); toast('已记住', 'ok');
    } });
    b.append(el('div', { class: 'field' }, input, el('div', { class: 'row', style: 'margin-top:8px' }, addBtn,
      el('button', { class: 'btn sm', text: '导入文本', onclick: () => this.importMemory() }),
      el('span', { style: 'flex:1' }),
      el('button', { class: 'btn sm danger', text: '全部清空', onclick: () => {
        if (!Memory.count()) return toast('已经是空的');
        openModal({ title: '清空长期记忆', bodyHTML: `<div>将删除全部 ${Memory.count()} 条记忆，不可撤销。</div>`, okText: '清空', okClass: 'danger',
          onOk: () => { Memory.clear(); this.render(); UI.updateMemoryBadge(); } });
      } }))));

    b.append(Form.sect(`已有 ${list.length} 条`));
    if (!list.length) {
      b.append(el('div', { class: 'hint', text: '还没有记忆。可以直接在上面加一条，或等 Agent 在对话里自动记住。' }));
    }
    for (const m of list) {
      const txt = el('div', { class: 'memtxt', text: m.text });
      const node = el('div', { class: 'memrow' }, el('span', { class: 'memdot' }), txt,
        el('button', { class: 'btn sm ghost', text: '编辑', onclick: () => {
          const ta = el('textarea', { rows: '3' });
          ta.value = m.text; ta.style.minHeight = '80px';
          openModal({ title: '编辑记忆', bodyHTML: '', okText: '保存', onOk: () => { Memory.update(m.id, ta.value.trim()); this.render(); toast('已保存', 'ok'); } }).body.append(ta);
        } }),
        el('button', { class: 'btn sm ghost', text: '删除', onclick: () => { Memory.remove(m.id); this.render(); UI.updateMemoryBadge(); } }));
      node.title = fmtTime(m.ts) + ' · ' + (m.source === 'agent' ? 'Agent 写入' : '手动添加');
      b.append(node);
    }
  },

  importMemory() {
    openModal({
      title: '批量导入记忆', okText: '导入',
      bodyHTML: '<div class="hint" style="margin-bottom:8px">每行一条，空行忽略。</div>',
      onOk: (body) => {
        const t = body.querySelector('textarea').value;
        let n = 0;
        t.split('\n').map((x) => x.trim()).filter(Boolean).forEach((line) => { if (Memory.add(line.replace(/^[-*•]\s*/, ''), 'user')) n++; });
        this.render(); UI.updateMemoryBadge(); toast(`已导入 ${n} 条`, 'ok');
      }
    }).body.append(el('textarea', { rows: '8', placeholder: '我在做 TSAI-OS\n偏好中文回答\n代码风格 TypeScript' }));
  },

  /* ---------------- 本机文件 ---------------- */
  renderLocal(b) {
    b.append(Form.sect('本机文件读写'));
    const ok = LocalFiles.supported();
    b.append(el('div', { class: 'hint', text: ok
      ? '基于 File System Access API：你点一次「选择文件」授权后，Agent 就能读取并修改它。写入必须由你点击确认，网页无法自行遍历磁盘。'
      : '当前浏览器不支持（需 Chrome / Edge 86+）。可以改用输入框的 ＋ 按钮上传附件做只读解析。' }));

    b.append(el('div', { class: 'row', style: 'margin:12px 0' },
      el('button', { class: 'btn primary sm', text: '📂 选择本机文件', onclick: async () => {
        try { const recs = await LocalFiles.openPicker({ multiple: true }); toast(`已授权 ${recs.length} 个文件`, 'ok'); this.render(); }
        catch (e) { if (e.name !== 'AbortError') toast('打开失败：' + e.message, 'err', 5000); }
      } }),
      el('button', { class: 'btn sm', text: '新建文件…', onclick: async () => {
        try { const r = await LocalFiles.saveAs('untitled.md', ''); toast('已创建 ' + r.name, 'ok'); this.render(); }
        catch (e) { if (e.name !== 'AbortError') toast('创建失败：' + e.message, 'err', 5000); }
      } })));

    const list = LocalFiles.list();
    b.append(Form.sect(`已授权 ${list.length} 个`));
    if (!list.length) b.append(el('div', { class: 'hint', text: '还没有授权任何文件。' }));
    for (const f of list) {
      b.append(el('div', { class: 'memrow' },
        el('span', { class: 'fileico', text: '📄' }),
        el('span', { class: 'memtxt', text: `${f.name} · ${fmtBytes(f.size)}${f.chars != null ? ' · ' + f.chars + ' 字' : ' · 二进制'}${f.active ? ' · 最近' : ''}` }),
        el('button', { class: 'btn sm ghost', text: '预览', onclick: async () => {
          const rec = LocalFiles.find(f.id);
          openModal({ title: f.name, hideCancel: true, okText: '关闭', bodyHTML: `<pre>${esc(truncate(rec && rec.text || '(二进制或无法读取)', 8000))}</pre>` });
        } }),
        el('button', { class: 'btn sm ghost', text: '让 Agent 读', onclick: () => {
          $('#prompt').value = `读一下本机文件 ${f.name}，说明它的作用，并指出可能值得改进的地方。`;
          autoGrow($('#prompt')); Drawer.close(); $('#prompt').focus();
        } })));
    }

    b.append(Form.sect('行为开关'));
    b.append(Form.toggle('写文件前弹窗确认', '覆盖已有内容时二次确认（推荐开启）', State.settings.localConfirm !== false, (v) => { State.settings.localConfirm = v; this.save(); }));
    b.append(Form.toggle('允许 Agent 整文件覆盖', '关闭后只允许 patch 精确替换，避免误删内容', State.settings.localAllowReplace !== false, (v) => { State.settings.localAllowReplace = v; this.save(); }));
  },

  renderSpec(b) {
    const done = SPEC.filter((x) => x[2] === 'done').length;
    const part = SPEC.filter((x) => x[2] === 'part').length;
    const no = SPEC.filter((x) => x[2] === 'no').length;
    b.append(el('div', { class: 'hint', style: 'margin-bottom:8px' },
      el('span', { text: `已实现 ${done} 项 · 部分实现 ${part} 项 · 未实现 ${no} 项（共 ${SPEC.length} 项）` })));
    for (const g of SPEC_GROUPS) {
      const rows = SPEC.filter((x) => x[0][0] === g);
      if (!rows.length) continue;
      b.append(Form.sect(g + ' · ' + SPEC_TITLE[g]));
      const tb = el('table', { class: 'spec' });
      for (const [id, name, st, note] of rows) {
        const stTxt = { done: '已实现', part: '部分', no: '未做' }[st] || st;
        tb.append(el('tr', {},
          el('td', { text: id }),
          el('td', {},
            el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' },
              el('b', { style: 'color:var(--text);font-weight:600;font-size:12.5px', text: name }),
              el('span', { class: 'st ' + st, text: stTxt })),
            el('div', { style: 'font-size:11.5px;color:var(--muted);margin-top:2px', text: note }))));
      }
      b.append(tb);
    }
  },

  /* ---------------- 关于 ---------------- */
  renderAbout(b) {
    b.append(Form.sect('关于'));
    b.append(el('div', { style: 'font-size:13px;line-height:1.9;color:var(--muted)' },
      el('div', { html: `<b style="color:var(--text)">${APP.name}</b> v${APP.version} · 单文件 HTML AI Agent` }),
      el('div', { text: '一个 .html 里装下：LLM 多提供商接入、ReAct 工具循环、联网搜索、文档生成、图表、沙箱演示、本地知识库。' }),
      el('div', { text: '所有数据（会话、设置、知识库）只存在本机浏览器；不经过任何第三方服务器，除非你配置了模型/搜索接口。' })));
    b.append(Form.sect('快捷键'));
    const keys = [['Ctrl / ⌘ + Enter', '发送消息'], ['Enter', '发送（可在设置关闭）'], ['Shift + Enter', '换行'], ['Esc', '停止生成 / 关闭面板'], ['Ctrl / ⌘ + K', '聚焦输入框'], ['Ctrl / ⌘ + Shift + N', '新建会话']];
    for (const [k, d] of keys) b.append(el('div', { class: 'kv', style: 'align-items:center' }, el('span', { class: 'kbd', text: k }), el('span', { text: d })));

    b.append(Form.sect('数据'));
    b.append(el('div', { style: 'display:flex;flex-direction:column;gap:8px' },
      el('button', { class: 'btn block', text: '导出设置（不含 Key）', onclick: () => App.exportSettings() }),
      el('button', { class: 'btn block', text: '导入设置', onclick: () => $('#importFile').click() }),
      el('button', { class: 'btn block danger', text: '清空全部 API Key', onclick: () => {
        for (const p of Object.values(State.settings.providers)) p.apiKey = '';
        const c = State.settings.search; c.deepseekKey = c.tavilyKey = c.serperKey = '';
        State.settings.image.arkKey = ''; State.settings.image.qwenKey = '';
        this.save(); this.render(); toast('已清空所有 Key', 'ok');
      } }),
      el('button', { class: 'btn block danger', text: '清除全部本地数据（会话+设置+知识库）', onclick: () => {
        openModal({ title: '确认清除', bodyHTML: '<div>将删除所有会话、设置与知识库，不可恢复。建议先导出。</div>', okText: '全部删除', okClass: 'danger', onOk: () => { localStorage.clear(); location.reload(); } });
      } }),
      el('button', { class: 'btn block', text: '重载页面', onclick: () => location.reload() })));
    b.append(el('div', { class: 'hint', style: 'margin-top:12px', text: '安全提示：单文件页面无法隐藏 API Key（O7）。请只在自己的电脑上用，不要把带 Key 的页面分享出去；共用电脑用完请清空。' }));
  }
});
