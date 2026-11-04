/* ============ 03 工具注册表 + 搜索 / 抓取 / 沙箱 ============ */
const Artifacts = [];   // 生成的文件/图表等，供 UI 下载
function addArtifact(a) {
  a.id = uid('art');
  Artifacts.unshift(a);
  if (Artifacts.length > 60) Artifacts.pop();
  // 关键：把字节存进 IndexedDB，否则刷新后会话里的 blob 会被 JSON 擦成空对象，下载就成空文件
  if (typeof ArtifactStore !== 'undefined' && a.blob instanceof Blob) {
    ArtifactStore.put(a).catch(() => {});
  }
  return a;
}

const Tools = {
  reg: new Map(),
  register(def) {
    if (!def.name || typeof def.run !== 'function') throw new Error('工具定义不合法: ' + (def && def.name));
    this.reg.set(def.name, Object.assign({ enabled: true, sensitive: false, category: 'general' }, def));
    return this.reg.get(def.name);
  },
  list() { return Array.from(this.reg.values()); },
  get(name) { return this.reg.get(name); },
  active() { return this.list().filter((t) => t.enabled !== false); },
  schemas() {
    return this.active().map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.desc, parameters: t.params || { type: 'object', properties: {} } }
    }));
  },
  /** 执行工具：统一返回 {ok, summary, display, data, raw} */
  async exec(name, args, ctx = {}) {
    const t = this.reg.get(name);
    const t0 = performance.now();
    if (!t) return { ok: false, summary: `未找到工具 ${name}`, error: 'unknown_tool' };
    if (t.enabled === false) return { ok: false, summary: `工具 ${name} 已被禁用`, error: 'disabled' };
    let out;
    try {
      out = await t.run(args || {}, ctx);
      if (out == null) out = { ok: true, summary: '完成' };
      if (typeof out === 'string') out = { ok: true, summary: out };
      if (out.ok === undefined) out.ok = true;
    } catch (e) {
      out = { ok: false, summary: (e && e.message) || String(e), error: 'exception' };
    }
    out.ms = Math.round(performance.now() - t0);
    State.usage.toolCalls++;
    State.audit.push({ ts: Date.now(), tool: name, args, ok: out.ok, ms: out.ms, summary: truncate(out.summary, 200) });
    return out;
  },
  /** 给模型看的文本（截断） */
  toToolText(out, limit = 7000) {
    let s;
    if (out.data !== undefined) s = typeof out.data === 'string' ? out.data : JSON.stringify(out.data);
    else s = out.summary || '';
    const head = out.ok ? '' : 'ERROR: ';
    s = head + (out.summary && out.ok ? out.summary + '\n\n' : '') + s;
    return s.length > limit ? s.slice(0, limit) + `\n...（已截断，原始长度 ${s.length} 字符）` : s;
  }
};

