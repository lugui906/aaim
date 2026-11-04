import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9422, prof = '/home/l/aaim-agent/.bu-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map();
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2200);
const run = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};

console.log('默认上限:', JSON.stringify(await run(`return {tools: State.settings.budget.maxToolCalls, tok: State.settings.budget.maxTokens, cost: State.settings.budget.maxCost}`)));

// 模拟用了一阵子：累计 40 次工具调用
console.log('--- 场景：累计工具调用到 40 次后，新开一个会话发消息 ---');
const r1 = await run(`
  State.settings.provider = 'mock'; State.settings.toolConfirm = false;
  State.usage.toolCalls = 40;         // 累计已达上限
  UI.newSession(); App.attachments = [];
  $('#prompt').value = '画个图表';
  App.send();
  await new Promise(z=>setTimeout(z, 2500));
  const err = document.querySelector('.errbox');
  const msgs = State.current().messages;
  return {
    hasErrBox: !!err,
    errText: err ? err.innerText.replace(/\\n/g,' ').slice(0,80) : null,
    assistantCount: msgs.filter(x=>x.role==='assistant').length,
    lastAssistantLen: (msgs.filter(x=>x.role==='assistant').pop()||{}).content?.length || 0,
    busy: Agent.busy
  };
`);
console.log(JSON.stringify(r1, null, 1));

// 累计 token 打满
console.log('--- 场景：累计 token 到 200k 后 ---');
const r2 = await run(`
  State.usage = { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0 };
  State.usage.inTok = 150000; State.usage.outTok = 55000;
  UI.newSession();
  $('#prompt').value = '你好';
  App.send();
  await new Promise(z=>setTimeout(z, 2000));
  const err = document.querySelector('.errbox');
  return { hasErrBox: !!err, errText: err ? err.innerText.replace(/\\n/g,' ').slice(0,70) : null };
`);
console.log(JSON.stringify(r2, null, 1));

// 累计费用打满
console.log('--- 场景：累计费用到 ¥0.6 后 ---');
const r3 = await run(`
  State.usage = { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0.61 };
  UI.newSession();
  $('#prompt').value = '你好';
  App.send();
  await new Promise(z=>setTimeout(z, 2000));
  const err = document.querySelector('.errbox');
  return { hasErrBox: !!err, errText: err ? err.innerText.replace(/\\n/g,' ').slice(0,70) : null };
`);
console.log(JSON.stringify(r3, null, 1));
ws.close(); edge.kill(); process.exit(0);
