import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9421, prof = '/home/l/aaim-agent/.str-profile', FAKE = 9491;
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
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2200);
const run = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};

// 指向假服务器
const cfg = await run(`
  localStorage.clear();
  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${FAKE}/v1';
  State.settings.providers.custom.apiKey = 'test';
  State.settings.providers.custom.model = 'fake';
  State.settings.stream = true;
  State.settings.toolConfirm = false;
  State.usage = { inTok:0, outTok:0, calls:0, toolCalls:0, cost:0 };
  UI.newSession(); App.attachments = [];
  $('#prompt').value = '给我一段长文本';
  App.send();
  return { busy: Agent.busy };
`);
console.log('发送后:', JSON.stringify(cfg));
await sleep(4000);
const mid = await run(`
  const b = document.querySelector('.msg.agent .bubble');
  return { len: b ? b.innerText.length : 0, busy: Agent.busy, hasCursor: b ? !!b.querySelector('.cursor') : false };
`);
console.log('4 秒时:', JSON.stringify(mid));
await sleep(6000);
const done = await run(`
  const m = State.current().messages.filter(x=>x.role==='assistant');
  const b = document.querySelector('.msg.agent .bubble');
  const last = m[m.length-1] || {};
  return { busy: Agent.busy, msgCount: m.length,
    contentLen: (last.content||'').length,
    domLen: b ? b.innerText.length : 0,
    expectLen: 300*4,
    tail: (last.content||'').slice(-30),
    hasLastChunk: (last.content||'').includes('段299') };
`);
console.log('完成时:', JSON.stringify(done));
console.log('错误:', errs.length ? errs.slice(0,3).join(' | ') : '无');
ws.close(); edge.kill(); process.exit(0);
