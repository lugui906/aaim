import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9442, prof = '/home/l/aaim-agent/.t16-profile', DL = '/home/l/aaim-agent/.dl2';
fs.rmSync(prof, { recursive: true, force: true });
fs.rmSync(DL, { recursive: true, force: true }); fs.mkdirSync(DL, { recursive: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs=[];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const bj = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const bws = new WebSocket(bj.webSocketDebuggerUrl);
await new Promise(r => bws.addEventListener('open', r));
let bid=0; const bp=new Map();
bws.addEventListener('message', ev => { const m=JSON.parse(ev.data); if(m.id&&bp.has(m.id)){bp.get(m.id)(m);bp.delete(m.id);} });
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

// 生成两种表：带表头 + 带合计行
const r = await run(`
  localStorage.clear(); Artifacts.length = 0; State.sessions=[]; State.currentId='';
  UI.newSession();
  const out = [];
  out.push(await Tools.exec('generate_xlsx', { filename:'报价单.xlsx', sheets:[{
    name:'报价', headers:['方案','套数','单价','小计'],
    rows:[['A 方案',12,300,3600],['B 方案',8,300,2400],['C 方案',5,300,1500]],
    totalRow:'合计'
  }]}));
  out.push(await Tools.exec('generate_xlsx', { filename:'两表.xlsx', sheets:[
    { name:'汇总', headers:['部门','人数'], rows:[['研发',32],['市场',12]] },
    { name:'明细', rows:[['自由格式', 1],['没有表头', 2]] }
  ]}));
  await new Promise(z=>setTimeout(z,600));
  return { ok: out.map(o=>o.ok), names: Artifacts.map(a=>a.name), sizes: Artifacts.map(a=>a.size) };
`);
console.log('生成:', JSON.stringify(r));
if (r && r.ok) P('两个表都生成成功', r.ok.every(Boolean), JSON.stringify(r.sizes));

const clicked = await run(`
  const btns=[...document.querySelectorAll('.artbtn[title="下载"]')]||[];
  if(document.querySelectorAll('.artfile').length===0){
    const s=State.current();
    for(const a of Artifacts) s.messages.push({role:'tool',name:'generate_xlsx',tool_call_id:'c'+a.id,ok:true,ms:10,content:'x',display:{kind:'file',art:a}});
    s.messages.push({role:'assistant',content:'done',step:1,tool_calls:[]});
    UI.renderMessages();
    await new Promise(z=>setTimeout(z,800));
  }
  const b=[...document.querySelectorAll('.artbtn[title="下载"]')];
  b.forEach((x,i)=>setTimeout(()=>x.click(), i*350));
  await new Promise(z=>setTimeout(z, b.length*350+1500));
  return { n:b.length };
`);
console.log('下载:', JSON.stringify(clicked));
await sleep(2000);
console.log('错误:', errs.length?errs.slice(0,2).join(' | '):'无');
ws.close(); bws.close(); edge.kill(); process.exit(0);
