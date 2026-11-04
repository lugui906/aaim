import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9392, prof = '/home/l/aaim-agent/.t10-profile', OUT = '/home/l/aaim-agent/shots';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map();
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return {__exc:r.result.exceptionDetails.exception?.description}; return r.result?.result?.value; };
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };
await sleep(2200);

// 构造带三个办公文档附件的消息并截图
const r = await ev(`
  localStorage.clear(); Artifacts.length = 0; State.sessions = []; State.currentId = ''; UI.updateHeader();
  UI.newSession(); App.attachments = [];
  const d = await buildDocx({ title: '季度总结报告', blocks: [{type:'h1',text:'一、概览'},{type:'p',text:'本季度营收同比增长 23%。'},{type:'table',headers:['项目','金额'],rows:[['A','3600']]}] });
  const x = await buildXlsx({ sheets:[{ name:'报价', headers:['方案','套数','小计'], rows:[['A',12,3600],['B',8,2400]] }] });
  const p = await buildPptx({ slides:[{layout:'title',title:'季度汇报',subtitle:'2026 Q3'},{title:'关键指标',bullets:['营收增长 23%']}] });
  await App.addFiles([
    new File([d], '季度总结报告.docx'),
    new File([x], '报价表.xlsx'),
    new File([p], '汇报.pptx')
  ]);
  const info = App.attachments.map(a => ({ name: a.name, chars: a.chars, kind: a.docKind }));
  $('#prompt').value = '帮我读一下这三个文档，总结要点';
  App.send();
  await new Promise(z => setTimeout(z, 1200));
  const msg = State.current().messages.find(m => m.role === 'user');
  return { info, hasAll: /季度总结报告.docx/.test(msg.content) && /报价表.xlsx/.test(msg.content) && /汇报.pptx/.test(msg.content),
    hasTable: /\\| 项目 \\| 金额 \\|/.test(msg.content), hasSheet: /工作表：报价/.test(msg.content), hasSlide: /第 1 页/.test(msg.content),
    len: msg.content.length, files: msg.files };
`);
if (r.__exc) console.log('EXC', r.__exc);
else {
  console.log('  附件:', JSON.stringify(r.info));
  console.log((r.hasAll && r.hasTable && r.hasSheet && r.hasSlide ? 'PASS  ' : 'FAIL  ') + ' 三个办公文档全部解析进上下文', JSON.stringify({ hasAll: r.hasAll, hasTable: r.hasTable, hasSheet: r.hasSheet, hasSlide: r.hasSlide, len: r.len }));
}
await sleep(800);
await shot('h1-attach.png');
ws.close(); edge.kill(); process.exit(0);
