import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9391, prof = '/home/l/aaim-agent/.t9-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) { console.error('端口占用'); process.exit(2); } } catch {}
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

console.log('=== 1. 生成三种文档再用解析器读回（闭环） ===');
const rt = await ev(`
  const out = {};
  // Word
  const docxBlob = await buildDocx({
    title: '季度总结报告',
    headerText: '内部资料',
    blocks: [
      { type: 'h1', text: '一、概览' },
      { type: 'p', text: '本季度营收同比增长 23%，主要来自企业客户。' },
      { type: 'h2', text: '二、数据' },
      { type: 'table', headers: ['项目', '数量', '金额'], rows: [['A 方案', '12', '3600'], ['B 方案', '8', '2400']] },
      { type: 'ul', items: ['交付周期缩短', '客户满意度提升'] }
    ]
  });
  try {
    const r = await DocParser.read(new File([docxBlob], 'report.docx'), 'report.docx');
    out.docx = { ok: true, chars: r.text.length, meta: r.meta,
      hasTitle: r.text.includes('季度总结报告'), hasH1: r.text.includes('一、概览') || r.text.includes('# 一、概览'),
      hasBody: r.text.includes('同比增长 23%'), hasTable: r.text.includes('| A 方案') || r.text.includes('A 方案'),
      hasList: r.text.includes('交付周期缩短'), sample: r.text.slice(0, 200) };
  } catch (e) { out.docx = { ok: false, err: e.message }; }

  // Excel
  const xlsxBlob = await buildXlsx({ sheets: [
    { name: '报价', headers: ['方案', '套数', '单价', '小计'], rows: [['A', 12, 300, 3600], ['B', 8, 300, 2400], ['C', 5, 300, 1500]] },
    { name: '备注', headers: ['说明'], rows: [['含三年维护']] }
  ]});
  try {
    const r = await DocParser.read(new File([xlsxBlob], 'quote.xlsx'), 'quote.xlsx');
    out.xlsx = { ok: true, chars: r.text.length, meta: r.meta,
      hasSheet1: r.text.includes('报价'), hasSheet2: r.text.includes('备注'),
      hasHeader: r.text.includes('套数'), hasValue: r.text.includes('3600'),
      hasMarkdownTable: r.text.includes('| --- |'), sample: r.text.slice(0, 260) };
  } catch (e) { out.xlsx = { ok: false, err: e.message }; }

  // PPT
  const pptxBlob = await buildPptx({ title: '演示', slides: [
    { layout: 'title', title: '季度汇报', subtitle: '2026 Q3' },
    { title: '关键指标', bullets: ['营收增长 23%', '客户数达到 1200'], notes: '这里强调增长来源' },
    { title: '对比表', table: { headers: ['指标', '上季', '本季'], rows: [['营收', '100', '123']] } }
  ]});
  try {
    const r = await DocParser.read(new File([pptxBlob], 'deck.pptx'), 'deck.pptx');
    out.pptx = { ok: true, chars: r.text.length, meta: r.meta,
      pages: (r.text.match(/## 第 \\d+ 页/g) || []).length,
      hasCover: r.text.includes('季度汇报'), hasBullet: r.text.includes('营收增长 23%'),
      hasNotes: r.text.includes('这里强调增长来源'), hasTable: r.text.includes('本季'),
      noPageNoise: r.text.indexOf('2 / 3') < 0 && r.text.indexOf('3 / 3') < 0 && r.text.indexOf('> 备注：1') < 0,
      tableIsMarkdown: r.text.indexOf('| 指标 | 上季 | 本季 |') >= 0,
      sample: r.text.slice(0, 300) };
  } catch (e) { out.pptx = { ok: false, err: e.message }; }
  return out;
`);
if (rt.__exc) { console.log('EXC', rt.__exc); }
else {
  const d = rt.docx || {}, x = rt.xlsx || {}, p = rt.pptx || {};
  P('Word 解析成功', d.ok, d.err || `${d.chars} 字`);
  P('  ├ 标题 + 正文', d.hasTitle && d.hasBody, d.sample && JSON.stringify(d.sample.slice(0, 60)));
  P('  ├ 标题层级保留', d.hasH1);
  P('  └ 表格与列表', d.hasTable && d.hasList);
  P('Excel 解析成功', x.ok, x.err || `${x.chars} 字 / ${x.meta && x.meta.sheets} 表`);
  P('  ├ 两个工作表都读到', x.hasSheet1 && x.hasSheet2);
  P('  ├ 表头与数值', x.hasHeader && x.hasValue);
  P('  └ 输出 Markdown 表格', x.hasMarkdownTable);
  P('PPT 解析成功', p.ok, p.err || `${p.chars} 字 / ${p.meta && p.meta.slides} 页`);
  P('  ├ 页数正确(3)', p.pages === 3, 'pages=' + p.pages);
  P('  ├ 封面与要点', p.hasCover && p.hasBullet);
  P('  └ 表格与备注', p.hasTable && p.hasNotes);
  P('  ├ 页码不计入正文', p.noPageNoise);
  P('  └ 表格转成 Markdown', p.tableIsMarkdown);
  if (d.sample) console.log('\n--- Word 提取样例 ---\n' + d.sample);
  if (x.sample) console.log('\n--- Excel 提取样例 ---\n' + x.sample);
  if (p.sample) console.log('\n--- PPT 提取样例 ---\n' + p.sample);
}

