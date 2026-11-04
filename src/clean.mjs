import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9385, prof = '/home/l/aaim-agent/.cl-profile', OUT = '/home/l/aaim-agent/shots';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map();
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); return r.result?.result?.value; };
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };
await sleep(2200);
// 完全干净：清 localStorage + 内存会话
await ev(`localStorage.clear(); Memory.clear(); Artifacts.length=0; State.sessions=[]; State.currentId=''; UI.updateHeader(); return 1`);
await sleep(300);
const sceneB = fs.readFileSync('/home/l/aaim-agent/src/fixtures/scene-b.js', 'utf8');
await ev(sceneB);
await sleep(1200);
await shot('g1-clean.png');
// 再拍一个展开思考的版本
await ev(`document.querySelectorAll('.thinkbox,.steps').forEach(d=>{if(!d.classList.contains('thinkbox'))return; d.open=true;}); return 1`);
await sleep(500);
await shot('g2-think-open.png');
ws.close(); edge.kill(); process.exit(0);
