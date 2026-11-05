import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9505, prof = "/home/l/aaim-agent/.t25-profile", OUT="/home/l/aaim-agent/shots";
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, '--user-data-dir=' + prof, '--no-first-run', '--disable-gpu', '--force-device-scale-factor=2', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=20000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await send('Page.enable'); await sleep(2500);
const run = async (expr, ms=20000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));
const shot = async (n) => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(OUT + '/' + n, Buffer.from(s.result.data, 'base64')); };

console.log('=== 1. 首页企业模式入口 ===');
const home = await run(`
  localStorage.clear();
  State.org = Org.defaults(); Org.save();
  UI.newSession(); UI.renderMessages();
  await new Promise(z=>setTimeout(z, 300));
  const cta = document.querySelector('.org-cta');
  return { hasCta: !!cta, ctaText: cta ? cta.innerText.replace(/\\n/g,' | ') : null,
    h2: document.querySelector('.empty h2').textContent };
`, 12000);
console.log(JSON.stringify(home));
P('首页有「开启企业模式」入口', home && home.hasCta === true, home && home.ctaText);
P('入口说明清楚', home && /多.*Agent|拆解/.test(home.ctaText || ''));

const clickCta = await run(`
  document.querySelector('.org-cta').click();
  await new Promise(z=>setTimeout(z, 500));
  return { enabled: State.org.enabled, body: document.body.className,
    chip: document.querySelector('#modeChipText').textContent,
    orgGoalVisible: !!document.querySelector('#orgGoal') && getComputedStyle(document.querySelector('#orgComposer')).display !== 'none' };
`, 12000);
console.log(JSON.stringify(clickCta));
P('点入口即进入企业模式', clickCta && clickCta.enabled === true && /org-mode/.test(clickCta.body));
P('切换到团队输入框', clickCta && clickCta.orgGoalVisible === true);
await sleep(400);
await shot('org4-home-cta.png');

console.log('=== 2. 工具结果「交给团队」 ===');
const tool = await run(`
  // 回到普通模式，造一条带搜索结果的工具消息
  State.org.enabled = false; Org.save(); OrgUI.applyMode(false);
  UI.newSession();
  const s = State.current();
  State.orgAttachments = [];
  s.messages.push({role:'user', content:'搜一下', ts:Date.now()});
  s.messages.push({role:'tool', name:'web_search', tool_call_id:'c1', ok:true, ms:120, content:'x',
    display:{kind:'search', provider:'deepseek', query:'AI Agent', results:[
      {n:1,title:'标题一',url:'https://a.example/1',snippet:'摘要一内容',score:0.9},
      {n:2,title:'标题二',url:'https://a.example/2',snippet:'摘要二内容',score:0.8}]}});
  s.messages.push({role:'assistant', content:'结果如上', step:1, tool_calls:[]});
  UI.renderMessages();
  await new Promise(z=>setTimeout(z, 400));
  const btn = document.querySelector('.org-send');
  const hasBtn = !!btn;
  if (btn) btn.click();
  await new Promise(z=>setTimeout(z, 700));
  const att = State.orgAttachments || [];
  return { hasBtn, btnText: btn ? btn.innerText : null,
    attCount: att.length, attName: att[0] && att[0].name,
    attHasSnippet: att[0] ? /摘要一内容/.test(att[0].text) : false,
    attText: att[0] ? att[0].text.slice(0, 120) : null,
    switchedToOrg: !!(State.org && State.org.enabled),
    chipVisible: document.querySelectorAll('#orgAttach .a').length
  };
`, 15000);
console.log(JSON.stringify(tool, null, 1));
P('工具卡片有「交给团队」按钮', tool && tool.hasBtn === true, tool && tool.btnText);
P('★ 工具结果作为材料附加', tool && tool.attCount === 1 && tool.attHasSnippet === true, tool && tool.attName);
P('自动切到企业模式并显示材料', tool && tool.switchedToOrg && tool.chipVisible === 1);
await sleep(400);
await shot('org5-tool-attach.png');

console.log('=== 3. 组织树交互 ===');
const tree = await run(`
  const before = Org.all().length;
  // 给大领导加一个小领导
  Org.add({ role:'subleader', parentId:'leader', name:'小领导 B' });
  OrgUI.render();
  await new Promise(z=>setTimeout(z, 300));
  const names = [...document.querySelectorAll('.orgnode .org-name')].map(e=>e.textContent);
  return { before, after: Org.all().length, names,
    hasMini: document.querySelectorAll('.org-mini').length > 0,
    unread: document.querySelectorAll('.org-unread').length };
`, 12000);
console.log(JSON.stringify(tree));
P('可以添加嵌套小领导', tree && tree.after === tree.before + 1 && tree.names.includes('小领导 B'));
P('树上有操作按钮', tree && tree.hasMini === true);
await sleep(300);
await shot('org6-tree.png');

console.log('=== 4. 无异常 ===');
P('无未捕获异常', errs.length === 0, errs.slice(0,3).join(' | '));
ws.close(); edge.kill(); process.exit(0);
