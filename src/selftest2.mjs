import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9347, prof = '/home/l/aaim-agent/.test2-profile';
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
ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; } if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
const send = (m, p = {}) => new Promise(res => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
await send('Runtime.enable'); await send('Page.enable');
const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: `(async()=>{${e}})()`, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result?.exceptionDetails) return { __exc: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }; return r.result?.result?.value; };
const P = (n, ok, extra) => console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (extra ? '  :: ' + extra : ''));
await sleep(2000);

console.log('=== 1. 顶栏精简 ===');
const top = await ev(`
  const ids=[...document.querySelectorAll('#topbar button')].map(b=>b.id).filter(Boolean);
  return { ids, count: ids.length, hasSpec: !!document.querySelector('#btnSpec'), hasExport: !!document.querySelector('#btnExport'), hasClear: !!document.querySelector('#btnClear'), menu: !!document.querySelector('#moreMenu') };
`);
P('顶栏按钮收敛到 5 个可见', top && top.count <= 5, JSON.stringify(top.ids));
P('规格/导出/清空移入更多菜单', top && !top.hasSpec && !top.hasExport && !top.hasClear && top.menu);

console.log('=== 2. 长期记忆 ===');
const mem = await ev(`
  Memory.clear();
  const a = Memory.add('用户偏好中文回答，代码示例用 TypeScript', 'user');
  const b = Memory.add('用户偏好中文回答，代码示例用 TypeScript', 'user');  // 重复
  const c = Memory.add('项目在 ~/chinai3-win，做 Linux→Windows 移植', 'user');
  const count = Memory.count();
  const block = Memory.promptBlock();
  const sys = buildSystemPrompt();
  const hits = Memory.search('TypeScript', 5);
  const out = await Tools.exec('recall', { query: 'TypeScript' });
  const deny = await Tools.exec('forget', { keyword: '移植' });
  return { count, dupMerged: count === 2, blockHasHead: block.includes('长期记忆'), blockHasItem: block.includes('TypeScript'),
           sysHasMemory: sys.includes('长期记忆') && sys.includes('TSAI') === false, hits: hits.length, toolOk: out.ok, toolSays: out.summary.slice(0,30),
           afterForget: Memory.count() };
`);
P('写入去重（同内容不重复）', mem && mem.count === 2 && mem.dupMerged, 'count=' + (mem && mem.count));
P('注入系统提示的记忆块', mem && mem.blockHasHead && mem.blockHasItem && mem.sysHasMemory);
P('recall 工具可检索', mem && mem.toolOk && mem.hits > 0, mem && mem.toolSays);
P('forget 工具可删除', mem && mem.afterForget === 1, '剩余 ' + (mem && mem.afterForget) + ' 条');

const memTool = await ev(`
  const r = await Tools.exec('remember', { text: '回答保持在 200 字以内' });
  return { ok: r.ok, total: Memory.count(), display: r.display && r.display.kind };
`);
P('remember 工具写入生效', memTool && memTool.ok && memTool.total === 2, JSON.stringify(memTool));

console.log('=== 3. 工具调用折叠成一行 ===');
const fold = await ev(`
  Memory.clear();
  UI.newSession();
  const s = State.current();
  s.messages.push({role:'user', content:'搜一下 AI Agent', ts:Date.now()});
  s.messages.push({role:'assistant', content:'', thinking:'需要外部信息', tool_calls:[{id:'c1',name:'web_search',arguments:{query:'x'}},{id:'c2',name:'web_fetch',arguments:{url:'https://a.b'}},{id:'c3',name:'render_chart',arguments:{}}], step:1});
  s.messages.push({role:'tool', name:'web_search', tool_call_id:'c1', ok:true, ms:820, content:'r1', display:{kind:'search',provider:'deepseek',query:'x',results:[{n:1,title:'T',url:'https://a.b',snippet:'s',score:0.9}],errs:[]}});
  s.messages.push({role:'tool', name:'web_fetch', tool_call_id:'c2', ok:false, ms:1500, content:'r2', display:{kind:'fetch',url:'https://a.b',via:'direct',title:'T',chars:100}});
  s.messages.push({role:'tool', name:'render_chart', tool_call_id:'c3', ok:true, ms:900, content:'r3', display:{kind:'chart',title:'C',option:{}}});
  s.messages.push({role:'assistant', content:'## 结论\\n\\n三条要点。', step:2, tool_calls:[]});
  UI.renderMessages();
  await new Promise(r=>setTimeout(r,400));
  const det = document.querySelector('.msg.agent details.steps:not(.thinkbox)');
  const summ = det ? det.querySelector('summary').textContent : '';
  return { stepsCount: document.querySelectorAll('.msg.agent details.steps:not(.thinkbox)').length, collapsed: det ? !det.open : null, summ,
           msgCount: document.querySelectorAll('.msg').length };
`);
P('3 次工具调用合并为 1 个折叠区', fold && fold.stepsCount === 1, 'summ=' + (fold && fold.summ));
P('默认折叠', fold && fold.collapsed === true);
P('摘要含次数与耗时', fold && /3 个工具调用/.test(fold.summ) && /3\.2s|3s/.test(fold.summ), fold && fold.summ);
P('摘要标出失败数', fold && /1 个失败/.test(fold.summ), fold && fold.summ);
P('整个回合只占 2 条消息（你+回复）', fold && fold.msgCount === 2, JSON.stringify(fold && fold.msgCount));

