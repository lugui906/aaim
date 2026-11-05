import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9509, prof = "/home/l/aaim-agent/.t29-profile", OUT="/home/l/aaim-agent/shots", LLM=9603;
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
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 走真实 UI 路径跑一次企业任务 ===');
const r = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  // 配好 mock 模型
  State.settings.provider = 'custom';
  State.settings.providers.custom.baseUrl = 'http://127.0.0.1:${LLM}/v1';
  State.settings.providers.custom.apiKey = 'x';
  State.settings.providers.custom.model = 'mock';
  State.settings.stream = false;
  State.settings.toolConfirm = false;
  UI.updateHeader();

  // 进入企业模式
  document.querySelector('#modeChip').click();
  await new Promise(z=>setTimeout(z, 500));

  // 附加一份材料
  OrgUI.attachText('报价.csv', '方案,套数,单价\\nA,12,300\\nB,8,300\\nC,5,300');
  // 填目标并点发送
  document.querySelector('#orgGoal').value = '把三个方案做成对比表并推荐';
  document.querySelector('#orgRunBtn').click();

  // 等运行结束
  for (let i=0;i<180 && OrgRuntime.running;i++) await new Promise(z=>setTimeout(z, 1000));
  await new Promise(z=>setTimeout(z, 1200));

  return {
    running: OrgRuntime.running,
    traceCount: document.querySelectorAll('#orgTrace .tevt').length,
    finalCards: document.querySelectorAll('#orgTrace .finalcard').length,
    rework: document.querySelectorAll('#orgTrace .tevt-warn').length,
    reviews: document.querySelectorAll('#orgTrace .tevt-review').length,
    rejects: document.querySelectorAll('#orgTrace .tevt-review.reject').length,
    statuses: Org.all().map(n=>n.name+':'+n.status),
    genBtnVisible: getComputedStyle(document.querySelector('#orgRunBtn')).display !== 'none',
    stopBtnVisible: getComputedStyle(document.querySelector('#orgStopBtn')).display !== 'none',
    goalEnabled: !document.querySelector('#orgGoal').disabled
  };
`, 200000);
console.log(JSON.stringify(r, null, 1));
await sleep(600);
await shot('orgA-final.png');
console.log('异常:', errs.length ? errs.slice(0,3).join(' | ') : '无');
ws.close(); edge.kill(); process.exit(0);
