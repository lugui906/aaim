import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9445, prof = '/home/l/aaim-agent/.t17-profile', DL='/home/l/aaim-agent/.dl4';
fs.rmSync(prof, { recursive: true, force: true });
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<40&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}await sleep(300);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||'');});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
await send('Runtime.enable'); await send('Page.enable');
const bj = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const bws = new WebSocket(bj.webSocketDebuggerUrl);
await new Promise(r=>bws.addEventListener('open',r));
let bid=0; const bp=new Map();
bws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&bp.has(m.id)){bp.get(m.id)(m);bp.delete(m.id);}});
const bsend=(m,p={})=>new Promise(res=>{const i=++bid;bp.set(i,res);bws.send(JSON.stringify({id:i,method:m,params:p}));});
await bsend('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:DL,eventsEnabled:true}).catch(()=>{});
await sleep(2300);
const run = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));

console.log('=== 1. 生成 4 种文档并确认写入 IndexedDB ===');
const g = await run(`
  localStorage.clear(); Artifacts.length = 0; State.sessions=[]; State.currentId='';
  if (typeof ArtifactStore !== 'undefined') await ArtifactStore.clear();
  UI.newSession();
  const s = State.current();
  const outs = [];
  outs.push(await Tools.exec('generate_docx', { filename:'刷新测试.docx', title:'季度总结', blocks:[{type:'h1',text:'一、概览'},{type:'p',text:'营收同比增长 23%。'}] }));
  outs.push(await Tools.exec('generate_xlsx', { filename:'刷新测试.xlsx', sheets:[{name:'报价',headers:['方案','小计'],rows:[['A',3600],['B',2400]],totalRow:'合计'}] }));
  outs.push(await Tools.exec('generate_pptx', { filename:'刷新测试.pptx', slides:[{layout:'title',title:'汇报',subtitle:'Q3'}] }));
  outs.push(await Tools.exec('make_html_app', { title:'小应用', filename:'刷新测试.html', html:'<h3>Hello</h3>' }));
  s.messages.push({role:'user', content:'生成文档', ts:Date.now()});
  for (const o of outs) s.messages.push({role:'tool', name:'t', tool_call_id:'c'+Math.random(), ok:true, ms:5, content:'x', display:o.display});
  s.messages.push({role:'assistant', content:'好了', step:1, tool_calls:[]});
  State.saveSessions();
  await new Promise(z=>setTimeout(z, 1200));
  const stored = await ArtifactStore.list();
  return { artCount: Artifacts.length, storedCount: stored.length, names: stored.map(x=>x.name), sizes: stored.map(x=>x.size) };
`);
P('生成 4 个产物', g.artCount === 4, JSON.stringify(g.names));
P('4 个都写入 IndexedDB', g.storedCount === 4, 'stored=' + g.storedCount);
P('存的是原始字节大小', g.sizes.every(x=>x>100), JSON.stringify(g.sizes));

console.log('=== 2. 刷新页面（blob 会丢） ===');
await run(`location.reload(); return 1`);
await sleep(3500);
const a = await run(`
  const s = State.current();
  UI.renderMessages();
  await new Promise(z=>setTimeout(z, 800));
  const arts = s.messages.filter(m=>m.display&&m.display.art).map(m=>m.display.art);
  return { msgCount: s.messages.length, artCount: arts.length,
    blobTypes: arts.map(x=>x.blob===undefined?'undefined':(x.blob&&x.blob.constructor?x.blob.constructor.name:String(x.blob))),
    cards: document.querySelectorAll('.artfile').length };
`);
P('刷新后消息仍在', a.msgCount >= 6, 'msgs=' + a.msgCount);
P('★ blob 已被 JSON 擦成空对象（这就是原 bug）', a.blobTypes.every(t=>t==='Object'), JSON.stringify(a.blobTypes));
P('产物卡片仍渲染', a.cards === 4, 'cards=' + a.cards);

console.log('=== 3. 刷新后逐个点下载 ===');
const dl = await run(`
  const btns = [...document.querySelectorAll('.artbtn[title="下载"]')];
  for (const b of btns) { b.click(); await new Promise(z=>setTimeout(z, 1200)); }
  return { clicked: btns.length };
`);
P('刷新后仍可点下载', dl.clicked === 4, 'clicked=' + dl.clicked);
await sleep(3000);
const chk = await run(`
  const arts = State.current().messages.filter(m=>m.display&&m.display.art).map(m=>m.display.art);
  const restored = arts.map(x => x.blob instanceof Blob ? x.blob.size : null);
  return { restored };
`);
P('★ 下载时从 IndexedDB 恢复了字节', chk.restored && chk.restored.every(x=>x>100), JSON.stringify(chk.restored));
ws.close(); bws.close(); edge.kill(); process.exit(0);
