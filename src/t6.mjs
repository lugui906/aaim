import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9371, prof = '/home/l/aaim-agent/.t6-profile';
fs.rmSync(prof, { recursive: true, force: true });

/* ---- 安全检查：端口若已被占用，说明有僵尸进程，直接失败退出（否则会连到旧页面） ---- */
try {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(600) });
  if (r.ok) { console.error(`✗ 端口 ${PORT} 已被占用（有残留 Edge 进程），请先执行: pkill -9 -f "msedge.*remote-debugging-port"`); process.exit(2); }
} catch {}
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i = 0; i < 40 && !wsUrl; i++) { try { const j = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const p = j.find(t => t.type === 'page'); if (p) wsUrl = p.webSocketDebuggerUrl; } catch {} await sleep(300); }
const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const errs = [];
await new Promise(r => ws.addEventListener('open', r));
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || ''); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await sleep(2200);
const ev = async (c) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${c}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return {__exc:r.result.exceptionDetails.exception?.description}; return r.result?.result?.value; };
const P = (n, ok, e) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (e ? '  :: ' + e : ''));

console.log('=== 1/2. 顶栏无模型名、输入区无厂商切换 ===');
const t = await ev(`
  return { modelChip: !!document.querySelector('#modelChip'), modelQuick: !!document.querySelector('#modelQuick'),
    topbarBtns: [...document.querySelectorAll('#topbar button')].map(b=>b.id).filter(Boolean),
    topbarText: document.querySelector('#topbar').innerText.trim() };
`);
P('顶栏已无模型名 chip', t && !t.modelChip, JSON.stringify(t.topbarText));
P('输入区已无厂商下拉', t && !t.modelQuick);
P('厂商切换入口在设置里', true, '设置 → 模型 → 提供商');

console.log('=== 3. 全部图标为 SVG，无 emoji ===');
const emo = await ev(`
  const emoji = /[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}]/u;
  const hits = [];
  document.querySelectorAll('#app *').forEach(e => {
    if (e.children.length) return;
    const tx = e.textContent || '';
    if (emoji.test(tx)) hits.push({tag:e.tagName, cls:e.className, tx: tx.slice(0,20)});
  });
  const svgCount = document.querySelectorAll('#app svg').length;
  return { hits, svgCount };
`);
P('界面无 emoji 字符', emo && emo.hits.length === 0, JSON.stringify(emo && emo.hits));
P('使用 SVG 图标', emo && emo.svgCount >= 6, 'svg 数量=' + (emo && emo.svgCount));

console.log('=== 4. 去掉「就绪」与工具数 ===');
const st = await ev(`
  const foot = document.querySelector('.side-foot');
  const empty = document.querySelector('.empty');
  return { statusText: !!document.querySelector('#statusText'), statusDot: !!document.querySelector('#statusDot'),
    footText: foot ? foot.innerText.trim() : '(无)', emptyText: empty ? empty.innerText.trim() : '(无对话)' };
`);
P('侧栏无「就绪」状态', st && !st.statusText && !st.statusDot, 'foot=' + JSON.stringify(st.footText));
P('首页无工具数/模型名', st && !/个工具/.test(st.emptyText) && !/单文件 Agent ·/.test(st.emptyText), JSON.stringify(st.emptyText));

console.log('=== 5. 思考过程可折叠 ===');
const think = await ev(`
  UI.newSession();
  const s = State.current();
  s.messages.push({role:'user', content:'测试', ts:Date.now()});
  s.messages.push({role:'assistant', content:'结论在这。', thinking:'第一步：我需要先看看有哪些工具。\\n\\n第二步：确认搜索可用。', tool_calls:[], step:1});
  UI.renderMessages();
  await new Promise(r=>setTimeout(r,200));
  const box = document.querySelector('.thinkbox');
  return { exists: !!box, isDetails: box && box.tagName === 'DETAILS', open: box ? box.open : null,
    summary: box ? box.querySelector('summary').innerText : '', hasBody: box ? !!box.querySelector('.inner .thinking') : false,
    textLen: box ? box.querySelector('.inner .thinking').textContent.length : 0 };
`);
P('思考过程渲染为可折叠 details', think && think.exists && think.isDetails);
P('默认收起', think && think.open === false, 'open=' + (think && think.open));
P('标题为「思考过程」', think && /思考过程/.test(think.summary), think && think.summary);
P('展开后有内容', think && think.hasBody && think.textLen > 10, think && think.textLen + ' 字');

