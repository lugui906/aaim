import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9423, prof = '/home/l/aaim-agent/.t15-profile';
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
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));

console.log('=== 1. 旧 bug 不再出现：全局累计不再影响新会话 ===');
const r1 = await run(`
  State.settings.provider='mock'; State.settings.toolConfirm=false;
  // 模拟页面开很久、全局累计早已爆表
  State.usage.inTok = 900000; State.usage.outTok = 900000;
  State.usage.toolCalls = 999; State.usage.cost = 99;
  UI.newSession(); App.attachments = [];
  $('#prompt').value = '画个图表';
  App.send();
  await new Promise(z=>setTimeout(z, 4000));
  const err = document.querySelector('.errbox');
  const m = State.current().messages;
  return { hasErr: !!err, errText: err ? err.innerText.slice(0,50) : null,
    tools: m.filter(x=>x.role==='tool').map(x=>x.name),
    spent: State.current().spend };
`);
if (r1.__exc) console.log('EXC', r1.__exc);
else {
  P('全局计数爆表也不影响新会话', r1.hasErr === false && r1.tools.includes('render_chart'), JSON.stringify(r1.tools));
  P('本会话 spend 独立累计', r1.spent && r1.spent.tok > 0, JSON.stringify(r1.spent));
}

console.log('=== 2. 每轮工具次数上限（防死循环）仍有效，且下一轮自动恢复 ===');
const r2 = await run(`
  State.settings.budget.maxToolCalls = 1;
  UI.newSession();
  $('#prompt').value = '搜索并画图';
  App.send();
  await new Promise(z=>setTimeout(z, 3000));
  const box1 = document.querySelector('.errbox');
  const warn = box1 ? box1.classList.contains('warnbox') : false;
  const txt = box1 ? box1.innerText.replace(/\\n/g,' | ').slice(0,70) : null;
  const turnTools1 = Agent.turnTools;
  // 新建会话并调回正常上限，再发应该完全正常
  State.settings.budget.maxToolCalls = 40;
  UI.newSession();
  $('#prompt').value = '画个图表';
  App.send();
  await new Promise(z=>setTimeout(z, 4000));
  const err2 = document.querySelector('.errbox');
  State.settings.budget.maxToolCalls = 40;
  return { warn, txt, turnTools1, hasErr2: !!err2,
    tools2: State.current().messages.filter(x=>x.role==='tool').map(x=>x.name) };
`);
if (r2.__exc) console.log('EXC', r2.__exc);
else {
  P('单轮超限被拦下且用警告色', r2.turnTools1 >= 1, 'turnTools=' + r2.turnTools1);
  P('提示卡片出现', r2.txt !== null, r2.txt);
  P('下一轮自动恢复（不再永久卡死）', r2.hasErr2 === false && r2.tools2.includes('render_chart'), JSON.stringify(r2.tools2));
}

console.log('=== 3. 「继续执行」按钮能落地 ===');
const r3 = await run(`
  State.settings.budget.maxToolCalls = 1;
  UI.newSession();
  $('#prompt').value = '搜索并画图';
  App.send();
  await new Promise(z=>setTimeout(z, 3000));
  const box = document.querySelector('.errbox');
  const btn = box ? [...box.querySelectorAll('button')].find(b => b.textContent === '继续执行') : null;
  const before = Agent.turnTools;
  if (btn) btn.click();
  await new Promise(z=>setTimeout(z, 4500));
  State.settings.budget.maxToolCalls = 40;
  const msgs = State.current().messages;
  return { hasBtn: !!btn, before, after: Agent.turnTools,
    tools: msgs.filter(x=>x.role==='tool').map(x=>x.name),
    busy: Agent.busy };
`);
if (r3.__exc) console.log('EXC', r3.__exc);
else {
  P('有「继续执行」按钮', r3.hasBtn === true);
  P('点击后重置并继续工作', r3.tools.length >= 1, 'tools=' + JSON.stringify(r3.tools));
}

console.log('=== 4. 关闭护栏开关生效 ===');
const r4 = await run(`
  State.settings.budget.unlimited = true;
  State.settings.budget.maxTokens = 1;
  State.settings.budget.maxCost = 0.0001;
  UI.newSession();
  State.current().spend = { tok: 999999, cost: 99 };
  const over = Agent.budgetExceeded();
  State.settings.budget.unlimited = false;
  State.settings.budget.maxTokens = 200000;
  State.settings.budget.maxCost = 0.6;
  return { over };
`);
P('关闭后 token/费用不再拦截', r4 && r4.over === null, JSON.stringify(r4));

console.log('=== 5. 无异常 ===');
await sleep(300);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
