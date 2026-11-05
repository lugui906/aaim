import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9521, prof = "/home/l/aaim-agent/.t31-profile", OUT="/home/l/aaim-agent/shots", LLM=9611;
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
const sendT=(m,p={},ms=150000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=150000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

// 记录并发峰值
await run(`
  window.__peak = 0; window.__maxRun = 0;
  const origSay = OrgRuntime.say.bind(OrgRuntime);
  OrgRuntime.say = function(ev){ 
    if (ev && ev.type) {
      const running = Org.all().filter(n=>n.status==='running').length;
      window.__maxRun = Math.max(window.__maxRun, running);
    }
    return origSay(ev);
  };
  return 1;
`, 10000);

console.log('=== 并行分派：领导同时派出 2 个任务 ===');
const r = await run(`
  localStorage.clear();
  State.org = Org.defaults();
  // 给大领导加第二个小领导，才有并行对象
  const s2 = Org.add({ role:'subleader', parentId:'leader', id:'sub2', name:'小领导 B' });
  State.org.enabled = true; Org.save();
  OrgBus.clear(); OrgRuntime.trace = [];

  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${LLM}/v1';
  State.settings.providers.custom.apiKey = 'x';
  State.settings.providers.custom.model = 'mock';
  State.settings.stream = false; State.settings.toolConfirm = false;

  const t0 = performance.now();
  const res = await OrgRuntime.run('做对比表并调研定价');
  const ms = Math.round(performance.now() - t0);

  const evs = OrgRuntime.trace;
  return {
    elapsedMs: ms,
    finalText: (res.text||'').slice(0,100),
    finalReview: res.review ? {v:res.review.verdict, s:res.review.score} : null,
    hasParallelStart: evs.some(e=>e.type==='parallel-start'),
    hasParallelEnd: evs.some(e=>e.type==='parallel-end'),
    parallelDispatches: evs.filter(e=>e.type==='dispatch' && e.group).length,
    groups: [...new Set(evs.filter(e=>e.group).map(e=>e.group))],
    busKinds: evs.length,
    busMsgs: OrgBus.list().length,
    maxConcurrent: window.__maxRun,
    sub1Status: Org.get('sub1').status,
    sub2Status: Org.get(s2.id).status,
    // 两个下级都真心发起过请求？
    reviews: evs.filter(e=>e.type==='review').length
  };
`, 200000);
console.log(JSON.stringify(r, null, 1));
if (r && !r.__exc && !r.__TIMEOUT) {
  P('★ 出现并行分派事件', r.hasParallelStart && r.hasParallelEnd);
  P('★ 两个任务属于同一并行组', r.parallelDispatches === 2 && r.groups.length === 1, JSON.stringify(r.groups));
  P('★ 同时有 2 个成员在跑（真并行）', r.maxConcurrent >= 2, 'peak=' + r.maxConcurrent);
  P('两个下级都完成了', r.sub1Status === 'done' && r.sub2Status === 'done', `sub1=${r.sub1Status} sub2=${r.sub2Status}`);
  P('汇总后仍有审核', r.reviews >= 2, 'reviews=' + r.reviews);
  P('最终通过', r.finalReview && r.finalReview.v === 'pass', JSON.stringify(r.finalReview));
}
await sleep(500);
await shot('orgC-parallel.png');

try {
  const log = await (await fetch(`http://127.0.0.1:${LLM}/__log`)).json();
  const roles = [...new Set(log.calls.map(c=>c.role))];
  console.log('mock 收到角色:', JSON.stringify(roles));
  P('两个小领导都真实发起请求', roles.includes('subleader') && roles.includes('subleader2'), JSON.stringify(roles));
} catch(e){ console.log('读日志失败', e.message); }

console.log('=== 校验：同一批里重复同一个下级要报错 ===');
const dup = await run(`
  const boss = Org.get('leader');
  try {
    await OrgRuntime.execNodeTool(boss, { name:'dispatch_parallel', arguments:{ tasks:[
      { agent_id:'sub1', task:'A' }, { agent_id:'sub1', task:'B' } ] } }, {});
    return { err: null };
  } catch(e){ return { err: e.message }; }
`, 20000);
console.log(JSON.stringify(dup));
P('同批重复同一 agent 被拒绝', dup && /出现了多次/.test(dup.err || ''), dup && dup.err);

console.log('=== 校验：派给非直属下级要报错 ===');
const bad = await run(`
  const boss = Org.get('leader');
  try {
    await OrgRuntime.execNodeTool(boss, { name:'dispatch_parallel', arguments:{ tasks:[
      { agent_id:'w1', task:'A' } ] } }, {});
    return { err: null };
  } catch(e){ return { err: e.message }; }
`, 20000);
console.log(JSON.stringify(bad));
P('非直属下级被拒绝', bad && /不是你的直属下级/.test(bad.err || ''), bad && bad.err);

P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
