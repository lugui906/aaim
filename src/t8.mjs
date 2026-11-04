import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9382, prof = '/home/l/aaim-agent/.t8-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(600) }); if (r.ok) { console.error('端口占用'); process.exit(2); } } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2200);
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description }; return r.result?.result?.value; };
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/home/l/aaim-agent/shots/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== A. 图表直接可见（不在折叠区里） ===');
await ev(`localStorage.clear(); Artifacts.length=0; UI.newSession(); return 1`);
await sleep(400);
const viz = await ev(`
  const s = State.current();
  s.messages.push({role:'user', content:'画一张 1–5 月销售额与成本的折线图', ts:Date.now()});
  s.messages.push({role:'assistant', content:'', step:1, tool_calls:[{id:'c1',name:'render_chart',arguments:{}}]});
  s.messages.push({role:'tool', name:'render_chart', tool_call_id:'c1', ok:true, ms:640, content:'x',
    display:{kind:'chart', title:'月度销售额', option:{tooltip:{trigger:'axis'},legend:{bottom:0},
      xAxis:{type:'category',data:['1月','2月','3月','4月','5月']},yAxis:{type:'value'},
      series:[{type:'line',name:'销售额',data:[120,180,150,240,300]},{type:'bar',name:'成本',data:[80,90,110,130,160]}]}}});
  s.messages.push({role:'assistant', content:'图已生成，销售额整体上行。', step:2, tool_calls:[]});
  UI.renderMessages();
  await new Promise(r=>setTimeout(r,11000));
  const vizOut = document.querySelector('.vizout');
  const steps = document.querySelector('details.steps:not(.thinkbox)');
  return {
    vizExists: !!vizOut,
    vizDisplay: vizOut ? getComputedStyle(vizOut).display : null,
    canvas: vizOut ? !!vizOut.querySelector('canvas') : false,
    canvasSize: vizOut && vizOut.querySelector('canvas') ? vizOut.querySelector('canvas').width + 'x' + vizOut.querySelector('canvas').height : null,
    inFold: steps ? steps.querySelectorAll('canvas,.toolcard').length : null,
    stepsCollapsed: steps ? !steps.open : null
  };
`);
P('可视输出容器存在且可见', viz && viz.vizExists && viz.vizDisplay !== 'none');
P('图表 canvas 已渲染', viz && viz.canvas, viz && viz.canvasSize);
P('图表不在折叠区内', viz && viz.inFold === 0, '折叠区内 canvas/toolcard=' + (viz && viz.inFold));
P('工具调用折叠条仍默认收起', viz && viz.stepsCollapsed === true);

console.log('=== B. 侧栏底部无 tok/就绪/工具数 ===');
const foot = await ev(`
  const f = document.querySelector('.side-foot');
  return { text: f ? f.innerText.trim() : '', display: f ? getComputedStyle(f).display : null,
    hasUsageChip: !!document.querySelector('#usageChip') };
`);
P('侧栏底部为空且隐藏', foot && foot.text === '' && foot.display === 'none', JSON.stringify(foot));
P('已移除 tok 统计', foot && !foot.hasUsageChip);

console.log('=== C. 思考块标题带字数（重渲染后保留） ===');
const think = await ev(`
  UI.newSession();
  const s = State.current();
  s.messages.push({role:'user', content:'t', ts:Date.now()});
  s.messages.push({role:'assistant', content:'ok', thinking:'先看工具列表，再决定用哪个。这里写一段足够长的思考内容用于验证字数统计。', step:1, tool_calls:[]});
  UI.renderMessages();
  await new Promise(r=>setTimeout(r,200));
  return document.querySelector('.thinkbox summary').innerText;
`);
P('标题显示「思考过程 · N 字」', think && /思考过程 · \d+ 字/.test(think), think);

console.log('=== D. 完整场景截图 ===');
await ev(`localStorage.clear(); Artifacts.length=0; return 1`);
await sleep(300);
const sceneB = fs.readFileSync('/home/l/aaim-agent/src/fixtures/scene-b.js', 'utf8');
await ev(sceneB);
await sleep(1500);
await shot('f2-conversation.png');

console.log('=== E. 无异常 ===');
await sleep(300);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
