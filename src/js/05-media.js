/* ============ 05 图表 / Mermaid / 图片生成 / 幻灯片 / 本地知识库 ============ */
/* 图表主题：与页面一致（品牌蓝系 + 中性网格） */
const ChartTheme = {
  isDark() { return document.documentElement.dataset.theme === 'dark'; },
  palette() {
    return this.isDark()
      ? ['#6799fe', '#8fb6ff', '#a78bfa', '#5eead4', '#fbbf24', '#f472b6', '#94a3b8']
      : ['#4d6bfe', '#7c9cff', '#8b5cf6', '#0d9488', '#d97706', '#db2777', '#64748b'];
  },
  base() {
    const dark = this.isDark();
    const axisLine = dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.1)';
    const splitLine = dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.055)';
    const label = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.55)';
    const strong = dark ? '#ededed' : '#1e232c';
    return {
      color: this.palette(),
      backgroundColor: 'transparent',
      textStyle: { fontFamily: getComputedStyle(document.body).fontFamily, color: label, fontSize: 12 },
      title: { textStyle: { color: strong, fontSize: 13, fontWeight: 600 }, left: 0, top: 0 },
      legend: { textStyle: { color: label, fontSize: 11.5 }, itemWidth: 10, itemHeight: 10, itemGap: 14, icon: 'roundRect', bottom: 0 },
      grid: { left: 8, right: 16, top: 34, bottom: 34, containLabel: true },
      tooltip: {
        backgroundColor: dark ? '#2b2b2b' : '#ffffff',
        borderColor: dark ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: strong, fontSize: 12.5 },
        extraCssText: 'border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.12);',
        axisPointer: { type: 'line', lineStyle: { color: axisLine } }
      },
      categoryAxis: {
        axisLine: { lineStyle: { color: axisLine } },
        axisTick: { show: false },
        axisLabel: { color: label, fontSize: 11.5 },
        splitLine: { show: false }
      },
      valueAxis: {
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: label, fontSize: 11.5 },
        splitLine: { lineStyle: { color: splitLine, type: 'dashed' } }
      },
      line: { symbol: 'circle', symbolSize: 5, smooth: true, lineStyle: { width: 2.2 } },
      bar: { barMaxWidth: 26, itemStyle: { borderRadius: [4, 4, 0, 0] } }
    };
  }
};

