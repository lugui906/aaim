import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9507, prof = "/home/l/aaim-agent/.t27-profile", OUT="/home/l/aaim-agent/shots";
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map();
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable'); await sleep(2500);
const run = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
console.log(JSON.stringify(await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  document.querySelector('#modeChip').click();
  await new Promise(z=>setTimeout(z, 800));
  const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return{y:Math.round(r.y),h:Math.round(r.height),bottom:Math.round(r.bottom),x:Math.round(r.x),w:Math.round(r.width)}};
  const tr = document.querySelector('#orgTrace');
  const te = tr.querySelector('.trace-empty');
  const tRect = tr.getBoundingClientRect(), eRect = te.getBoundingClientRect();
  return {
    trace: q('#orgTrace'),
    empty: q('.trace-empty'),
    emptyOffsetFromTraceTop: Math.round(eRect.top - tRect.top),
    spaceBelowEmpty: Math.round(tRect.bottom - eRect.bottom),
    toast: q('#toasts'),
    toastBottom: document.querySelector('#toasts') ? Math.round(document.querySelector('#toasts').getBoundingClientRect().bottom) : null,
    orgComposer: q('#orgComposer'),
    composerTop: Math.round(document.querySelector('#orgComposer').getBoundingClientRect().top),
    overlap: (()=>{const t=document.querySelector('#toasts'), c=document.querySelector('#orgComposer');
      if(!t||!c) return null; return t.getBoundingClientRect().bottom > c.getBoundingClientRect().top; })()
  };
`), null, 1));
ws.close(); edge.kill(); process.exit(0);
