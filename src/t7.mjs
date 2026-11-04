import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9381, prof = '/home/l/aaim-agent/.t7-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(600) }); if (r.ok) { console.error(`✗ 端口 ${PORT} 被占用`); process.exit(2); } } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2200);
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); fs.writeFileSync('/home/l/aaim-agent/shots/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== A. 实时回合：非流式 thinking 也要出现且可折叠 ===');
const live = await ev(`
  State.settings.provider = 'mock';
  State.settings.stream = false;          // ★ 关键：非流式，onThink 不会被调用
  State.settings.toolConfirm = false;
  UI.newSession();
  Agent.enqueue('画个图表', {});
  await new Promise(r=>setTimeout(r, 9000));
  const box = document.querySelector('.thinkbox');
  return {
    exists: !!box,
    display: box ? getComputedStyle(box).display : null,
    isDetails: box && box.tagName === 'DETAILS',
    open: box ? box.open : null,
    summary: box ? box.querySelector('summary').innerText : '',
    len: box ? box.querySelector('.inner .thinking').textContent.length : 0,
    running: Agent.busy
  };
`);
P('非流式 thinking 实时出现', live && live.exists && live.display !== 'none', JSON.stringify({ s: live && live.summary }));
P('是 details 且已收起', live && live.isDetails && live.open === false);
P('标题带字数', live && /思考过程 · \d+ 字/.test(live.summary), live && live.summary);
P('内容非空', live && live.len > 5, (live && live.len) + ' 字');

console.log('=== B. placeholder 不再与下方提示重复 ===');
const ph = await ev(`return { ph: document.querySelector('#prompt').placeholder, hint: document.querySelector('.hint').innerText.replace(/\\n/g,' ') }`);
P('placeholder 已简化', ph && ph.ph === '给 Agent 一个任务…', JSON.stringify(ph.ph));
P('与下方 hint 不重复', ph && !ph.hint.includes(ph.ph), 'hint=' + JSON.stringify(ph.hint));

console.log('=== C. 侧栏底部不再有孤立按钮 ===');
const foot = await ev(`
  const f = document.querySelector('.side-foot');
  return { exists: !!f, display: f ? getComputedStyle(f).display : null, text: f ? f.innerText.trim() : '', hasSideExport: !!document.querySelector('#sideExport') };
`);
P('空侧栏底部自动隐藏', foot && foot.display === 'none', 'display=' + (foot && foot.display) + ' text=' + JSON.stringify(foot && foot.text));
P('「导入」已移入 ⋯ 菜单', foot && !foot.hasSideExport);
const menu = await ev(`
  document.querySelector('#btnMore').click();
  await new Promise(r=>setTimeout(r,200));
  const items = [...document.querySelectorAll('#moreMenu button')].map(b=>b.textContent.trim());
  document.querySelector('#moreMenu').classList.remove('open');
  return items;
`);
P('⋯ 菜单含「导入配置」', menu && menu.some(x=>x.includes('导入配置')), JSON.stringify(menu));

console.log('=== D. 桌面场景截图（对齐用户截图） ===');
const sceneB = fs.readFileSync('/home/l/aaim-agent/src/fixtures/scene-b.js', 'utf8');
await ev(sceneB);
await sleep(1500);
await shot('f1-conversation.png');
const chk = await ev(`
  const s = document.querySelector('#stream');
  return { thinkCollapsed: (()=>{const b=document.querySelector('.thinkbox'); return b? !b.open : null})(),
    stepsCollapsed: (()=>{const b=document.querySelector('details.steps:not(.thinkbox)'); return b? !b.open : null})(),
    artCards: document.querySelectorAll('.artfile').length,
    artVisible: (()=>{const a=document.querySelector('.artifacts'); return a? getComputedStyle(a).display!=='none':false})(),
    topbarText: document.querySelector('#topbar').innerText.trim(),
    scrollW: s.scrollWidth, clientW: s.clientWidth };
`);
P('两个折叠条都默认收起', chk && chk.thinkCollapsed === true && chk.stepsCollapsed === true);
P('产物卡片常显 2 个', chk && chk.artCards === 2 && chk.artVisible);
P('顶栏只有标题', chk && chk.topbarText === '出报表并解释思路', JSON.stringify(chk && chk.topbarText));

console.log('=== E. 无异常 ===');
await sleep(300);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
