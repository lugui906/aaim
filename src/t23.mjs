import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9503, prof = "/home/l/aaim-agent/.t23-profile", OUT="/home/l/aaim-agent/shots", LLM=9602;
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
try { const r = await fetch(`http://127.0.0.1:${LLM}/__log`, { signal: AbortSignal.timeout(800) }); if (!r.ok) throw 0; } catch { console.error('mock llm 未启动'); process.exit(3); }
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=90000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=90000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 端到端：领导→小领导→执行者→检查者→汇总 ===');
const r = await run(`
  localStorage.clear();
  State.org = Org.defaults(); State.org.enabled = true; Org.save();
  OrgBus.clear(); OrgRuntime.trace = [];
  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${LLM}/v1';
  State.settings.providers.custom.apiKey = 'x';
  State.settings.providers.custom.model = 'mock';
  State.settings.stream = false;
  State.settings.toolConfirm = false;

  const res = await OrgRuntime.run('把三个方案做成对比表并推荐', {
    attachments: [{ name: '报价.csv', kind: 'file', text: '方案,套数,单价\\nA,12,300\\nB,8,300\\nC,5,300' }]
  });

  return {
    finalText: (res && res.text || '').slice(0, 120),
    finalReview: res && res.review ? { v: res.review.verdict, s: res.review.score } : null,
    attempts: res && res.attempts,
    trace: OrgRuntime.trace.map(e => ({ t: e.type, n: e.nodeId, to: e.to, verdict: e.verdict, score: e.score })),
    statuses: Org.all().map(n => ({ n: n.name, r: n.role, st: n.status })),
    bus: OrgBus.list().map(m => ({ f: m.from, t: m.to, k: m.kind, att: m.attachments.length })),
    tokens: { in: State.usage.inTok, out: State.usage.outTok, calls: State.usage.calls }
  };
`, 120000);
console.log(JSON.stringify(r, null, 1));

if (r && !r.__exc && !r.__TIMEOUT) {
  P('最终交付有内容', (r.finalText || '').length > 10, r.finalText);
  P('★ 领导分派给小领导', r.trace.some(e => e.t === 'dispatch' && e.to === 'sub1'));
  P('★ 小领导分派给执行者', r.trace.some(e => e.t === 'dispatch' && e.to === 'w1'));
  P('★ 执行者产出被检查者审核', r.trace.some(e => e.t === 'review' && e.n === 'w1'));
  P('★ 小领导产出被审核', r.trace.some(e => e.t === 'review' && e.n === 'sub1'));
  P('★ 顶层产出被审核', r.trace.some(e => e.t === 'review' && e.n === 'leader'));
  const st = (nm) => (r.statuses.find(x => x.n === nm) || {}).st;
  P('三层都真正执行过（状态不再是 idle）', ['大领导','小领导','执行者 A'].every(nm => st(nm) && st(nm) !== 'idle'),
    JSON.stringify({ leader: st('大领导'), sub: st('小领导'), w1: st('执行者 A') }));
  P('消息总线记录了分派与交付', r.bus.filter(m => m.k === 'dispatch').length >= 3, JSON.stringify(r.bus.filter(m=>m.k==='dispatch')));
  P('调用次数合理(>5)', r.tokens.calls > 5, 'calls=' + r.tokens.calls);
  P('最终审核通过', r.finalReview && r.finalReview.v === 'pass', JSON.stringify(r.finalReview));
}
await sleep(500);
await shot('org2-run.png');
P('无未捕获异常', errs.length === 0, errs.slice(0,3).join(' | '));

// 看 mock 收到了哪些角色
try {
  const log = await (await fetch(`http://127.0.0.1:${LLM}/__log`)).json();
  const roles = [...new Set(log.calls.map(c => c.role))];
  console.log('mock 收到的角色:', JSON.stringify(roles));
  P('四个角色都真实发起了请求', ['leader','subleader','workerA','inspector'].every(x => roles.includes(x)), JSON.stringify(roles));
} catch (e) { console.log('读 mock 日志失败', e.message); }
ws.close(); edge.kill(); process.exit(0);