/* ---------------- 搜索适配器（D1/D3/D4/D10） ---------------- */
const SearchAdapters = {
  async deepseek(query, opt) {
    const conf = State.settings.providers.deepseek;
    const key = (State.settings.search.deepseekKey || '').trim() || (conf.apiKey || '').trim();
    if (!key) throw new Error('缺少 DeepSeek Key（搜索或模型设置里填）');
    const base = (conf.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
    const url = applyProxy(base + '/tools/search');
    const body = { query, count: opt.count || 8 };
    if (opt.need_content) body.need_content = true;
    if (opt.ori_question) body.ori_question = opt.ori_question;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('DeepSeek 搜索 HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const arr = j.results || j.data || j.items || (j.data && j.data.results) || [];
    return arr.map((x) => ({
      title: x.title || x.name || x.url || '(无标题)',
      url: x.url || x.link || '',
      snippet: x.content || x.snippet || x.summary || x.description || '',
      date: x.date || x.publish_time || x.published || '',
      score: x.rerank_score != null ? x.rerank_score : (x.score != null ? x.score : undefined),
      authority: x.authority != null ? x.authority : undefined,
      site: x.site_name || x.authority || ''
    }));
  },
  async tavily(query, opt) {
    const key = (State.settings.search.tavilyKey || '').trim();
    if (!key) throw new Error('缺少 Tavily Key');
    const r = await fetch(applyProxy('https://api.tavily.com/search'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: opt.count || 8, include_raw_content: !!opt.need_content, search_depth: opt.need_content ? 'advanced' : 'basic' })
    });
    if (!r.ok) throw new Error('Tavily HTTP ' + r.status);
    const j = await r.json();
    return (j.results || []).map((x) => ({ title: x.title, url: x.url, snippet: x.content || '', date: x.published_date || '', score: x.score, raw: x.raw_content }));
  },
  async serper(query, opt) {
    const key = (State.settings.search.serperKey || '').trim();
    if (!key) throw new Error('缺少 Serper Key');
    const r = await fetch(applyProxy('https://google.serper.dev/search'), {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: query, num: opt.count || 8, gl: 'cn', hl: 'zh-cn' })
    });
    if (!r.ok) throw new Error('Serper HTTP ' + r.status);
    const j = await r.json();
    return (j.organic || []).map((x) => ({ title: x.title, url: x.link, snippet: x.snippet || '', date: x.date || '', score: x.position }));
  },
  async custom(query, opt) {
    const c = State.settings.search;
    if (!c.customUrl) throw new Error('未配置自定义搜索 URL');
    const body = safeJSON((c.customBody || '{"query":"{{query}}","count":{{count}}}').replace(/\{\{query\}\}/g, JSON.stringify(query)).replace(/\{\{count\}\}/g, opt.count || 8), { query, count: opt.count });
    const r = await fetch(applyProxy(c.customUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('自定义搜索 HTTP ' + r.status);
    const j = await r.json();
    let arr = j;
    for (const seg of (c.customPath || 'results').split('.')) arr = arr && arr[seg];
    if (!Array.isArray(arr)) arr = j.results || j.data || j.items || [];
    return arr.map((x) => ({ title: x.title || x.name || x.url, url: x.url || x.link, snippet: x.snippet || x.content || x.description || '', date: x.date || '', score: x.score }));
  }
};

async function runSearch(query, opt = {}) {
  const order = [];
  const pref = opt.provider || State.settings.search.provider || 'deepseek';
  if (pref === 'none') throw new Error('搜索已禁用（设置 → 搜索 → 提供商 = 关闭）');
  order.push(pref);
  for (const k of ['deepseek', 'tavily', 'serper', 'custom']) if (!order.includes(k)) order.push(k);
  const errs = [];
  for (const name of order) {
    const ad = SearchAdapters[name];
    if (!ad) continue;
    if (name === 'deepseek' && !((State.settings.search.deepseekKey || State.settings.providers.deepseek.apiKey || '').trim())) { errs.push('deepseek: 无 Key'); continue; }
    if (name === 'tavily' && !State.settings.search.tavilyKey) { errs.push('tavily: 无 Key'); continue; }
    if (name === 'serper' && !State.settings.search.serperKey) { errs.push('serper: 无 Key'); continue; }
    if (name === 'custom' && !State.settings.search.customUrl) { errs.push('custom: 未配置'); continue; }
    try {
      const t0 = performance.now();
      const results = await ad(query, { count: opt.count || State.settings.search.count, need_content: opt.need_content, ori_question: opt.ori_question });
      State.searchHealth[name] = { ok: true, ts: Date.now(), ms: Math.round(performance.now() - t0) };
      if (!results.length) { errs.push(name + ': 0 条结果'); continue; }
      return { provider: name, results, fallback: errs.length > 0, errs };
    } catch (e) {
      State.searchHealth[name] = { ok: false, ts: Date.now(), err: e.message };
      errs.push(name + ': ' + e.message);
    }
  }
  throw new Error('所有搜索适配器都失败 → ' + errs.join(' | '));
}

/* ---------------- 抓取正文（D2/D8） ---------------- */
async function fetchReadable(url, { maxChars = 12000 } = {}) {
  // 1) DeepSeek fetch（返回 Markdown）
  const dsk = (State.settings.search.deepseekKey || State.settings.providers.deepseek.apiKey || '').trim();
  if (dsk && State.settings.search.deepFetch) {
    try {
      const base = (State.settings.providers.deepseek.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
      const r = await fetch(applyProxy(base + '/tools/fetch'), {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + dsk }, body: JSON.stringify({ url })
      });
      if (r.ok) {
        const j = await r.json();
        const md = j.content || j.markdown || j.text || (j.data && j.data.content) || '';
        if (md) return { via: 'deepseek', title: j.title || '', text: md.slice(0, maxChars), truncated: md.length > maxChars };
      }
    } catch { }
  }
  // 2) 直连 / 代理 抓 HTML 并提取正文
  const r = await fetch(applyProxy(url), { headers: { 'Accept': 'text/html,application/xhtml+xml,text/plain' } });
  if (!r.ok) throw new Error('抓取失败 HTTP ' + r.status + '（跨域被拦时请在设置里配置代理）');
  const ct = r.headers.get('content-type') || '';
  const raw = await r.text();
  if (!/html/.test(ct)) return { via: 'direct', title: '', text: raw.slice(0, maxChars), truncated: raw.length > maxChars };
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,svg,header,footer,nav,aside,form').forEach((n) => n.remove());
  const title = (doc.querySelector('title') || {}).textContent || '';
  const main = doc.querySelector('article,main,[role=main],#content,.content,.article,.post') || doc.body;
  let text = '';
  const blocks = main.querySelectorAll('h1,h2,h3,h4,p,li,pre,blockquote,td');
  if (blocks.length > 3) {
    blocks.forEach((b) => {
      const t = (b.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      const tag = b.tagName.toLowerCase();
      if (tag.startsWith('h')) text += '\n\n' + '#'.repeat(Number(tag[1])) + ' ' + t + '\n';
      else if (tag === 'li') text += '- ' + t + '\n';
      else text += t + '\n';
    });
  } else text = (main.textContent || '').replace(/\n{3,}/g, '\n\n');
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { via: 'direct', title, text: text.slice(0, maxChars), truncated: text.length > maxChars };
}

/* ---------------- 沙箱（B2/K1/K3） ---------------- */
const Sandbox = {
  counter: 0,
  /** 在 sandbox="allow-scripts" 的 iframe 中执行 JS，返回结构化结果 */
  runJS(code, { timeout = 5000 } = {}) {
    return new Promise((resolve) => {
      const id = 'sbx' + (++this.counter);
      const safe = String(code).replace(/<\/script/gi, '<\\/script');
      const srcdoc = `<!doctype html><meta charset="utf-8"><script>
window.__out=(function(){var sent=false;function send(p){if(sent)return;sent=true;parent.postMessage(Object.assign({__aaimSandbox:${JSON.stringify(id)}},p),'*');}
window.addEventListener('error',function(e){send({type:'error',message:String(e.message)})});
var logs=[];
var _log=console.log;console.log=function(){logs.push(Array.prototype.map.call(arguments,function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' '));if(logs.length>100)logs.shift();_log.apply(console,arguments)};
setTimeout(function(){try{
  var __code = document.getElementById('code').textContent;
  var fn = new Function(__code);
  var r = fn();
  if (r && typeof r.then==='function'){ r.then(function(v){send({type:'ok',result:v,logs:logs})},function(e){send({type:'error',message:String(e&&e.message||e)})}); }
  else send({type:'ok',result:r,logs:logs});
}catch(e){send({type:'error',message:String(e&&e.stack||e)})}},30);
window.addEventListener('message',function(){});
})();
<\/script><script type="text/plain" id="code">${safe}<\/script>`;
      const iframe = el('iframe', { sandbox: 'allow-scripts', style: 'display:none;width:0;height:0;border:0', srcdoc, title: 'sandbox' });
      let done = false;
      const finish = (r) => { if (done) return; done = true; window.removeEventListener('message', onMsg); iframe.remove(); resolve(r); };
      const onMsg = (e) => {
        const d = e.data;
        if (!d || d.__aaimSandbox !== id) return;
        if (d.type === 'ok') finish({ ok: true, result: d.result, logs: d.logs || [] });
        else finish({ ok: false, error: d.message });
      };
      window.addEventListener('message', onMsg);
      document.body.append(iframe);
      setTimeout(() => finish({ ok: false, error: '沙箱执行超时（' + timeout + 'ms）' }), timeout);
    });
  },

  /** 渲染任意 HTML 到可见沙箱 iframe（可选中交互），并桥接 postMessage 事件回传 */
  renderHTML(container, html, { height = 380, title = '沙箱预览', allowEventBack = true } = {}) {
    const bridge = `<script>
(function(){var send=function(o){parent.postMessage(Object.assign({__aaimFrame:true},o),'*')};
send({type:'ready'});
window.addEventListener('error',function(e){send({type:'error',message:String(e.message)})});
document.addEventListener('click',function(e){var t=e.target;send({type:'event',name:'click',payload:{tag:t&&t.tagName,id:t&&t.id,text:(t&&t.innerText||'').slice(0,120)}})},true);
})();
<\/script>`;
    const body = String(html);
    const inject = /<\/body>/i.test(body) ? body.replace(/<\/body>/i, bridge + '</body>') : body + bridge;
    const iframe = el('iframe', { sandbox: 'allow-scripts', srcdoc: inject, style: `height:${height}px`, title });
    container.append(iframe);
    const onMsg = (e) => {
      const d = e.data;
      if (!d || !d.__aaimFrame) return;
      if (d.type === 'event' && allowEventBack) {
        if (d.name === 'click') return; // 只转发显式 postMessage 事件，避免噪音
      }
      UI.sandboxEvent(d);
    };
    window.addEventListener('message', onMsg);
    return { iframe, destroy() { window.removeEventListener('message', onMsg); iframe.remove(); } };
  }
};

/* ---------------- 内置工具：搜索 / 抓取 / JS / 知识库 ---------------- */
Tools.register({
  name: 'web_search', category: 'search', sensitive: false,
  desc: '联网搜索。返回标题、URL、摘要、发布时间、相关性评分。需要事实/最新信息时先调用它。支持 site: lang: 等语法（取决于提供商）。',
  params: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '查询词，可含 site:xxx lang:zh 精确短语 "..." -排除词' },
      count: { type: 'integer', description: '返回条数，默认 8，最大 20' },
      need_content: { type: 'boolean', description: '是否同时抓取正文（更慢更耗额度）' }
    },
    required: ['query']
  },
  async run(args) {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const r = await runSearch(query, { count: clamp(Number(args.count) || State.settings.search.count, 1, 20), need_content: args.need_content != null ? !!args.need_content : State.settings.search.needContent });
    const results = r.results.slice(0, 20).map((x, i) => ({
      n: i + 1, title: x.title, url: x.url, snippet: (x.snippet || '').slice(0, 1200), date: x.date, score: x.score, authority: x.authority
    }));
    return {
      ok: true,
      summary: `通过 ${r.provider} 搜索「${query}」，得到 ${results.length} 条结果${r.fallback ? '（已自动降级切换提供商）' : ''}`,
      data: results,
      display: { kind: 'search', provider: r.provider, query, results, errs: r.errs }
    };
  }
});

