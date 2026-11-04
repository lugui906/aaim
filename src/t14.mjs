import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9401, prof = '/home/l/aaim-agent/.t14-profile', OUT = '/home/l/aaim-agent/shots';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const run = async (body) => {
  const r = await send('Runtime.evaluate', { expression: `(async()=>{ ${body} })()`, awaitPromise: true, returnByValue: true, userGesture: true });
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };
await sleep(2200);

// 场景 1：带附件 + "读一下，总结要点" → 不该生成文档
const r1 = await run(`
  localStorage.clear(); Artifacts.length = 0; State.sessions = []; State.currentId = '';
  UI.newSession(); App.attachments = [];
  const d = await buildDocx({ title: '季度总结报告', blocks: [{type:'h1',text:'一、概览'},{type:'p',text:'营收同比增长 23%。'}] });
  const x = await buildXlsx({ sheets:[{ name:'报价', headers:['方案','小计'], rows:[['A',3600]] }] });
  const p = await buildPptx({ slides:[{layout:'title',title:'季度汇报',subtitle:'2026 Q3'}] });
  await App.addFiles([new File([d],'季度总结报告.docx'), new File([x],'报价表.xlsx'), new File([p],'汇报.pptx')]);
  $('#prompt').value = '帮我读一下这三个文档，总结要点';
  App.send();
  await new Promise(z=>setTimeout(z, 3500));
  const m = State.current().messages;
  const tools = m.filter(x=>x.role==='tool').map(x=>x.name);
  return { tools, answers: m.filter(x=>x.role==='assistant').map(x=>x.content.slice(0,60)),
    hasRawJson: document.querySelector('#messages').innerText.indexOf('{"') >= 0 };
`);
if (r1.__exc) console.log('EXC1', r1.__exc);
else {
  P('读文档时不误触发生成工具', r1.tools.length === 0, JSON.stringify(r1.tools));
  P('给出合理解释而非乱生成', r1.answers.some(a=>/内容已经读进上下文|演示模型/.test(a)), JSON.stringify(r1.answers[0]));
  P('无原始 JSON', r1.hasRawJson === false);
}
await sleep(400);
await shot('k1-read.png');

// 场景 2：明确要生成 → 应该触发
const r2 = await run(`
  UI.newSession(); App.attachments = [];
  $('#prompt').value = '帮我做一份 Excel 报价表';
  App.send();
  await new Promise(z=>setTimeout(z, 4000));
  const m = State.current().messages;
  return { tools: m.filter(x=>x.role==='tool').map(x=>x.name), arts: Artifacts.length };
`);
if (r2.__exc) console.log('EXC2', r2.__exc);
else P('明确要求做表格时正常触发', r2.tools.includes('generate_xlsx'), JSON.stringify(r2.tools));

// 场景 3：无附件纯对话
const r3 = await run(`
  UI.newSession(); App.attachments = [];
  $('#prompt').value = '你好，介绍一下你自己';
  App.send();
  await new Promise(z=>setTimeout(z, 2500));
  const m = State.current().messages;
  return { tools: m.filter(x=>x.role==='tool').map(x=>x.name), ansLen: (m.find(x=>x.role==='assistant')||{}).content?.length || 0 };
`);
if (r3.__exc) console.log('EXC3', r3.__exc);
else {
  P('普通对话不触发工具', r3.tools.length === 0, JSON.stringify(r3.tools));
  P('有正常回复内容', r3.ansLen > 50, r3.ansLen + ' 字');
}
await sleep(400);
await shot('k2-normal.png');
console.log('=== 无异常 ===');
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
