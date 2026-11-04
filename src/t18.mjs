import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9465, prof = '/home/l/aaim-agent/.t18-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<40&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}await sleep(300);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=10000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await sleep(2300);
const raw = async (expr, ms=10000) => {
  const r = await sendT('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));

console.log('=== 1. 动画类 HTML 不再无限膨胀 ===');
const g = await raw(`(async()=>{
  localStorage.clear(); UI.newSession();
  const log = [];
  const started = State.current().messages.length;
  const d = {kind:'frame', title:'动画', height:150,
    html:'<h3>x</h3><script>function tick(){parent.postMessage({source:"aaim-sandbox",type:"event",name:"anim",payload:1},"*");requestAnimationFrame(tick)}requestAnimationFrame(tick)<\/script>'};
  // 标记为自动运行，模拟「刚生成」的真实路径
  d._key = 'f:动画:' + d.html.length + ':150';
  UI._autoRunKey = d._key;
  const node = UI.displayNode(d, {name:'render_html'});
  document.querySelector('#messages').append(node);
  for (let i=0;i<4;i++){
    await new Promise(z=>setTimeout(z, 2000));
    const s = State.current();
    log.push({ sec:(i+1)*2, msgs: s.messages.length, sandboxLog: (s.sandboxLog||[]).length,
      audit: State.audit.length, ls: (localStorage.getItem(Store.pre+'sessions')||'').length });
  }
  return { started, log };
})()`, 30000);
console.log(JSON.stringify(g, null, 1));
if (g && g.log) {
  const last = g.log[g.log.length-1], first = g.log[0];
  P('消息数不再增长（关键）', last.msgs === first.msgs, `${first.msgs} → ${last.msgs}`);
  P('沙箱日志有硬上限(≤40)', last.sandboxLog <= 40, 'sandboxLog=' + last.sandboxLog);
  P('同名事件被合并计数', last.sandboxLog <= 3, '条数=' + last.sandboxLog);
  P('审计记录有上限(≤500)', last.audit <= 500, 'audit=' + last.audit);
  P('localStorage 不再爆炸', last.ls < 20000, 'ls=' + last.ls + 'B');
}

console.log('=== 2. 默认不自动运行，点「运行」才跑 ===');
const r2 = await raw(`(async()=>{
  UI.newSession();
  const node = UI.displayNode({kind:'frame', title:'待运行', height:150, html:'<h3>hi</h3><script>document.body.dataset.ran="1"<\/script>'}, {name:'render_html'});
  document.querySelector('#messages').append(node);
  await new Promise(z=>setTimeout(z, 400));
  const hasIdle = !!document.querySelector('.sbxidle');
  const hasIframeBefore = !!document.querySelector('#messages iframe');
  const runBtn = document.querySelector('.frame .barrun') || document.querySelector('.sbxidle button');
  if (runBtn) runBtn.click();
  await new Promise(z=>setTimeout(z, 600));
  return { hasIdle, hasIframeBefore, hasIframeAfter: !!document.querySelector('#messages iframe'),
    hasStop: !!document.querySelector('.frame .barstop') };
})()`, 15000);
console.log(JSON.stringify(r2));
P('默认显示占位、不执行', r2 && r2.hasIdle === true && r2.hasIframeBefore === false);
P('点运行后挂载 iframe', r2 && r2.hasIframeAfter === true);
P('运行后出现停止按钮', r2 && r2.hasStop === true);

console.log('=== 3. 重渲染复用同一个 iframe（不重启） ===');
const r3 = await raw(`(async()=>{
  const before = document.querySelectorAll('#messages iframe').length;
  // 手动把 key 标记为自动运行，模拟"当前最新预览"
  const d = { kind:'frame', title:'待运行', height:150, html:'<h3>hi</h3>' };
  UI.renderMessages();
  await new Promise(z=>setTimeout(z, 500));
  const idle = document.querySelectorAll('.sbxidle').length;
  const iframes = document.querySelectorAll('#messages iframe').length;
  return { before, iframesAfterRender: iframes, idleCount: idle };
})()`, 15000);
console.log(JSON.stringify(r3));
P('重渲染不会让沙箱自己跑起来', r3 && r3.idleCount >= 0 && r3.iframesAfterRender === 0, JSON.stringify(r3));

console.log('=== 3b. 停止按钮可掐断 ===');
const r3b = await raw(`(async()=>{
  UI.newSession();
  const node = UI.displayNode({kind:'frame', title:'跑一下', height:150, html:'<h3>x</h3><script>setInterval(()=>parent.postMessage({source:"aaim-sandbox",type:"event",name:"tick",payload:1},"*"),10)<\/script>'}, {name:'render_html'});
  UI._autoRunKey = node.querySelector('.frame') ? '' : '';
  document.querySelector('#messages').append(node);
  const runBtn = document.querySelector('.frame .barrun') || document.querySelector('.sbxidle button');
  if (runBtn) runBtn.click();
  await new Promise(z=>setTimeout(z, 1200));
  const beforeStop = State.current().sandboxLog.length;
  const stop = document.querySelector('.frame .barstop');
  if (stop) stop.click();
  await new Promise(z=>setTimeout(z, 800));
  return { beforeStop, iframes: document.querySelectorAll('#messages iframe').length, hasIdle: !!document.querySelector('.sbxidle') };
})()`, 15000);
console.log(JSON.stringify(r3b));
P('停止后 iframe 被移除', r3b && r3b.iframes === 0, 'iframes=' + (r3b && r3b.iframes));
P('停止后显示占位可重跑', r3b && r3b.hasIdle === true);

console.log('=== 4. 沙箱事件仍会带给模型 ===');
const r4 = await raw(`(async()=>{
  localStorage.clear(); UI.newSession();
  const s = State.current();
  s.sandboxLog = [{ ts: Date.now(), name: 'slider', payload: { v: 42 }, count: 3, consumed: false }];
  State.settings.provider = 'mock'; State.settings.toolConfirm = false;
  $('#prompt').value = '我刚才拖动滑块到多少了？';
  App.send();
  await new Promise(z=>setTimeout(z, 3000));
  const u = State.current().messages.find(m=>m.role==='user');
  return { content: u ? u.content : '', display: u ? u.display : null,
    stillShown: u && u.display ? u.display : null };
})()`, 15000);
console.log(JSON.stringify(r4));
P('模型上下文含沙箱事件', r4 && /沙箱交互事件|slider/.test(r4.content || ''), truncate(r4 && r4.content, 80));
P('界面只显示用户原话', r4 && r4.display === '我刚才拖动滑块到多少了？', JSON.stringify(r4 && r4.display));

console.log('=== 5. 页面仍存活 & 无异常 ===');
const alive = await raw(`(()=>({alive:true}))()`, 5000);
P('页面响应正常', alive && alive.alive === true);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
function truncate(s,n){s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;}
ws.close(); edge.kill(); process.exit(0);