Tools.register({
  name: 'web_fetch', category: 'search',
  desc: '抓取指定 URL 的正文并转成简洁 Markdown（适合深度阅读单页）。搜索后对关键链接二次抓取时使用。',
  params: { type: 'object', properties: { url: { type: 'string', description: '完整 http(s) URL' }, max_chars: { type: 'integer', description: '最大字符数，默认 12000' } }, required: ['url'] },
  async run(args) {
    const url = String(args.url || '').trim();
    if (!/^https?:\/\//i.test(url)) throw new Error('URL 必须以 http(s):// 开头');
    const r = await fetchReadable(url, { maxChars: clamp(Number(args.max_chars) || 12000, 1000, 40000) });
    return {
      ok: true,
      summary: `已抓取 ${url}（通道：${r.via}${r.title ? '，标题：' + r.title : ''}${r.truncated ? '，已截断' : ''}）`,
      data: r.text,
      display: { kind: 'fetch', url, via: r.via, title: r.title, chars: r.text.length }
    };
  }
});

Tools.register({
  name: 'run_js', category: 'code', sensitive: true,
  desc: '在浏览器沙箱（iframe sandbox=allow-scripts，无 same-origin）里执行一段 JavaScript 并返回结果。可用于精确计算、数据变换、正则处理。代码用 return 返回结果，可用 console.log。',
  params: { type: 'object', properties: { code: { type: 'string', description: 'JS 代码体，可写 return {...}' }, timeout_ms: { type: 'integer', description: '超时毫秒，默认 5000' } }, required: ['code'] },
  async run(args) {
    const r = await Sandbox.runJS(args.code, { timeout: clamp(Number(args.timeout_ms) || 5000, 500, 15000) });
    if (!r.ok) return { ok: false, summary: '沙箱执行报错：' + r.error, display: { kind: 'code', code: args.code, error: r.error } };
    const resStr = typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2);
    return {
      ok: true,
      summary: '沙箱执行成功，返回值：\n' + truncate(resStr, 3000) + (r.logs.length ? '\n\nconsole.log：\n' + r.logs.join('\n') : ''),
      data: r.result,
      display: { kind: 'code', code: args.code, result: resStr, logs: r.logs }
    };
  }
});

