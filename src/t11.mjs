import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9394, prof = '/home/l/aaim-agent/.t11-profile', OUT = '/home/l/aaim-agent/shots';
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
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return {__exc:r.result.exceptionDetails.exception?.description}; return r.result?.result?.value; };
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };
await sleep(2200);

console.log('=== 1. 用户气泡不再渲染附件全文 ===');
const r1 = await ev(`
  localStorage.clear(); Artifacts.length = 0; State.sessions = []; State.currentId = '';
  UI.newSession(); App.attachments = [];
  const d = await buildDocx({ title: '季度总结报告', blocks: [{type:'h1',text:'一、概览'},{type:'p',text:'营收同比增长 23%。'}] });
  const x = await buildXlsx({ sheets:[{ name:'报价', headers:['方案','小计'], rows:[['A',3600]] }] });
  const p = await buildPptx({ slides:[{layout:'title',title:'季度汇报',subtitle:'2026 Q3'},{title:'关键指标',bullets:['营收增长 23%']}] });
  await App.addFiles([new File([d],'季度总结报告.docx'), new File([x],'报价表.xlsx'), new File([p],'汇报.pptx')]);
  $('#prompt').value = '帮我读一下这三个文档，总结要点';
  App.send();
  await new Promise(z=>setTimeout(z, 900));
  const m = State.current().messages.find(x=>x.role==='user');
  const b = document.querySelector('.msg.user .bubble');
  return {
    contentLen: m.content.length, display: m.display,
    bubbleText: b ? b.innerText.trim() : '',
    bubbleHeadings: b ? b.querySelectorAll('h1,h2,h3').length : 0,
    bubbleTables: b ? b.querySelectorAll('table').length : 0,
    bubbleH: b ? Math.round(b.getBoundingClientRect().height) : 0,
    stillHasFull: m.content.indexOf('【附件：') >= 0
  };
`);
if (r1.__exc) console.log('EXC', r1.__exc);
else {
  P('气泡只显示用户原话', r1.bubbleText === '帮我读一下这三个文档，总结要点', JSON.stringify(r1.bubbleText));
  P('气泡内无标题', r1.bubbleHeadings === 0);
  P('气泡内无表格', r1.bubbleTables === 0);
  P('气泡高度回归正常(<80px)', r1.bubbleH < 80, r1.bubbleH + 'px');
  P('上下文仍保留附件全文(给模型)', r1.stillHasFull && r1.contentLen > 150, 'content=' + r1.contentLen + ' 字');
}

console.log('=== 2. Toast 不遮挡输入框 ===');
const r2 = await ev(`
  const t = document.querySelector('#toasts');
  const box = document.querySelector('#composer').getBoundingClientRect();
  const tr = t ? t.getBoundingClientRect() : null;
  return { count: t ? t.children.length : 0,
    toastBottom: tr ? Math.round(tr.bottom) : null,
    composerTop: Math.round(box.top),
    overlap: tr ? tr.bottom > box.top + 1 : null,
    texts: t ? [...t.children].map(c=>c.innerText.slice(0,40)) : [] };
`);
P('toast 数量受限(≤3)', r2 && r2.count <= 3, 'count=' + (r2 && r2.count));
P('toast 底部不超过输入框顶部', r2 && r2.overlap === false, `toastBottom=${r2 && r2.toastBottom} composerTop=${r2 && r2.composerTop}`);
P('三个附件合并为一条提示', r2 && r2.count <= 2 && r2.texts.some(x=>/3 个文件/.test(x)), JSON.stringify(r2 && r2.texts));

console.log('=== 3. 演示模型不被附件关键词带偏 ===');
const r3 = await ev(`
  const m = State.current().messages;
  const tools = m.filter(x=>x.role==='tool').map(x=>x.name);
  return { tools };
`);
P('没有误触发 generate_xlsx', r3 && !r3.tools.includes('generate_xlsx'), JSON.stringify(r3 && r3.tools));

console.log('=== 4. 旧数据兼容（无 display 字段） ===');
const r4 = await ev(`
  UI.newSession();
  const s = State.current();
  const NL = String.fromCharCode(10);
  s.messages.push({role:'user', content:'看看这个' + NL + NL + '【附件：a.docx】' + NL + '# 标题' + NL + '正文内容', ts:Date.now()});
  s.messages.push({role:'assistant', content:'好的。', step:1, tool_calls:[]});
  UI.renderMessages();
  await new Promise(z=>setTimeout(z,200));
  const b = document.querySelector('.msg.user .bubble');
  return { text: b.innerText.trim(), headings: b.querySelectorAll('h1,h2,h3').length,
    rawContent: JSON.stringify(s.messages[0].content), displayVal: String(s.messages[0].display),
    helper: UI.userDisplayText(s.messages[0]) };
`);
console.log('   [r4]', JSON.stringify(r4));
P('旧消息剥离附件段', r4 && r4.text === '看看这个' && r4.headings === 0, JSON.stringify(r4 && r4.text));

await sleep(500);
await shot('i2-fixed.png');
console.log('=== 5. 无异常 ===');
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
