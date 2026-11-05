import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9504, prof = "/home/l/aaim-agent/.t24-profile", OUT="/home/l/aaim-agent/shots", LLM=9603;
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
try { const r = await fetch(`http://127.0.0.1:${LLM}/__log`, { signal: AbortSignal.timeout(800) }); if (!r.ok) throw 0; } catch { console.error('mock 未启动'); process.exit(3); }
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=120000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=120000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 打回重做链路（检查者第 1 次打回） ===');
const r = await run(`
  localStorage.clear();
  State.org = Org.defaults(); State.org.enabled = true; Org.save();
  OrgBus.clear(); OrgRuntime.trace = [];
  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${LLM}/v1';
  State.settings.providers.custom.apiKey = 'x';
  State.settings.providers.custom.model = 'mock';
  State.settings.stream = false; State.settings.toolConfirm = false;
  document.body.classList.add('org-mode');
  OrgUI.clearTrace();

  const res = await OrgRuntime.run('把三个方案做成对比表并推荐');
  return {
    finalText: (res.text||'').slice(0,80),
    finalReview: res.review ? {v:res.review.verdict, s:res.review.score} : null,
    attempts: res.attempts,
    traceTypes: OrgRuntime.trace.map(e=>e.type),
    reworkEvents: OrgRuntime.trace.filter(e=>e.type==='node-rework').map(e=>e.text),
    reviewEvents: OrgRuntime.trace.filter(e=>e.type==='review').map(e=>({n:e.nodeId, v:e.verdict, s:e.score})),
    traceDom: document.querySelectorAll('#orgTrace .tevt').length,
    finalCards: document.querySelectorAll('#orgTrace .finalcard').length
  };
`, 150000);
console.log(JSON.stringify(r, null, 1));
if (r && !r.__exc && !r.__TIMEOUT) {
  P('★ 出现打回事件', r.traceTypes.includes('node-rework'), (r.reworkEvents && r.reworkEvents[0]) || '(无)');
  const w1Reviews = r.reviewEvents.filter(e => e.n === 'w1');
  P('★ 被打回者重做了（同一节点被审 >= 2 次）', w1Reviews.length >= 2,
    'w1 被审 ' + w1Reviews.length + ' 次：' + JSON.stringify(w1Reviews.map(x => x.v + x.s)));
  P('★ 最终仍然通过', r.finalReview && r.finalReview.v === 'pass', JSON.stringify(r.finalReview));
  P('轨迹里既有 reject 也有 pass', r.reviewEvents.some(e=>e.v!=='pass') && r.reviewEvents.some(e=>e.v==='pass'), JSON.stringify(r.reviewEvents));
  P('界面渲染了轨迹事件', r.traceDom > 0, 'dom=' + r.traceDom);
}
await run(`OrgUI.appendFinal({ text: '（示例）三个方案合计：A 3600 / B 2400 / C 1500，推荐 A。', review: { verdict:'pass', score:92 } }); return 1;`, 10000);
await sleep(600);
await shot('org3-rework.png');
P('无未捕获异常', errs.length === 0, errs.slice(0,3).join(' | '));
ws.close(); edge.kill(); process.exit(0);
