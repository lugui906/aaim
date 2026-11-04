import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9361, prof = '/home/l/aaim-agent/.nav-profile';
fs.rmSync(prof, { recursive: true, force: true });

/* ---- 安全检查：端口若已被占用，说明有僵尸进程，直接失败退出（否则会连到旧页面） ---- */
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(600) });
  if (r.ok) { console.error(`✗ 端口 ${PORT} 已被占用（有残留 Edge 进程），请先执行: pkill -9 -f "msedge.*remote-debugging-port"`); process.exit(2); }
} catch {}
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2000);
const ev = async (code) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${code}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));

// 切到移动端视口
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(700);

const st = () => ev(`return { open: document.body.classList.contains('nav-open'), maskVis: getComputedStyle(document.querySelector('#navMask')).visibility, maskOpacity: getComputedStyle(document.querySelector('#navMask')).opacity, aria: document.querySelector('#btnMenu').getAttribute('aria-expanded'), closeBtn: getComputedStyle(document.querySelector('#btnNavClose')).display }`);
const click = (sel) => ev(`document.querySelector('${sel}').click(); return 1`);
const press = async (k) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: 27 }); };

let s0 = await st();
P('初始：侧栏关闭、遮罩不可见', s0 && !s0.open && s0.maskVis === 'hidden', JSON.stringify(s0));
P('移动端显示关闭按钮', s0 && s0.closeBtn === 'grid', 'display=' + (s0 && s0.closeBtn));

// 1) 汉堡打开
await click('#btnMenu'); await sleep(350);
let s1 = await st();
P('① 点汉堡可打开', s1 && s1.open && s1.maskVis === 'visible', 'aria=' + (s1 && s1.aria));
P('打开时遮罩可见（可点击）', s1 && parseFloat(s1.maskOpacity) > 0.9, 'opacity=' + (s1 && s1.maskOpacity));
P('打开时 aria-expanded=true', s1 && s1.aria === 'true');

// 2) 点遮罩关闭
await click('#navMask'); await sleep(400);
let s2 = await st();
P('② 点遮罩可关闭', s2 && !s2.open && s2.maskVis === 'hidden', JSON.stringify({ open: s2.open, vis: s2.maskVis }));
P('关闭后 aria-expanded=false', s2 && s2.aria === 'false');

// 3) 关闭按钮
await click('#btnMenu'); await sleep(300);
await click('#btnNavClose'); await sleep(400);
let s3 = await st();
P('③ 侧栏内 ✕ 按钮可关闭', s3 && !s3.open);

// 4) Esc
await click('#btnMenu'); await sleep(300);
await press('Escape'); await sleep(400);
let s4 = await st();
P('④ Esc 可关闭', s4 && !s4.open);

// 5) 选中会话后自动收起
await click('#btnMenu'); await sleep(300);
await ev(`
  if (!State.sessions.length || State.sessions.length < 2) { UI.newSession(); UI.newSession(); }
  return 1;
`);
await click('#btnMenu'); await sleep(300);
const item = await ev(`const it=document.querySelector('#sessions .sitem'); it.click(); return 1`);
await sleep(450);
let s5 = await st();
P('⑤ 点会话项后自动收起', s5 && !s5.open);

// 6) 新建会话后收起
await click('#btnMenu'); await sleep(300);
await click('#btnNew'); await sleep(450);
let s6 = await st();
P('⑥ 点「新会话」后自动收起', s6 && !s6.open);

// 7) 桌面宽度自动收起 + 汉堡隐藏
await ev(`App.openNav(); return 1`); await sleep(250);
await send('Emulation.setDeviceMetricsOverride', { width: 1460, height: 1000, deviceScaleFactor: 1, mobile: false });
await sleep(500);
let s7 = await st();
const desk = await ev(`return { menuBtn: getComputedStyle(document.querySelector('#btnMenu')).display, closeBtn: getComputedStyle(document.querySelector('#btnNavClose')).display, mask: getComputedStyle(document.querySelector('#navMask')).visibility }`);
P('⑦ 变宽到桌面后自动收起侧栏', s7 && !s7.open, JSON.stringify({ open: s7 && s7.open }));
P('桌面端汉堡与 ✕ 都隐藏', desk && desk.menuBtn === 'none' && desk.closeBtn === 'none', JSON.stringify(desk));

// 8) 侧栏打开时背景滚动被锁
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(400);
await ev(`App.openNav(); return 1`); await sleep(300);
const lock = await ev(`return { bodyOverflow: getComputedStyle(document.body).overflow, streamOverflow: getComputedStyle(document.querySelector('#stream')).overflowY }`);
P('⑧ 侧栏打开时锁住背景滚动', lock && lock.bodyOverflow === 'hidden', JSON.stringify(lock));
await ev(`App.closeNav(); return 1`); await sleep(300);
const unlock = await ev(`return { streamOverflow: getComputedStyle(document.querySelector('#stream')).overflowY }`);
P('关闭后消息区滚动恢复', unlock && unlock.streamOverflow === 'auto', JSON.stringify(unlock));

P('全程无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