/* 深合并（数组整体替换） */
function deepMerge(base, over) {
  if (Array.isArray(over)) return over;
  if (!over || typeof over !== 'object') return over === undefined ? base : over;
  const out = Object.assign({}, base);
  for (const [k, v] of Object.entries(over)) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

/** 给 xAxis/yAxis/series 补上主题默认样式 */
function themeSeries(option) {
  const b = ChartTheme.base();
  const fixAxis = (ax, def) => (Array.isArray(ax) ? ax.map((a) => deepMerge(def, a)) : (ax ? deepMerge(def, ax) : ax));
  if (option.xAxis) option.xAxis = fixAxis(option.xAxis, b.categoryAxis);
  if (option.yAxis) option.yAxis = fixAxis(option.yAxis, b.valueAxis);
  if (Array.isArray(option.series)) {
    option.series = option.series.map((s) => {
      const def = s.type === 'bar' ? b.bar : s.type === 'line' ? b.line : {};
      return deepMerge(def, s);
    });
  }
  return option;
}

const Charts = {
  instances: [],
  /** 在容器里用 ECharts 渲染 option，返回实例 */
  async render(container, option, { height = 340, theme } = {}) {
    await CDN.load('echarts');
    const E = window.echarts;
    const t = theme !== undefined ? theme : (ChartTheme.isDark() ? 'dark' : null);
    const div = el('div', { style: `height:${height}px;width:100%` });
    container.append(div);
    // 若容器尚未挂到文档（消息重渲染时常见），等下一帧再初始化，避免 0 尺寸
    if (!container.isConnected) await new Promise((r) => requestAnimationFrame(() => r()));
    const inst = E.init(div, t, { renderer: 'canvas' });
    inst.setOption(themeSeries(deepMerge(ChartTheme.base(), option || {})), true);
    this.instances.push(inst);
    const ro = new ResizeObserver(() => { try { inst.resize(); } catch { } });
    ro.observe(div);
    return { inst, div, destroy() { ro.disconnect(); inst.dispose(); div.remove(); } };
  }
};

const Mermaid = {
  ready: false,
  async init(theme = 'dark') {
    await CDN.load('mermaid');
    const m = window.mermaid;
    if (!m) throw new Error('Mermaid 未加载');
    m.initialize({ startOnLoad: false, securityLevel: 'loose', theme: theme === 'light' ? 'default' : 'dark', fontFamily: 'inherit' });
    this.ready = true;
    return m;
  },
  async render(code, theme = 'dark') {
    await CDN.load('mermaid');
    if (!this.ready) await this.init(theme);
    const m = window.mermaid;
    if (!m || !m.render) throw new Error('Mermaid 未就绪');
    const id = 'mmd' + Math.random().toString(36).slice(2, 9);
    const out = await m.render(id, String(code));
    const el2 = document.getElementById(id);
    if (el2 && el2.parentNode && el2.dataset && el2.dataset.processed) el2.remove();
    return (out && out.svg) || '';
  }
};

Tools.register({
  name: 'render_chart', category: 'viz',
  desc: '用 ECharts 渲染图表（折线/柱状/饼图等），用户可直接看到并导出 PNG。请传标准 ECharts option；也可用简化形式：type/categories/series。',
  params: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      type: { type: 'string', description: 'line | bar | pie | scatter | radar' },
      categories: { type: 'array', items: { type: 'string' }, description: 'X 轴类目' },
      series: { type: 'array', description: '[{name, data:[...]}]', items: { type: 'object', properties: { name: { type: 'string' }, data: { type: 'array', items: {} }, type: { type: 'string' } } } },
      option: { type: 'object', description: '完整 ECharts option（优先于简化字段）' }
    },
    required: []
  },
  async run(args) {
    let option = args.option;
    if (!option) {
      const type = args.type || 'bar';
      const cats = args.categories || [];
      const series = (args.series || []).map((s) => ({ type: s.type || type, name: s.name || '', data: s.data || [] }));
      if (!series.length) throw new Error('需要 series 或 option');
      option = {
        title: args.title ? { text: args.title, left: 'center', textStyle: { fontSize: 14 } } : undefined,
        tooltip: { trigger: type === 'pie' ? 'item' : 'axis' },
        legend: { bottom: 0 },
        grid: { left: 48, right: 24, top: 48, bottom: 44 },
        xAxis: type === 'pie' ? undefined : { type: 'category', data: cats },
        yAxis: type === 'pie' ? undefined : { type: 'value' },
        series: type === 'pie'
          ? [{ type: 'pie', radius: ['38%', '66%'], data: (series[0] ? series[0].data : []).map((v, i) => ({ value: v, name: cats[i] || '项' + (i + 1) })) }]
          : series
      };
    }
    return { ok: true, summary: `已渲染图表${args.title ? '「' + args.title + '」' : ''}`, display: { kind: 'chart', option, title: args.title || '' } };
  }
});

Tools.register({
  name: 'render_mermaid', category: 'viz',
  desc: '渲染 Mermaid 流程图 / 时序图 / 思维导图（graph TD、sequenceDiagram、mindmap 等），输出可下载 SVG。只传 Mermaid 文本，不要包 ``` 代码块。',
  params: { type: 'object', properties: { code: { type: 'string', description: 'Mermaid 源文本' }, caption: { type: 'string' } }, required: ['code'] },
  async run(args) {
    const code = String(args.code || '').trim().replace(/^```(?:mermaid)?\s*/i, '').replace(/```$/, '');
    if (!code) throw new Error('code 为空');
    let svg;
    const th = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    try { svg = await Mermaid.render(code, th); }
    catch (e) { return { ok: false, summary: 'Mermaid 语法错误：' + (e.message || e), display: { kind: 'mermaid', code, error: String(e.message || e) } }; }
    return { ok: true, summary: `已渲染 Mermaid 图${args.caption ? '（' + args.caption + '）' : ''}`, display: { kind: 'mermaid', svg, code, caption: args.caption || '' } };
  }
});

