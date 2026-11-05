import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9533, prof = '/home/l/aaim-agent/.ay-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1452,916', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map();
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable'); await sleep(2600);
const run = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};

const SWEEP_CODE = `
  // 正确的对比度：先把 alpha 合成到背景
  const parse = (c) => {
    const m = String(c).match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map(x=>parseFloat(x));
    return { r:p[0], g:p[1], b:p[2], a: p.length>3 ? p[3] : 1 };
  };
  const over = (fg, bg) => ({
    r: fg.r*fg.a + bg.r*(1-fg.a),
    g: fg.g*fg.a + bg.g*(1-fg.a),
    b: fg.b*fg.a + bg.b*(1-fg.a), a: 1
  });
  const lum = (c) => {
    const f = v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
    return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);
  };
  const ratio = (fg,bg) => { const a=lum(fg), b=lum(bg);
    const hi=Math.max(a,b), lo=Math.min(a,b); return (hi+0.05)/(lo+0.05); };

  // 计算元素的有效背景（逐层向上合成）
  const effBg = (el) => {
    let stack = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const cs = getComputedStyle(n);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) stack.push(c);
      if (c && c.a >= 1) break;
      n = n.parentElement;
    }
    stack.push({ r:255,g:255,b:255,a:1 });
    // 从最底层往上合成
    let bg = stack.pop();
    while (stack.length) { bg = over(stack.pop(), bg); }
    return bg;
  };

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.textContent || '').trim();
    if (!t) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) continue;
    const fg0 = parse(cs.color);
    if (!fg0) continue;
    const bg = effBg(el);
    const fg = over(fg0, bg);
    const cr = ratio(fg, bg);
    const px = parseFloat(cs.fontSize);
    const bold = (parseInt(cs.fontWeight,10) >= 700);
    // WCAG: 大文本(>=18.66px 粗体 或 >=24px) 门槛 3.0，其余 4.5
    const large = px >= 24 || (bold && px >= 18.66);
    const need = large ? 3.0 : 4.5;
    if (cr < need) {
      out.push({
        text: t.slice(0, 26),
        cls: (String(el.className) || el.tagName).slice(0, 26),
        color: cs.color, size: px, bold,
        ratio: +cr.toFixed(2), need,
        bg: 'rgb(' + [bg.r,bg.g,bg.b].map(v=>Math.round(v)).join(',') + ')'
      });
    }
  }
  // 合并同类（按 颜色+class 去重）
  const uniq = [];
  const k = new Set();
  for (const o of out) {
    const key = o.color + '|' + o.cls + '|' + o.size;
    if (k.has(key)) continue;
    k.add(key); uniq.push(o);
  }
  return { total: out.length, unique: uniq.length, items: uniq.slice(0, 40) };
`;
console.log('=== 全页对比度扫描（AA 标准）===');
const scenes = [
  ['亮色·首页',   `localStorage.clear(); document.documentElement.dataset.theme='light'; return 1;`],
  ['暗色·首页',   `document.documentElement.dataset.theme='dark'; return 1;`],
  ['亮色·企业模式', `document.documentElement.dataset.theme='light'; State.org=Org.defaults(); Org.save(); document.querySelector('#modeChip').click(); return 1;`],
  ['暗色·企业模式', `document.documentElement.dataset.theme='dark'; return 1;`],
];
for (const [name, js] of scenes) {
  await run(js);
  await new Promise(r=>setTimeout(r, 700));
  const r = await run(SWEEP_CODE);
  const bad = (r && r.items) || [];
  console.log('');
  console.log('【' + name + '】不合规文本 ' + (r ? r.total : 'ERR') + ' 处（去重 ' + (r ? r.unique : 0) + '）');
  for (const it of bad.slice(0, 8)) {
    console.log('   · ' + String(it.ratio).padEnd(6) + ' (需' + it.need + ')  ' + it.size + 'px  ' +
      String(it.cls).padEnd(18) + '  "' + it.text + '"');
  }
}
ws.close(); edge.kill(); process.exit(0);