console.log('=== 2. 错误处理 ===');
const err = await ev(`
  const out = {};
  const fake = new File([new Uint8Array([1,2,3,4])], 'bad.docx');
  try { await DocParser.read(fake, 'bad.docx'); out.badDocx = 'no-throw'; } catch(e) { out.badDocx = e.message.slice(0, 30); }
  const oldDoc = new File([new Uint8Array([1,2])], 'old.doc');
  try { await DocParser.read(oldDoc, 'old.doc'); out.oldDoc = 'no-throw'; } catch(e) { out.oldDoc = e.message; }
  const oldPpt = new File([new Uint8Array([1,2])], 'old.ppt');
  try { await DocParser.read(oldPpt, 'old.ppt'); out.oldPpt = 'no-throw'; } catch(e) { out.oldPpt = e.message; }
  out.hintDoc = DocParser.unsupportedHint('a.doc');
  out.hintZip = DocParser.unsupportedHint('a.zip');
  out.isOffice = [DocParser.isOffice('a.docx'), DocParser.isOffice('a.xlsx'), DocParser.isOffice('a.pptx'), DocParser.isOffice('a.png')];
  return out;
`);
P('损坏 docx 报错清楚', err && err.badDocx !== 'no-throw' && /docx|损坏|有效/.test(err.badDocx), err && err.badDocx);
P('旧版 .doc 给出转换指引', err && /另存为/.test(err.oldDoc), err && err.oldDoc);
P('旧版 .ppt 给出转换指引', err && /另存为/.test(err.oldPpt), err && err.oldPpt);
P('压缩包提示先解压', err && /解压/.test(err.hintZip), err && err.hintZip);
P('类型识别正确', err && JSON.stringify(err.isOffice) === '[true,true,true,false]', JSON.stringify(err && err.isOffice));

console.log('=== 3. 走完整附件链路（App.addFiles → 消息内容） ===');
const att = await ev(`
  localStorage.clear(); Artifacts.length = 0; UI.newSession(); App.attachments = [];
  const blob = await buildXlsx({ sheets:[{ name:'数据', headers:['k','v'], rows:[['a',1],['b',2]] }] });
  const f = new File([blob], 'demo.xlsx');
  await App.addFiles([f]);
  const a = App.attachments[0];
  const info = { count: App.attachments.length, name: a && a.name, chars: a && a.chars, meta: a && a.meta };
  // 模拟发送
  $('#prompt').value = '看看这个表';
  App.send();
  await new Promise(r=>setTimeout(r,600));
  const msg = State.current().messages.find(m=>m.role==='user');
  info.promptHasContent = !!(msg && /【附件：demo.xlsx】/.test(msg.content) && /k/.test(msg.content));
  info.filesTagged = !!(msg && msg.files && msg.files.length === 1);
  return info;
`);
P('附件被解析入库', att && att.count === 1 && att.chars > 0, JSON.stringify({ name: att && att.name, chars: att && att.chars, meta: att && att.meta }));
P('解析内容进入消息上下文', att && att.promptHasContent);
P('附件在消息上打标', att && att.filesTagged);

console.log('=== 4. 无异常 ===');
await sleep(400);
P('无未捕获异常', errs.length === 0, errs.slice(0,2).join(' | '));
ws.close(); edge.kill(); process.exit(0);