Tools.register({
  name: 'generate_image', category: 'media', sensitive: true,
  desc: '文生图。按设置里的提供商调用（OpenAI gpt-image-1 / 火山方舟即梦 / 通义万相），返回图片并展示。',
  params: { type: 'object', properties: { prompt: { type: 'string', description: '画面描述，越具体越好' }, size: { type: 'string', description: '如 1024x1024 / 1792x1024' }, n: { type: 'integer', description: '张数，默认 1' } }, required: ['prompt'] },
  async run(args) {
    const cfg = State.settings.image;
    const prompt = String(args.prompt || '').trim();
    if (!prompt) throw new Error('prompt 为空');
    const size = args.size || cfg.size;
    const n = clamp(Number(args.n) || cfg.n || 1, 1, 4);
    let urls = [];
    if (cfg.provider === 'openai') {
      const c = State.settings.providers.openai;
      if (!c.apiKey) throw new Error('未配置 OpenAI Key');
      const r = await fetch(applyProxy((c.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/images/generations'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.apiKey },
        body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n, quality: cfg.quality })
      });
      if (!r.ok) throw new Error('OpenAI 图片 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      urls = (j.data || []).map((d) => d.b64_json ? 'data:image/png;base64,' + d.b64_json : d.url);
    } else if (cfg.provider === 'ark') {
      const key = (cfg.arkKey || State.settings.providers.ark.apiKey || '').trim();
      if (!key) throw new Error('未配置方舟 Key');
      const r = await fetch(applyProxy(cfg.arkBase.replace(/\/+$/, '') + '/images/generations'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: cfg.arkModel, prompt, size, response_format: 'url' })
      });
      if (!r.ok) throw new Error('方舟图片 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      urls = (j.data || []).map((d) => d.url || (d.b64_json ? 'data:image/png;base64,' + d.b64_json : '')).filter(Boolean);
    } else if (cfg.provider === 'qwen') {
      const key = (cfg.qwenKey || State.settings.providers.qwen.apiKey || '').trim();
      if (!key) throw new Error('未配置百炼 Key');
      const base = cfg.qwenBase.replace(/\/+$/, '');
      const r = await fetch(applyProxy(base + '/services/aigc/text2image/image-synthesis'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'X-DashScope-Async': 'enable' },
        body: JSON.stringify({ model: cfg.qwenModel, input: { prompt }, parameters: { size: size.replace('x', '*'), n } })
      });
      if (!r.ok) throw new Error('万相 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      const taskId = j.output && j.output.task_id;
      if (!taskId) throw new Error('未取得 task_id：' + JSON.stringify(j).slice(0, 200));
      for (let i = 0; i < 40; i++) {
        await sleep(1500);
        const q = await fetch(applyProxy(base + '/tasks/' + taskId), { headers: { Authorization: 'Bearer ' + key } });
        const jq = await q.json();
        const st = jq.output && jq.output.task_status;
        if (st === 'SUCCEEDED') { urls = ((jq.output.results || []).map((x) => x.url)).filter(Boolean); break; }
        if (st === 'FAILED') throw new Error('万相任务失败：' + JSON.stringify(jq.output).slice(0, 200));
      }
      if (!urls.length) throw new Error('万相任务超时未返回图片');
    } else throw new Error('未知图片提供商');

    if (!urls.length) throw new Error('接口未返回图片');
    const items = urls.map((u, i) => ({ url: u, alt: `${truncate(prompt, 40)} #${i + 1}` }));
    return { ok: true, summary: `已生成 ${items.length} 张图片（提供商：${cfg.provider}，尺寸 ${size}）`, data: { count: items.length, prompt }, display: { kind: 'images', items, prompt } };
  }
});

