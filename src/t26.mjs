import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9506, prof = "/home/l/aaim-agent/.t26-profile", OUT="/home/l/aaim-agent/shots";
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=20000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=20000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 1. 进入企业模式后中间不再是空白 ===');
const r1 = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  document.querySelector('#modeChip').click();
  await new Promise(z=>setTimeout(z, 600));
  const tr = document.querySelector('#orgTrace');
  const empty = tr.querySelector('.trace-empty');
  return {
    enabled: State.org.enabled,
    traceChildren: tr.children.length,
    hasEmpty: !!empty,
    emptyText: empty ? empty.innerText.replace(/\\n/g,' | ').slice(0, 200) : null,
    flowNodes: tr.querySelectorAll('.tef-node').length,
    tips: tr.querySelectorAll('.te-tips div').length,
    traceH: Math.round(tr.getBoundingClientRect().height)
  };
`, 15000);
console.log(JSON.stringify(r1, null, 1));
P('★ 中间有引导内容（不再是空白）', r1 && r1.hasEmpty === true && r1.traceChildren > 0);
P('显示流程示意 4 个节点', r1 && r1.flowNodes === 4);
P('显示统计提示', r1 && r1.tips === 3);
P('区域有高度', r1 && r1.traceH > 200, r1 && r1.traceH + 'px');
await sleep(400);
await shot('org7-empty-fixed.png');

console.log('=== 2. 布局占满、无溢出 ===');
const r2 = await run(`
  const main = document.querySelector('#main').getBoundingClientRect();
  const tr = document.querySelector('#orgTrace').getBoundingClientRect();
  const comp = document.querySelector('#orgComposer').getBoundingClientRect();
  return { mainH: Math.round(main.height), traceH: Math.round(tr.height), compH: Math.round(comp.height),
    gap: Math.round(comp.top - tr.bottom),
    bodyOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight };
`, 10000);
console.log(JSON.stringify(r2));
P('内容区占满剩余空间', r2 && r2.traceH > r2.mainH * 0.5, `${r2&&r2.traceH} / ${r2&&r2.mainH}`);
P('无垂直溢出', r2 && Math.abs(r2.bodyOverflow) <= 1, 'overflow=' + (r2 && r2.bodyOverflow));

console.log('=== 3. 侧栏底部没有多余残字 ===');
const r3 = await run(`
  const foot = document.querySelector('.side-foot');
  const orgFoot = document.querySelector('.org-foot');
  return { sideFootText: foot ? foot.innerText.trim() : null,
    sideFootVisible: foot ? getComputedStyle(foot).display !== 'none' : false,
    orgFootText: orgFoot ? orgFoot.innerText.trim() : null,
    sessionsHidden: getComputedStyle(document.querySelector('#sessions')).display === 'none' };
`, 10000);
console.log(JSON.stringify(r3));
P('会话列表在企业模式下隐藏', r3 && r3.sessionsHidden === true);
P('侧栏底部无残留文字', r3 && (!r3.sideFootVisible || !r3.sideFootText), JSON.stringify(r3 && r3.sideFootText));
P('检查者说明在组织面板底部', r3 && /检查者独立/.test(r3.orgFootText || ''), r3 && r3.orgFootText);

P('无未捕获异常', errs.length === 0, errs.slice(0,3).join(' | '));
ws.close(); edge.kill(); process.exit(0);
