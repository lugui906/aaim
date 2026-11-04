import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9466, prof = '/home/l/aaim-agent/.t19-profile', OUT='/home/l/aaim-agent/shots';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<40&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}await sleep(300);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=12000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2300);
const raw = async (expr, ms=12000) => {
  const r = await sendT('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 真实流程：连续 3 轮让 Agent 写 HTML（原来会闪退） ===');
const r = await raw(`(async()=>{
  localStorage.clear(); UI.newSession(); App.attachments=[];
  State.settings.provider='mock'; State.settings.toolConfirm=false; State.settings.stream=true;
  const trace=[];
  for (let i=0;i<3;i++){
    $('#prompt').value = '做个交互 html 演示 ' + (i+1);
    App.send();
    await new Promise(z=>setTimeout(z, 6000));
    const s = State.current();
    trace.push({ round:i+1, busy:Agent.busy, msgs:s.messages.length,
      iframes:document.querySelectorAll('#messages iframe').length,
      ls:(localStorage.getItem(Store.pre+'sessions')||'').length });
  }
  return { trace, alive:true };
})()`, 40000);
console.log(JSON.stringify(r, null, 1));
if (r && r.trace) {
  const last = r.trace[r.trace.length-1];
  P('3 轮全部正常结束（没卡死）', r.trace.every(x=>x.busy===false), JSON.stringify(r.trace.map(x=>x.busy)));
  P('只有最新的那个在运行', last.iframes <= 1, 'iframes=' + last.iframes);
  P('存储没爆', last.ls < 50000, 'ls=' + last.ls + 'B');
}
await sleep(600);
await shot('m-html-turn.png');

console.log('=== 手动运行历史预览 ===');
const r2 = await raw(`(async()=>{
  // 按"有多少张沙箱卡片处于待运行状态"来数，避免同一卡片两个按钮被重复计数
  const frames = [...document.querySelectorAll('.frame')];
  const idle = frames.filter(f => f.querySelector('.sbxidle') || f.querySelector('.barrun'));
  const running = frames.filter(f => f.querySelector('iframe'));
  return { count: idle.length, running: running.length, total: frames.length };
})()`, 10000);
console.log(JSON.stringify(r2));
P('历史预览给「运行」按钮（不自动跑）', r2 && r2.count === 2 && r2.running === 1,
  `待运行=${r2 && r2.count} 运行中=${r2 && r2.running} 总数=${r2 && r2.total}`);
await shot('m-html-idle.png');

console.log('=== 页面最终状态 ===');
P('页面响应正常', (await raw(`(()=>({ok:1}))()`, 5000)).ok === 1);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