Tools.register({
  name: 'create_slides', category: 'viz',
  desc: '生成 reveal.js 风格的网页幻灯片（可翻页演示），支持在线预览 + 导出独立 HTML。适合课堂/汇报演示。',
  params: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      slides: {
        type: 'array', items: {
          type: 'object', properties: {
            title: { type: 'string' }, bullets: { type: 'array', items: { type: 'string' } }, note: { type: 'string' }, html: { type: 'string' }
          }
        }
      }
    },
    required: ['slides']
  },
  async run(args) {
    const slides = args.slides || [];
    if (!slides.length) throw new Error('slides 为空');
    const body = slides.map((s) => `<section><h2>${esc(s.title || '')}</h2>${s.bullets && s.bullets.length ? '<ul>' + s.bullets.map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>' : ''}${s.html || ''}${s.note ? `<aside class="notes">${esc(s.note)}</aside>` : ''}</section>`).join('\n');
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(args.title || '幻灯片')}</title>
<style>body{margin:0;font-family:-apple-system,"Microsoft YaHei",sans-serif}section{background:#162A4A;color:#e7eef9}h2{color:#fff}li{color:#d8e2f0;font-size:.85em;line-height:1.6}.reveal h2{font-size:1.4em}</style></head><body>
<div class="reveal"><div class="slides">${body}</div></div>
<script src="https://unpkg.com/reveal.js@4.6.1/dist/reveal.js"><\/script>
<script>if(window.Reveal)Reveal.initialize({hash:true,transition:'slide'});<\/script></body></html>`;
    const blob = new Blob([html], { type: MIME.html });
    let name = safeName(args.title || '幻灯片', 'slides');
    if (!/\.html?$/i.test(name)) name += '.html';
    const art = addArtifact({ name, mime: MIME.html, size: blob.size, blob, kind: 'reveal' });
    return { ok: true, summary: `已生成 ${slides.length} 页网页幻灯片《${name}》`, data: { filename: name, pages: slides.length }, display: { kind: 'fileframe', art, html: '' , previewUrl: URL.createObjectURL(blob) } };
  }
});

/* ---------------- 本地知识库（G5/G6/G7） ---------------- */
const KB = {
  docs() { return State.kb.docs; },
  chunkText(text, size = 480, overlap = 80) {
    const clean = String(text).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const paras = clean.split(/\n\n+/);
    const chunks = [];
    let buf = '';
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > size && buf) {
        chunks.push(buf.trim());
        buf = buf.slice(Math.max(0, buf.length - overlap)) + '\n\n' + p;
      } else buf = buf ? buf + '\n\n' + p : p;
    }
    if (buf.trim()) chunks.push(buf.trim());
    return chunks.filter((c) => c.length > 20).slice(0, 400);
  },
  addDoc(name, text) {
    const docId = uid('doc');
    const chunks = this.chunkText(text);
    const doc = { id: docId, name, chars: String(text).length, chunks: chunks.length, ts: Date.now(), text: String(text).slice(0, 20000) };
    State.kb.docs.unshift(doc);
    chunks.forEach((t, i) => State.kb.chunks.push({ id: uid('ch'), docId, docName: name, idx: i, text: t, vec: null }));
    State.kb.chunks = State.kb.chunks.slice(-3000);
    Store.set('kb', State.kb);
    return doc;
  },
  removeDoc(docId) {
    State.kb.docs = State.kb.docs.filter((d) => d.id !== docId);
    State.kb.chunks = State.kb.chunks.filter((c) => c.docId !== docId);
    Store.set('kb', State.kb);
  },
  clear() { State.kb = { docs: [], chunks: [] }; Store.set('kb', State.kb); },
  tokenize(s) {
    const t = String(s).toLowerCase();
    const words = (t.match(/[a-z0-9_]+/g) || []);
    const cjk = (t.match(/[\u4e00-\u9fff]/g) || []);
    const bi = [];
    for (let i = 0; i < cjk.length - 1; i++) bi.push(cjk[i] + cjk[i + 1]);
    return words.concat(cjk, bi);
  },
  async search(query, topK = 5) {
    const chunks = State.kb.chunks;
    if (!chunks.length) return [];
    const qTerms = this.tokenize(query);
    if (!qTerms.length) return [];
    const df = new Map();
    const chunkTf = chunks.map((c) => {
      const toks = this.tokenize(c.text);
      const tf = new Map();
      for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
      for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
      return tf;
    });
    const N = chunks.length, avgdl = chunks.reduce((a, c) => a + c.text.length, 0) / N;
    const k1 = 1.4, b = 0.72;
    const scored = chunks.map((c, i) => {
      const tf = chunkTf[i];
      let s = 0;
      for (const q of qTerms) {
        const f = tf.get(q) || 0; if (!f) continue;
        const n = df.get(q) || 1;
        const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
        s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (c.text.length / avgdl)));
      }
      return { ...c, score: s };
    }).filter((x) => x.score > 0).sort((a, b2) => b2.score - a.score);
    let hits = scored.slice(0, topK);
    // 可选向量检索融合（G6）
    if (State.settings.kb.embedProvider !== 'none' && State.kb.chunks.some((c) => c.vec)) {
      try {
        const qv = await this.embed([query]);
        if (qv && qv[0]) {
          const cos = (a, bv) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * bv[i]; na += a[i] * a[i]; nb += bv[i] * bv[i]; } return d / (Math.sqrt(na) * Math.sqrt(nb) || 1); };
          const vecHits = State.kb.chunks.filter((c) => c.vec).map((c) => ({ ...c, score: cos(qv[0], c.vec) * 3 })).sort((a, b2) => b2.score - a.score).slice(0, topK);
          const seen = new Set(hits.map((h) => h.id));
          for (const v of vecHits) if (!seen.has(v.id)) hits.push(v);
          hits = hits.slice(0, topK);
        }
      } catch { }
    }
    return hits;
  },
  async embed(texts) {
    const cfg = State.settings.kb;
    if (cfg.embedProvider === 'none') return null;
    let url, key, model = cfg.embedModel;
    if (cfg.embedProvider === 'openai') { url = (State.settings.providers.openai.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/embeddings'; key = cfg.embedKey || State.settings.providers.openai.apiKey; }
    else if (cfg.embedProvider === 'qwen') { url = 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings'; key = cfg.embedKey || State.settings.providers.qwen.apiKey; if (!cfg.embedKey) model = 'text-embedding-v3'; }
    else if (cfg.embedProvider === 'custom') { url = applyProxy(cfg.embedKey ? cfg.embedKey : ''); key = ''; }
    if (!url) throw new Error('嵌入接口未配置');
    const r = await fetch(applyProxy(url), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify({ model, input: texts }) });
    if (!r.ok) throw new Error('嵌入 HTTP ' + r.status);
    const j = await r.json();
    return (j.data || []).map((d) => d.embedding);
  },
  async indexEmbeddings(onProgress) {
    const cfg = State.settings;
    const todo = State.kb.chunks.filter((c) => !c.vec);
    const batch = 16;
    for (let i = 0; i < todo.length; i += batch) {
      const part = todo.slice(i, i + batch);
      try {
        const vs = await this.embed(part.map((p) => p.text));
        if (!vs) throw new Error('无返回');
        part.forEach((p, k) => { p.vec = vs[k]; });
        onProgress && onProgress(Math.min(1, (i + batch) / todo.length));
      } catch (e) { throw new Error('向量化失败：' + e.message); }
      await sleep(120);
    }
    Store.set('kb', State.kb);
    return State.kb.chunks.filter((c) => c.vec).length;
  }
};
