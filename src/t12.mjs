import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9395, prof = '/home/l/aaim-agent/.t12-profile', OUT = '/home/l/aaim-agent/shots';
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

// 场景：三个办公文档 + 发送，等演示模型回复
const r = await ev(`
  localStorage.clear(); Artifacts.length = 0; State.sessions = []; State.currentId = '';
  UI.newSession(); App.attachments = [];
  const d = await buildDocx({ title: '季度总结报告', blocks: [{type:'h1',text:'一、概览'},{type:'p',text:'营收同比增长 23%。'}] });
  const x = await buildXlsx({ sheets:[{ name:'报价', headers:['方案','小计'], rows:[['A',3600]] }] });
  const p = await buildPptx({ slides:[{layout:'title',title:'季度汇报',subtitle:'2026 Q3'}] });
  await App.addFiles([new File([d],'季度总结报告.docx'), new File([x],'报价表.xlsx'), new File([p],'汇报.pptx')]);
  $('#prompt').value = '帮我读一下这三个文档，总结要点';
  App.send();
  await new Promise(z=>setTimeout(z, 400));
  const t = document.querySelector('#toasts');
  const cs = t && t.firstElementChild ? getComputedStyle(t.firstElementChild) : null;
  return { msgCount: document.querySelectorAll('.msg').length,
    toastCount: t ? t.children.length : 0,
    toastBg: cs ? cs.backgroundColor : null,
    toastH: t && t.firstElementChild ? Math.round(t.firstElementChild.getBoundingClientRect().height) : null,
    hasIcon: t && t.firstElementChild ? !!t.firstElementChild.querySelector('svg') : null,
    overlay: (()=>{const el=document.elementFromPoint(700, 500); return el? el.tagName+'.'+String(el.className).slice(0,20):null})() };
`);
if (r.__exc) console.log('EXC', r.__exc);
else {
  P('提示条改为深色克制样式', r.toastBg && /26, 22, 21|rgba\(26/.test(r.toastBg), r.toastBg);
  P('带类型图标', r.hasIcon === true);
  P('高度紧凑(<40px)', r.toastH < 40, r.toastH + 'px');
  P('不再遮挡正文', r.overlay !== null, r.overlay);
}
await sleep(600);
await shot('i3-toast.png');
await sleep(2400);
await shot('i4-after-toast.png');
console.log('=== 无异常 ===');
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
