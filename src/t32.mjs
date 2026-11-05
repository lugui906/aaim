import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9523, prof = "/home/l/aaim-agent/.t32-profile", OUT="/home/l/aaim-agent/shots", LLM=9611;
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
try { const r = await fetch(`http://127.0.0.1:${LLM}/__log`, { signal: AbortSignal.timeout(800) }); if (!r.ok) throw 0; } catch { console.error('mock 未启动'); process.exit(3); }
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=200000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=200000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

const setup = `
  OrgRuntime.running = false; OrgRuntime.abortFlag = false;
  localStorage.clear();
  State.org = Org.defaults();
  Org.add({ role:'subleader', parentId:'leader', id:'sub2', name:'小领导 B' });
  State.org.enabled = true; Org.save();
  OrgBus.clear(); OrgRuntime.trace = [];
  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${LLM}/v1';
  State.settings.providers.custom.apiKey = 'x';
  State.settings.providers.custom.model = 'mock';
  State.settings.stream = false; State.settings.toolConfirm = false;
`;

console.log('=== 计时对比：串行 vs 并行（每个请求 mock 延迟 200ms）===');
// 串行
await fetch(`http://127.0.0.1:${LLM}/__reset?mode=flat_serial&delay=200`);
const serial = await run(`${setup}
  const t0 = performance.now();
  let res, err = null;
  try { res = await OrgRuntime.run('做对比表并调研定价'); } catch(e) { err = e.message; }
  return { ms: Math.round(performance.now()-t0), err,
    text: res ? (res.text||'').slice(0,40) : null,
    trace: OrgRuntime.trace.map(e=>e.type),
    nDispatch: OrgRuntime.trace.filter(e=>e.type==='dispatch').length };

`, 200000);
console.log('串行:', JSON.stringify(serial));

// 并行
await fetch(`http://127.0.0.1:${LLM}/__reset?mode=flat_parallel&delay=200`);
const parallel = await run(`${setup}
  const t0 = performance.now();
  let res, err = null;
  try { res = await OrgRuntime.run('做对比表并调研定价'); } catch(e) { err = e.message; }
  const evs = OrgRuntime.trace;
  return { ms: Math.round(performance.now()-t0), err,
    text: res ? (res.text||'').slice(0,40) : null,
    hasPar: evs.some(e=>e.type==='parallel-start'),
    nDispatch: evs.filter(e=>e.type==='dispatch' && e.group).length };
`, 200000);
console.log('并行:', JSON.stringify(parallel));

const logS = await (await fetch(`http://127.0.0.1:${LLM}/__log`)).json();
console.log('mock 并发峰值(inflight):', logS.peakInflight);

if (serial && parallel && !serial.__exc && !parallel.__exc) {
  P('两种模式都跑完', serial.ms > 0 && parallel.ms > 0, `串行 ${serial.ms}ms / 并行 ${parallel.ms}ms`);
  P('两种模式派活总数一致（工作量对等）', serial.nDispatch === parallel.nDispatch,
    `串行 ${serial.nDispatch} 次 / 并行 ${parallel.nDispatch} 次`);
  const saved = serial.ms - parallel.ms;
  P('★ 同等工作量下并行更快', saved > 150, `省了 ${saved}ms（串行 ${serial.ms} / 并行 ${parallel.ms}）`);
  P('★ 并行确实出现了 parallel-start', parallel.hasPar === true);
  P('★ 并行时 mock 上同时有多个请求在飞', logS.peakInflight >= 2, 'peakInflight=' + logS.peakInflight);
}
await sleep(500);
await shot('orgD-parallel-timing.png');
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
