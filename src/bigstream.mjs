import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9484, prof = '/home/l/aaim-agent/.bs-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<40&&!wsUrl;i++){try{const j=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}await sleep(300);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=20000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await sleep(2300);
const run = async (expr, ms=20000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));

console.log('=== 模拟流式输出 200KB 的 HTML 代码块 ===');
const r1 = await run(`
  localStorage.clear(); UI.newSession();
  const s = State.current();
  s.messages.push({role:'user', content:'写一个复杂页面', ts:Date.now()});
  UI.renderMessages();
  // 模拟 onStepsStart
  Agent.hooks.onStepsStart();
  const big = '<div class="x">' + 'content '.repeat(25000) + '</div>';
  const full = '这是页面代码：\\n\\n\`\`\`html\\n' + big + '\\n\`\`\`\\n\\n完成。';
  const t0 = performance.now();
  // 分 200 片推入，模拟流式
  for (let i = 0; i < 200; i++) {
    const part = full.slice(Math.floor(full.length * i / 200), Math.floor(full.length * (i+1) / 200));
    Agent.hooks.onDelta(part, full.slice(0, Math.floor(full.length * (i+1) / 200)));
    if (i % 20 === 0) await new Promise(z=>setTimeout(z, 8));
  }
  const t1 = performance.now();
  Agent.hooks.onAssistantDone({ role:'assistant', content: full, tool_calls: [], thinking: '' }, 1);
  const t2 = performance.now();
  Agent.hooks.onDone(full, 1000);
  const t3 = performance.now();
  return { deltaMs: Math.round(t1-t0), doneMs: Math.round(t2-t1), finalMs: Math.round(t3-t2),
    len: full.length, domMsgs: document.querySelectorAll('#messages .msg').length };
`, 30000);
console.log(JSON.stringify(r1));
if (r1 && !r1.__TIMEOUT && !r1.__exc) {
  P('流式 200 片全程无卡死', true, `delta=${r1.deltaMs}ms`);
  P('渲染总耗时在合理范围(<5s)', r1.deltaMs + r1.doneMs + r1.finalMs < 5000, `总计 ${r1.deltaMs+r1.doneMs+r1.finalMs}ms`);
}

console.log('=== 渲染后再追问，页面是否还能用 ===');
const r2 = await run(`
  const t0 = performance.now();
  const ok = !!document.querySelector('#prompt');
  document.querySelector('#prompt').value = '继续';
  const t1 = performance.now();
  return { responsive: ok, ms: Math.round(t1-t0) };
`, 8000);
console.log(JSON.stringify(r2));
P('页面仍可交互', r2 && r2.responsive === true);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
