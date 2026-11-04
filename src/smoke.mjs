import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9411, prof = '/home/l/aaim-agent/.smoke-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || '');
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + (m.params.args||[]).map(a=>a.value||a.description||'').join(' ')); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2500);
const r = await send('Runtime.evaluate', { expression: `(async()=>{ return {
  title: document.title, tools: Tools.active().length, plugins: State.plugins.length,
  theme: document.documentElement.dataset.theme,
  empty: !!document.querySelector('.empty'),
  pills: document.querySelectorAll('.empty .pills button').length,
  emoji: /[\\u{1F300}-\\u{1FAFF}]/u.test(document.querySelector('#app').innerHTML),
  svg: document.querySelectorAll('#app svg').length
}; })()`, awaitPromise: true, returnByValue: true });
const v = r.result?.result?.value;
console.log('启动检查:', JSON.stringify(v));
console.log('错误:', errs.length ? errs.slice(0,3).join(' | ') : '无');
ws.close(); edge.kill(); process.exit(0);
