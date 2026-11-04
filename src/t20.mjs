import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9469, prof = '/home/l/aaim-agent/.t20-profile', OUT='/home/l/aaim-agent/shots';
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

console.log('=== 1. 三轮后摘要不再重复列出旧工具 ===');
const r1 = await raw(`(async()=>{
  localStorage.clear(); UI.newSession(); App.attachments=[];
  State.settings.provider='mock'; State.settings.toolConfirm=false; State.settings.stream=true;
  const answers=[];
  for (let i=0;i<3;i++){
    $('#prompt').value='做个交互 html 演示 '+(i+1);
    App.send();
    await new Promise(z=>setTimeout(z, 6500));
    const s=State.current();
    const last=s.messages.filter(m=>m.role==='assistant').pop();
    answers.push({ round:i+1, len:(last.content||'').length, content:(last.content||'').slice(0,120) });
  }
  const s=State.current();
  const all = s.messages.filter(m=>m.role==='assistant').map(m=>m.content||'').join('\\n');
  const dupCount = (all.match(/已在沙箱中渲染/g)||[]).length;
  return { answers, dupCount, msgCount: s.messages.length, iframes: document.querySelectorAll('#messages iframe').length };
})()`, 40000);
console.log(JSON.stringify(r1, null, 1));
if (r1 && r1.answers) {
  const last = r1.answers[2];
  const cnt = (last.content.match(/已在沙箱中渲染/g) || []).length;
  P('第 3 轮摘要只列本轮工具', cnt <= 1, `第3轮里出现 ${cnt} 次`);
  P('全程只运行 1 个沙箱', r1.iframes <= 1, 'iframes=' + r1.iframes);
}
await sleep(800);
await shot('n1-fixed.png');

console.log('=== 2. iframe 高度自适应内容 ===');
const r2 = await raw(`(async()=>{
  UI.newSession();
  const d = { kind:'frame', title:'小内容', html:'<p style="margin:0;padding:8px">只有一行字</p>' };
  const node = UI.displayNode(d, {name:'render_html'});
  document.querySelector('#messages').append(node);
  const b = node.querySelector('.sbxidle button') || node.querySelector('.barrun');
  if (b) b.click();
  await new Promise(z=>setTimeout(z, 1800));
  const f = node.querySelector('iframe');
  const smallH = f ? Math.round(f.getBoundingClientRect().height) : null;

  UI.newSession();
  const d2 = { kind:'frame', title:'大内容', html:'<div style="height:600px;background:#eef">高个子</div>' };
  const node2 = UI.displayNode(d2, {name:'render_html'});
  document.querySelector('#messages').append(node2);
  const b2 = node2.querySelector('.sbxidle button') || node2.querySelector('.barrun');
  if (b2) b2.click();
  await new Promise(z=>setTimeout(z, 1800));
  const f2 = node2.querySelector('iframe');
  const bigH = f2 ? Math.round(f2.getBoundingClientRect().height) : null;
  return { smallH, bigH };
})()`, 20000);
console.log(JSON.stringify(r2));
P('小内容自动收窄(<180px)', r2 && r2.smallH && r2.smallH < 180, 'H=' + (r2 && r2.smallH));
P('大内容自动撑开(接近 600)', r2 && r2.bigH && r2.bigH > 550, 'H=' + (r2 && r2.bigH));
P('两者高度确实不同（真的自适应）', r2 && r2.smallH !== r2.bigH, `${r2&&r2.smallH} vs ${r2&&r2.bigH}`);

P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
