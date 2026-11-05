import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9510, prof = "/home/l/aaim-agent/.t30-profile", OUT="/home/l/aaim-agent/shots";
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 嵌套四层：领导 → 小领导 → 小领导 → 执行者 ===');
const r = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  const s2 = Org.add({ role:'subleader', parentId:'sub1', name:'小组长' });
  const w3 = Org.add({ role:'worker', parentId:s2.id, name:'执行者 C' });
  // 超出深度上限
  let deepErr = '';
  try { Org.add({ role:'worker', parentId:w3.id, name:'太深了' }); } catch(e){ deepErr = e.message; }
  // 真正测深度上限：在第 3 层再挂一个小领导，第 4 层就超限
  let depthErr = '';
  try { const s3 = Org.add({ role:'subleader', parentId:s2.id, name:'第3层小领导' });
        Org.add({ role:'worker', parentId:s3.id, name:'第4层' }); }
  catch(e){ depthErr = e.message; }
  return { depths: Org.all().map(n=>({n:n.name, d:Org.depth(n.id)})), deepErr, depthErr,
    chain: ['leader','sub1',s2.id,w3.id].map(id => Org.path(id).map(x=>x.name).join(' > ')) };
`);
console.log(JSON.stringify(r, null, 1));
P('可嵌套到第 3 层', r && r.depths.find(x=>x.n==='执行者 C').d === 3, JSON.stringify(r && r.depths.filter(x=>['小组长','执行者 C'].includes(x.n))));
P('执行者不能再挂下属', r && /执行者不能有下属/.test(r.deepErr), r && r.deepErr);
P('超过 4 层上限被拒绝', r && /上限/.test(r.depthErr || ''), r && r.depthErr);
P('路径完整', r && r.chain[3] === '大领导 > 小领导 > 小组长 > 执行者 C', r && r.chain[3]);

console.log('=== 领导用界面添加下层的交互 ===');
const r2 = await run(`
  document.querySelector('#modeChip').click();
  await new Promise(z=>setTimeout(z, 500));
  // 点大领导行上的「+」
  const nodes = [...document.querySelectorAll('.orgnode')];
  const leader = nodes.find(n=>/大领导/.test(n.innerText));
  const plus = leader.querySelector('.org-mini');
  plus.click();
  await new Promise(z=>setTimeout(z, 400));
  const modal = document.querySelector('#modal');
  const open = modal.classList.contains('open');
  const title = modal.querySelector('.ch') ? modal.querySelector('.ch').textContent : null;
  const hasName = !!modal.querySelector('input');
  const hasPrompt = !!modal.querySelector('textarea');
  // 填名字并提交
  modal.querySelector('input').value = '小领导 X';
  modal.querySelector('textarea').value = '你负责市场调研';
  [...modal.querySelectorAll('.cf button')].find(b=>/添加/.test(b.textContent)).click();
  await new Promise(z=>setTimeout(z, 500));
  return { open, title, hasName, hasPrompt,
    added: Org.all().some(n=>n.name==='小领导 X'),
    parentOk: Org.all().filter(n=>n.name==='小领导 X').every(n=>n.parentId==='leader'),
    promptOk: Org.all().filter(n=>n.name==='小领导 X').every(n=>/市场调研/.test(n.prompt)),
    treeNames: [...document.querySelectorAll('.orgnode .org-name')].map(e=>e.textContent) };
`);
console.log(JSON.stringify(r2, null, 1));
P('点「+」弹出添加下级对话框', r2 && r2.open === true, r2 && r2.title);
P('有名称与角色说明字段', r2 && r2.hasName && r2.hasPrompt);
P('★ 添加成功并挂在大领导下', r2 && r2.added && r2.parentOk);
P('角色说明被保存', r2 && r2.promptOk);
await sleep(500);
await shot('orgB-nested.png');

console.log('=== 编辑与删除 ===');
const r3 = await run(`
  const node = Org.all().find(n=>n.name==='小领导 X');
  Org.update(node.id, { name:'市场负责人' });
  const renamed = Org.get(node.id).name;
  Org.remove(node.id);
  const gone = !Org.get(node.id);
  // 大领导不可删
  let leaderErr = '';
  try { Org.remove('leader'); } catch(e){ leaderErr = e.message; }
  return { renamed, gone, leaderErr };
`);
console.log(JSON.stringify(r3));
P('可以重命名', r3 && r3.renamed === '市场负责人');
P('可以删除（连子树）', r3 && r3.gone === true);
P('大领导不可删除', r3 && /不能/.test(r3.leaderErr), r3 && r3.leaderErr);

P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
