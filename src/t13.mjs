import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9399, prof = '/home/l/aaim-agent/.t13-profile', OUT = '/home/l/aaim-agent/shots';
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

const r = await run(`
  localStorage.clear(); Artifacts.length = 0; State.sessions = []; State.currentId = '';
  UI.newSession(); App.attachments = [];
  const d = await buildDocx({ title: '季度总结报告', blocks: [{type:'h1',text:'一、概览'},{type:'p',text:'营收同比增长 23%。'}] });
  const x = await buildXlsx({ sheets:[{ name:'报价', headers:['方案','小计'], rows:[['A',3600]] }] });
  const p = await buildPptx({ slides:[{layout:'title',title:'季度汇报',subtitle:'2026 Q3'}] });
  await App.addFiles([new File([d],'季度总结报告.docx'), new File([x],'报价表.xlsx'), new File([p],'汇报.pptx')]);
  $('#prompt').value = '帮我读一下这三个文档，总结要点';
  App.send();
  await new Promise(z=>setTimeout(z, 3500));
  const u = document.querySelector('.msg.user');
  const kids = [...u.querySelector('.body').children].map(e => ({cls:String(e.className).slice(0,20), y:Math.round(e.getBoundingClientRect().y)}));
  const att = u.querySelector('.attach.files');
  const bubble = u.querySelector('.bubble');
  const txt = document.querySelector('#messages').innerText;
  return {
    order: kids.map(k=>k.cls),
    bubbleY: Math.round(bubble.getBoundingClientRect().y),
    attY: att ? Math.round(att.getBoundingClientRect().y) : null,
    attW: att ? Math.round(att.getBoundingClientRect().width) : null,
    attRight: att ? Math.round(att.getBoundingClientRect().right) : null,
    bubbleRight: Math.round(bubble.getBoundingClientRect().right),
    chipCount: att ? att.querySelectorAll('.a').length : 0,
    hasRawJson: txt.indexOf('"filename"') >= 0 || txt.indexOf('{"') >= 0,
    hasSummary: txt.indexOf('generate_docx：已生成 Word 文档') >= 0
  };
`);
if (r.__exc) console.log('EXC', r.__exc);
else {
  P('附件卡片在气泡下方', r.order[0] === 'bubble' && r.order[1].indexOf('attach') === 0, JSON.stringify(r.order));
  P('位置实测：气泡在上', r.bubbleY < r.attY, `bubbleY=${r.bubbleY} attY=${r.attY}`);
  P('附件右对齐（与气泡右边缘对齐）', Math.abs(r.attRight - r.bubbleRight) < 2, `att=${r.attRight} bubble=${r.bubbleRight}`);
  P('三个附件都在', r.chipCount === 3);
  P('附件卡宽度受限(<520)', r.attW < 520, r.attW + 'px');
  P('不再把原始 JSON 贴进回复', r.hasRawJson === false, 'hasRawJson=' + r.hasRawJson);
  P('摘要仍然可读', r.hasSummary === true);
}
await sleep(500);
await shot('j1-final.png');
console.log('=== 无异常 ===');
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
