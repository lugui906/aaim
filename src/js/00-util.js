/* ============ 00 util: DOM / 通用工具 / CDN 加载器 ============ */
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
};
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = (p = 'id') => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const fmtBytes = (n) => { if (!n && n !== 0) return '-'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + u[i]; };
const fmtMs = (ms) => ms < 1000 ? ms + 'ms' : (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + 's';
const fmtTime = (t) => new Date(t).toLocaleString('zh-CN', { hour12: false });
const nowISO = () => new Date().toISOString();
const truncate = (s, n) => (s || '').length > n ? s.slice(0, n) + ' …' : (s || '');
/* 粗略 token 估算：中文≈1 字/token，英文≈4 字符/token */
const estTokens = (text) => {
  if (!text) return 0;
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  let cjk = 0, other = 0;
  for (const ch of s) { if (/[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch)) cjk++; else other++; }
  return Math.ceil(cjk * 1.0 + other / 3.6);
};
const estMessagesTokens = (msgs) => msgs.reduce((a, m) => a + 4 + estTokens(typeof m.content === 'string' ? m.content : m.content || '') + (m.tool_calls ? estTokens(JSON.stringify(m.tool_calls)) : 0), 0);

/* ---------- toast / modal ---------- */
const TOAST_MAX = 3;
/** 让提示条始终浮在输入框上方，不遮挡输入区 */
function syncToastOffset() {
  const box = document.querySelector('#composer');
  const wrap = $('#toasts');
  if (!box || !wrap) return;
  const h = box.getBoundingClientRect().height;
  wrap.style.bottom = Math.round(h + 10) + 'px';
}
window.addEventListener('resize', debounce(syncToastOffset, 120));

function toast(msg, type = '', ms = 2600) {
  const wrap = $('#toasts');
  if (!wrap) return { remove() { } };
  const icon = type === 'ok' ? Icons.check(13) : type === 'err' ? Icons.alert(13) : '';
  const t = el('div', { class: 'toast ' + type },
    icon ? el('span', { class: 'tico', html: icon }) : null,
    el('span', { class: 'tmsg', text: msg }));
  wrap.append(t);
  syncToastOffset();
  // 超出上限就立刻移除最旧的，避免堆叠遮挡
  while (wrap.children.length > TOAST_MAX) wrap.firstElementChild.remove();
  const kill = () => {
    if (!t.isConnected) return;
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    t.style.transition = '.22s';
    setTimeout(() => { t.remove(); syncToastOffset(); }, 240);
  };
  const timer = setTimeout(kill, ms);
  t._kill = () => { clearTimeout(timer); kill(); };
  t.remove = function () { clearTimeout(timer); if (this.isConnected) this.parentElement.removeChild(this); syncToastOffset(); };
  return t;
}
function openModal({ title, bodyHTML, okText = '确定', cancelText = '取消', okClass = 'primary', onOk, hideCancel = false }) {
  const modal = $('#modal');
  modal.innerHTML = '';
  const body = el('div', { class: 'cb', html: bodyHTML || '' });
  const footer = el('div', { class: 'cf' });
  const card = el('div', { class: 'card' },
    el('div', { class: 'ch', text: title || '' }),
    body, footer);
  const close = () => { modal.classList.remove('open'); modal.onclick = null; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  if (!hideCancel) footer.append(el('button', { class: 'btn', text: cancelText, onclick: close }));
  footer.append(el('button', { class: 'btn ' + okClass, text: okText, onclick: async () => {
    try { const r = onOk ? await onOk(body) : true; if (r !== false) close(); } catch (e) { toast(e.message || String(e), 'err'); }
  } }));
  modal.append(card);
  modal.classList.add('open');
  modal.onclick = (e) => { if (e.target === modal) close(); };
  document.addEventListener('keydown', onKey);
  return { close, body };
}
const confirmDialog = (title, html, okText = '确认执行') => new Promise((res) => {
  let done = false;
  openModal({ title, bodyHTML: html, okText, onOk: () => { done = true; res(true); }, cancelText: '拒绝' });
  const m = $('#modal');
  const obs = new MutationObserver(() => { if (!m.classList.contains('open') && !done) { done = true; res(false); obs.disconnect(); } });
  obs.observe(m, { attributes: true, attributeFilter: ['class'] });
});

/* ---------- 剪贴板 / 下载 ---------- */
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast('已复制', 'ok'); }
  catch { const ta = el('textarea', { style: 'position:fixed;opacity:0' }); ta.value = t; document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('已复制', 'ok'); }
}
function downloadBlob(blob, filename) {
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
const safeName = (s, def = 'file') => (String(s || '').replace(/[\\/:*?"<>|\n\r\t]/g, '_').trim().slice(0, 80) || def);

/* ---------- 持久化（localStorage，带体积保护） ---------- */
const Store = {
  pre: 'aaimAgent.v1.',
  get(k, d) {
    try { const v = localStorage.getItem(this.pre + k); return v == null ? d : JSON.parse(v); } catch { return d; }
  },
  set(k, v) {
    try { localStorage.setItem(this.pre + k, JSON.stringify(v)); return true; }
    catch (e) {
      if (String(e.name).includes('Quota')) {
        // 清理最旧会话后重试一次
        try { const ss = this.get('sessions', []); if (ss.length > 1) { ss.pop(); this.set('sessions', ss); localStorage.setItem(this.pre + k, JSON.stringify(v)); toast('存储已满，已丢弃最旧会话', 'err'); return true; } } catch { }
        toast('localStorage 已满，本次未保存。可导出会话后清空。', 'err', 5200);
      }
      return false;
    }
  },
  del(k) { localStorage.removeItem(this.pre + k); }
};

/* ---------- CDN 按需加载（多源回退） ---------- */
const CDN = {
  // 每条给多个源，按顺序尝试（jsdelivr 在部分网络被墙，故置于最后）
  libs: {
    marked: [
      'https://unpkg.com/marked@12.0.2/marked.min.js',
      'https://registry.npmmirror.com/marked/12.0.2/files/marked.min.js',
      'https://cdn.bootcdn.net/ajax/libs/marked/12.0.2/marked.min.js',
      'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js'
    ],
    hljs: [
      'https://cdn.bootcdn.net/ajax/libs/highlight.js/11.9.0/highlight.min.js',
      'https://unpkg.com/highlight.js@11.9.0/lib/common.min.js',
      'https://cdn.jsdelivr.net/npm/highlight.js@11.9.0/lib/common.min.js'
    ],
    docx: [
      'https://unpkg.com/docx@8.5.0/build/index.umd.js',
      'https://registry.npmmirror.com/docx/8.5.0/files/build/index.umd.js',
      'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js'
    ],
    xlsx: [
      'https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js',
      'https://registry.npmmirror.com/xlsx/0.18.5/files/dist/xlsx.full.min.js',
      'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    ],
    pptx: [
      'https://unpkg.com/pptxgenjs@3.12.0/dist/pptxgen.bundle.js',
      'https://registry.npmmirror.com/pptxgenjs/3.12.0/files/dist/pptxgen.bundle.js',
      'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js'
    ],
    pdflib: [
      'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
      'https://registry.npmmirror.com/pdf-lib/1.17.1/files/dist/pdf-lib.min.js',
      'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js'
    ],
    pdfjs: [
      'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js',
      'https://registry.npmmirror.com/pdfjs-dist/3.11.174/files/build/pdf.min.js',
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js'
    ],
    echarts: [
      'https://unpkg.com/echarts@5.5.0/dist/echarts.min.js',
      'https://registry.npmmirror.com/echarts/5.5.0/files/dist/echarts.min.js',
      'https://cdn.bootcdn.net/ajax/libs/echarts/5.5.0/echarts.min.js',
      'https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js'
    ],
    mermaid: [
      'https://unpkg.com/mermaid@10.9.1/dist/mermaid.min.js',
      'https://registry.npmmirror.com/mermaid/10.9.1/files/dist/mermaid.min.js',
      'https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js'
    ],
    exceljs: [
      'https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js',
      'https://cdn.bootcdn.net/ajax/libs/exceljs/4.4.0/exceljs.min.js',
      'https://registry.npmmirror.com/exceljs/4.4.0/files/dist/exceljs.min.js',
      'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
    ],
    jszip: [
      'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js',
      'https://cdn.bootcdn.net/ajax/libs/jszip/3.10.1/jszip.min.js',
      'https://registry.npmmirror.com/jszip/3.10.1/files/dist/jszip.min.js',
      'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'
    ],
    reveal: [
      'https://unpkg.com/reveal.js@4.6.1/dist/reveal.js',
      'https://cdn.jsdelivr.net/npm/reveal.js@4.6.1/dist/reveal.js'
    ]
  },
  _p: {},
  _cache: {},
  load(name, { urls, timeout = 20000 } = {}) {
    if (this._cache[name]) return this._cache[name];
    const list = urls || this.libs[name];
    if (!list) return Promise.reject(new Error('未知库: ' + name));
    const p = (async () => {
      let lastErr;
      for (const url of list) {
        try {
          await Promise.race([
            new Promise((res, rej) => {
              const s = document.createElement('script');
              s.src = url; s.async = true;
              s.onload = () => res();
              s.onerror = () => rej(new Error('加载失败 ' + url));
              document.head.append(s);
            }),
            sleep(timeout).then(() => { throw new Error('超时 ' + url); })
          ]);
          return true;
        } catch (e) { lastErr = e; }
      }
      throw new Error('所有 CDN 源均失败：' + name + '（最后错误：' + (lastErr && lastErr.message) + '）');
    })();
    this._p[name] = p;
    p.catch(() => { delete this._cache[name]; delete this._p[name]; });
    p.then(() => { this._cache[name] = p; });
    return p;
  }
};

/* ---------- 其它 ---------- */
function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; }
function scrollBottom(force) {
  const s = $('#stream');
  if (!s) return;
  const near = s.scrollHeight - s.scrollTop - s.clientHeight < 160;
  if (force || near) s.scrollTop = s.scrollHeight;
}