Tools.register({
  name: 'render_html', category: 'ui',
  desc: '把一段自包含 HTML（可含 <script>、canvas、CSS）渲染到页面内的可见沙箱中，形成可交互演示/小工具。沙箱内可用 parent.postMessage({source:"aaim-sandbox",type:"event",name,payload},"*") 把交互结果回传给 Agent。',
  params: { type: 'object', properties: { html: { type: 'string', description: '完整 HTML 片段或整页' }, title: { type: 'string' }, height: { type: 'integer', description: '预览高度 px，默认 380' } }, required: ['html'] },
  async run(args) {
    const html = String(args.html || '');
    if (!html.trim()) throw new Error('html 为空');
    return {
      ok: true,
      summary: `已在沙箱中渲染「${truncate(args.title || '交互演示', 40)}」（${html.length} 字符）`,
      display: { kind: 'frame', html, title: args.title || '交互演示', height: clamp(Number(args.height) || 380, 120, 900) }
    };
  }
});

Tools.register({
  name: 'kb_search', category: 'knowledge',
  desc: '在本地知识库（用户导入的文档）中检索相关片段，返回命中段落与来源。回答与文档有关的问题时应优先使用。',
  params: { type: 'object', properties: { query: { type: 'string' }, top_k: { type: 'integer', description: '返回片段数，默认 5' } }, required: ['query'] },
  async run(args) {
    const hits = await KB.search(String(args.query || ''), clamp(Number(args.top_k) || State.settings.kb.topK, 1, 12));
    if (!hits.length) return { ok: true, summary: '知识库中没有命中片段（可能尚未导入文档，或关键词不匹配）', data: [], display: { kind: 'kb', hits: [] } };
    return {
      ok: true,
      summary: `命中 ${hits.length} 个片段：\n` + hits.map((h, i) => `[${i + 1}] ${h.docName} #${h.idx}（score ${h.score.toFixed(3)}）\n${truncate(h.text, 500)}`).join('\n\n'),
      data: hits.map((h) => ({ doc: h.docName, idx: h.idx, score: +h.score.toFixed(4), text: h.text })),
      display: { kind: 'kb', hits }
    };
  }
});

Tools.register({
  name: 'list_artifacts', category: 'system',
  desc: '列出本次会话已生成的文件（文件名、类型、大小、下载 id），便于统一打包或告知用户。',
  params: { type: 'object', properties: {} },
  async run() {
    if (!Artifacts.length) return { ok: true, summary: '暂无已生成文件', data: [] };
    return { ok: true, summary: `共 ${Artifacts.length} 个文件`, data: Artifacts.map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })), display: { kind: 'artifacts', items: Artifacts } };
  }
});