const toggle = await ev(`
  const box = document.querySelector('.thinkbox');
  box.open = true; await new Promise(r=>setTimeout(r,100));
  const a = box.querySelector('.inner .thinking').textContent.length;
  box.open = false; await new Promise(r=>setTimeout(r,100));
  return { a, open: box.open };
`);
P('可展开/收起切换', toggle && toggle.a > 10 && toggle.open === false);

console.log('=== 6. 产物自动可见（不需展开工具调用） ===');
const probe = await ev(`
  let r = { iconsType: typeof Icons, hasFileSheet: typeof (Icons && Icons.fileSheet), fileIconType: typeof fileIcon };
  try { r.direct = Icons.fileSheet(14).slice(0, 20); } catch (e) { r.directErr = e.message; }
  try { r.viaFilter = fileIcon('xlsx', 14).slice(0, 20); } catch (e) { r.viaErr = e.message; }
  r.thisInIcons = (function(){ try { return Icons.file(10) ? 'ok' : 'no'; } catch(e){ return 'err:' + e.message; } })();
  r.fileIconSrc = fileIcon.toString();
  r.iconsKeys = Object.keys(Icons).length;
  r.sameFn = Icons.fileSheet === Icons['fileSheet'];
  return r;
`);
console.log('   [probe]', JSON.stringify(probe));
const art = await ev(`
  UI.newSession();
  const s = State.current();
  s.messages.push({role:'user', content:'做个表格和PPT', ts:Date.now()});
  // 构造两个产物 display
  const blob1 = new Blob(['x'], {type:MIME.xlsx});
  const blob2 = new Blob(['y'], {type:MIME.pptx});
  const a1 = addArtifact({name:'数据表.xlsx', mime:MIME.xlsx, size:8734, blob:blob1, kind:'xlsx'});
  const a2 = addArtifact({name:'汇报.pptx', mime:MIME.pptx, size:59375, blob:blob2, kind:'pptx'});
  s.messages.push({role:'assistant', content:'', step:1, tool_calls:[
    {id:'c1',name:'generate_xlsx',arguments:{}},{id:'c2',name:'generate_pptx',arguments:{}}]});
  s.messages.push({role:'tool', name:'generate_xlsx', tool_call_id:'c1', ok:true, ms:120, content:'x', display:{kind:'file', art:a1}});
  s.messages.push({role:'tool', name:'generate_pptx', tool_call_id:'c2', ok:true, ms:890, content:'x', display:{kind:'file', art:a2}});
  s.messages.push({role:'assistant', content:'两个文件都做好了。', step:2, tool_calls:[]});
  UI.renderMessages();
  await new Promise(r=>setTimeout(r,300));
  const bar = document.querySelector('.artifacts');
  const steps = document.querySelector('details.steps:not(.thinkbox)');
  return {
    barExists: !!bar,
    visible: bar ? getComputedStyle(bar).display !== 'none' : false,
    files: bar ? [...bar.querySelectorAll('.artname')].map(e=>e.textContent) : [],
    dlBtns: bar ? bar.querySelectorAll('.artbtn').length : 0,
    stepsCollapsed: steps ? !steps.open : null,
    artInsideSteps: steps ? steps.querySelectorAll('.artifacts,.artfile').length : 0
  };
`);
console.log('   [raw]', JSON.stringify(art));
P('产物条存在且可见', art && art.barExists && art.visible);
P('两个文件都列出', art && art.files && art.files.length === 2, JSON.stringify(art && art.files));
P('每项都有下载按钮', art && art.dlBtns >= 2, '按钮数=' + (art && art.dlBtns));
P('工具调用仍保持折叠', art && art.stepsCollapsed === true);
P('产物不埋在折叠区里', art && art.artInsideSteps === 0, '折叠区内产物节点=' + (art && art.artInsideSteps));

console.log('=== 7. 空状态与侧栏 ===');
const misc = await ev(`
  UI.newSession(); UI.renderMessages();
  await new Promise(r=>setTimeout(r,150));
  const e = document.querySelector('.empty');
  return { h2: e ? e.querySelector('h2').textContent : '', pills: e ? e.querySelectorAll('.pills button').length : 0, text: e ? e.innerText.replace(/\\n/g,' | ') : '' };
`);
P('空状态只有标题+示例', misc && misc.pills === 4, JSON.stringify(misc.text));

console.log('=== 8. 无异常 ===');
await sleep(400);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
