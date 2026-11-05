import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9502, prof = '/home/l/aaim-agent/.t22-profile', OUT='/home/l/aaim-agent/shots';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=25000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=25000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 1. 模式切换 ===');
const m1 = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  UI.updateModeChip();
  const before = { enabled: State.org.enabled, bodyCls: document.body.className, chip: document.querySelector('#modeChipText').textContent };
  document.querySelector('#modeChip').click();
  await new Promise(z=>setTimeout(z, 400));
  const after = { enabled: State.org.enabled, bodyCls: document.body.className,
    chip: document.querySelector('#modeChipText').textContent,
    orgPanelVisible: getComputedStyle(document.querySelector('#orgPanel')).display !== 'none',
    orgMainVisible: getComputedStyle(document.querySelector('#orgMain')).display !== 'none',
    composerHidden: getComputedStyle(document.querySelector('#composer')).display === 'none',
    treeNodes: document.querySelectorAll('.orgnode').length };
  return { before, after };
`, 10000);
console.log(JSON.stringify(m1, null, 1));
P('点击顶栏 chip 进入企业模式', m1 && m1.after.enabled === true && /org-mode/.test(m1.after.bodyCls));
P('侧栏切到组织树', m1 && m1.after.orgPanelVisible && m1.after.treeNodes >= 5, '节点数=' + (m1 && m1.after.treeNodes));
P('主区切到运行面板', m1 && m1.after.orgMainVisible && m1.after.composerHidden);
P('chip 文案更新', m1 && /企业团队/.test(m1.after.chip), m1 && m1.after.chip);
await sleep(400);
await shot('org1-entered.png');

console.log('=== 2. 角色显示与检查者独立分组 ===');
const m2 = await run(`
  const secs = [...document.querySelectorAll('.org-sec')].map(e=>e.textContent);
  const roles = [...document.querySelectorAll('.orgnode')].map(e=>e.className.match(/role-(\\w+)/)?.[1]);
  const lock = document.querySelector('.org-role.lock');
  return { secs, roles, lockText: lock ? lock.textContent : null };
`, 8000);
console.log(JSON.stringify(m2));
P('分组含「指挥链」「独立监督」', m2 && m2.secs.includes('指挥链') && m2.secs.includes('独立监督'), JSON.stringify(m2 && m2.secs));
P('四种角色都渲染', m2 && ['leader','subleader','worker','inspector'].every(r=>m2.roles.includes(r)), JSON.stringify(m2 && m2.roles));
P('检查者标注「公正」锁', m2 && m2.lockText === '公正');

console.log('=== 3. 嵌套分派：领导→小领导→执行者 ===');
const m3 = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  OrgBus.clear();
  State.settings.provider = 'mock';     // 演示模型不调工具，这里直接测引擎骨架
  const r = await OrgRuntime.run('做一份季度汇报', { attachments: [{ name:'数据.csv', text:'月份,金额\\n1月,100' }] });
  return { ok: !!r, text: (r && r.text || '').slice(0, 60),
    traceTypes: OrgRuntime.trace.map(e=>e.type),
    busCount: OrgBus.list().length,
    statuses: Org.all().map(n=>({name:n.name, st:n.status})) };
`, 60000);
console.log(JSON.stringify(m3, null, 1));
if (m3 && !m3.__exc && !m3.__TIMEOUT) {
  P('引擎跑完并返回结果', m3.ok === true, m3.text);
  P('轨迹含任务开始/结束', m3.traceTypes.includes('start') && m3.traceTypes.includes('finish'));
  P('总线记录了用户→领导', m3.busCount > 0, 'msgs=' + m3.busCount);
}
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