console.log('=== 4. 本机文件（权限模型） ===');
const lf = await ev(`
  const supported = LocalFiles.supported();
  const list0 = LocalFiles.list();
  const t1 = await Tools.exec('local_list_files', {});
  const t2 = await Tools.exec('local_read_file', { name: 'x.txt' });
  // 伪造一个已授权文件来测读写链路（无法在无头环境弹系统选择框）
  const rec = { id: 'lfA', name: 'config.json', handle: null, size: 40, text: '{"debug": true, "port": 8080}', lastModified: Date.now() };
  LocalFiles.files.set('lfA', rec); LocalFiles.lastActiveId = 'lfA';
  const t3 = await Tools.exec('local_read_file', { name: 'config.json' });
  const t4 = await Tools.exec('local_write_file', { name: 'config.json', mode: 'patch', find: '"debug": true', replace: '"debug": false' });
  const t5 = await Tools.exec('local_write_file', { name: 'config.json', mode: 'replace', content: '{}' });
  return { supported, emptyListOk: t1.ok, readMissing: t2.ok, readOk: t3.ok, readData: (t3.data||'').slice(0,20),
           writePlanOk: t4.ok, diffAdd: t4.display && t4.display.diff.added, diffDel: t4.display && t4.display.diff.removed,
           planContent: t4.display && t4.display.content, replaceAlsoOk: t5.ok,
           notWritten: LocalFiles.find('config.json').text };
`);
P('浏览器支持检测（无头 Edge 应支持）', lf && lf.supported === true);
P('未授权时给用户明确指引', lf && lf.emptyListOk && lf.readMissing === false, 'readMissing.ok=' + (lf && lf.readMissing));
P('可读取已授权文件', lf && lf.readOk, lf && lf.readData);
P('patch 模式生成差异预览', lf && lf.writePlanOk && lf.diffAdd === 1 && lf.diffDel === 1, `+${lf && lf.diffAdd}/-${lf && lf.diffDel}`);
P('patch 结果内容正确', lf && lf.planContent === '{"debug": false, "port": 8080}', lf && lf.planContent);
P('★ 关键：未点击按钮时不落盘（安全模型）', lf && lf.notWritten === '{"debug": true, "port": 8080}', '文件仍为 ' + (lf && lf.notWritten));

console.log('=== 5. writeplan 卡片与写入按钮 ===');
const card = await ev(`
  const node = UI.displayNode({kind:'writeplan', fileId:'lfA', name:'config.json', mode:'patch', content:'{"debug": false, "port": 8080}',
    diff: LocalFiles.diff('{"debug": true, "port": 8080}', '{"debug": false, "port": 8080}')}, {name:'local_write_file'});
  document.querySelector('#messages').append(node);
  return { hasDiff: !!node.querySelector('.diff'), hasBtn: !!node.querySelector('button'), btnText: node.querySelector('.btn.primary').textContent,
           diffRows: node.querySelectorAll('.diff .dl').length, addRows: node.querySelectorAll('.diff .dl.add').length, delRows: node.querySelectorAll('.diff .dl.del').length };
`);
P('差异视图渲染（增删行高亮）', card && card.hasDiff && card.addRows === 1 && card.delRows === 1, `rows=${card && card.diffRows}`);
P('写入按钮存在且文案明确', card && card.hasBtn && card.btnText === '写入文件');

console.log('=== 6. 记忆/文件工具已注册 ===');
const reg = await ev(`return Tools.list().map(t=>t.name).sort()`);
P('工具总数 23', reg && reg.length === 23, '实际 ' + (reg && reg.length) + '：' + JSON.stringify(reg));
P('含 remember/recall/forget', reg && ['remember','recall','forget'].every(n => reg.includes(n)));
P('含 4 个本机文件工具', reg && ['local_list_files','local_read_file','local_write_file','local_save_as'].every(n => reg.includes(n)));

console.log('=== 7. 设置页新增两栏 ===');
const tabs = await ev(`
  const out={};
  for (const t of ['memory','local']) { Drawer.open(t); out[t]=document.querySelector('#drawerBody').children.length; }
  Drawer.close(); return out;
`);
P('记忆 / 本机文件设置页可渲染', tabs && tabs.memory > 0 && tabs.local > 0, JSON.stringify(tabs));

console.log('=== 8. 无异常 ===');
await sleep(500);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));

ws.close(); edge.kill(); process.exit(0);
