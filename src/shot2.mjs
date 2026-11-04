import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9348, prof = '/home/l/aaim-agent/.shot2-profile', OUT = '/home/l/aaim-agent/shots';
fs.mkdirSync(OUT, { recursive: true });
fs.rmSync(prof, { recursive: true, force: true });

/* ---- 安全检查：端口若已被占用，说明有僵尸进程，直接失败退出（否则会连到旧页面） ---- */
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(600) });
  if (r.ok) { console.error(`✗ 端口 ${PORT} 已被占用（有残留 Edge 进程），请先执行: pkill -9 -f "msedge.*remote-debugging-port"`); process.exit(2); }
} catch {}
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=1', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map();
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${e}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); return r.result?.result?.value; };
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };
await sleep(2200);

// 场景 B：思考折叠 + 产物常显
const sceneB = fs.readFileSync('/home/l/aaim-agent/src/fixtures/scene-b.js', 'utf8');
await ev(sceneB);
await sleep(1200);
await shot('n1-conversation.png');

// 展开折叠行
await ev(`document.querySelector('.msg.agent details.steps').open = true; return 1;`);
await sleep(700);
await shot('n2-expanded.png');

// 记忆设置页
await ev(`Drawer.open('memory'); return 1;`);
await sleep(600);
await shot('n3-memory.png');

// 更多菜单
await ev(`Drawer.close(); document.querySelector('#moreMenu').classList.add('open'); UI.updateMemoryBadge(); return 1;`);
await sleep(400);
await shot('n4-menu.png');

// 深色主题
await ev(`document.querySelector('#moreMenu').classList.remove('open'); document.documentElement.dataset.theme='dark'; return 1;`);
await sleep(700);
await shot('n5-dark.png');
await ev(`document.documentElement.dataset.theme='light'; return 1;`);

// 移动端
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(900);
await shot('n6-mobile.png');

ws.close(); edge.kill(); process.exit(0);
