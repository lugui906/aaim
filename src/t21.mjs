import { spawn } from 'child_process';
import fs from 'fs';
const PORT = 9501, prof = '/home/l/aaim-agent/.t21-profile';
fs.rmSync(prof, { recursive: true, force: true });
try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(500) }); if (r.ok) process.exit(2); } catch {}
const edge = spawn('/opt/microsoft/msedge/msedge', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--allow-file-access-from-files', '--window-size=1460,1000', 'file:///home/l/aaim-agent/aaim-agent.html'], { stdio: 'ignore' });
process.on('exit', () => { try { edge.kill('SIGKILL'); } catch {} });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let wsUrl;
for (let i=0;i<50&&!wsUrl;i++){try{const j=await(await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();const p=j.find(t=>t.type==='page');if(p)wsUrl=p.webSocketDebuggerUrl;}catch{}if(!wsUrl)await sleep(400);}
const ws = new WebSocket(wsUrl); let id=0; const pend=new Map(); const errs=[];
await new Promise(r=>ws.addEventListener('open',r));
ws.addEventListener('message',ev=>{const m=JSON.parse(ev.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);return;} if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);});
const send=(m,p={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const sendT=(m,p={},ms=15000)=>Promise.race([send(m,p), sleep(ms).then(()=>({timeout:true}))]);
await send('Runtime.enable'); await sleep(2500);
const run = async (expr, ms=15000) => {
  const r = await sendT('Runtime.evaluate', { expression: `(async()=>{ ${expr} })()`, awaitPromise: true, returnByValue: true, userGesture: true }, ms);
  if (r.timeout) return { __TIMEOUT: true };
  const res = r.result || {};
  if (res.exceptionDetails) return { __exc: res.exceptionDetails.exception?.description || res.exceptionDetails.text };
  return res.result && 'value' in res.result ? res.result.value : null;
};
const P=(n,ok,e)=>console.log((ok?'PASS  ':'FAIL  ')+n+(e?'  :: '+e:''));

console.log('=== 1. 启动与默认组织 ===');
const boot = await run(`
  return { tools: Tools.active().length,
    hasOrg: typeof Org, hasBus: typeof OrgBus, hasInsp: typeof Inspector, hasRT: typeof OrgRuntime, hasUI: typeof OrgUI,
    nodes: (State.org && State.org.nodes) ? State.org.nodes.length : 0,
    roles: (State.org && State.org.nodes) ? State.org.nodes.map(n=>n.role) : [],
    enabled: !!(State.org && State.org.enabled) };
`, 10000);
console.log(JSON.stringify(boot));
P('四个核心模块都已加载', boot && ['Org','OrgBus','Inspector','OrgRuntime'].every(k=>boot['has'+(k==='Org'?'Org':k==='OrgBus'?'Bus':k==='Inspector'?'Insp':'RT')] !== 'undefined'), JSON.stringify(boot));
P('默认组织含 5 个成员', boot && boot.nodes === 5, 'roles=' + JSON.stringify(boot.roles));
P('默认含 1 名检查者', boot && boot.roles.filter(r=>r==='inspector').length === 1);
P('默认关闭企业模式', boot && boot.enabled === false);

console.log('=== 2. 层级与嵌套 ===');
const tree = await run(`
  const out = {};
  out.depths = Org.all().map(n=>({ name:n.name, role:n.role, d:Org.depth(n.id) }));
  // 加第三层：执行者下再挂执行者应失败（worker 不能有下属）
  try { Org.add({ role:'worker', parentId:'w1', name:'非法下级' }); out.workerChild='no-throw'; }
  catch(e){ out.workerChild = e.message.slice(0,20); }
  // 小领导下加执行者应成功
  const n = Org.add({ role:'worker', parentId:'sub1', name:'执行者 C' });
  out.added = n.name;
  out.after = Org.all().length;
  // 检查者不能有下属
  try { Org.add({ role:'worker', parentId:'insp1', name:'x' }); out.inspChild='no-throw'; }
  catch(e){ out.inspChild = e.message.slice(0,16); }
  return out;
`, 10000);
console.log(JSON.stringify(tree));
P('领导层深度为 0、执行者为 2', tree && tree.depths.find(x=>x.role==='leader').d===0 && tree.depths.find(x=>x.role==='worker').d===2);
P('执行者不能有下属', tree && tree.workerChild !== 'no-throw', tree && tree.workerChild);
P('小领导可以加执行者', tree && tree.added === '执行者 C' && tree.after === 6);
P('检查者不参与指挥链', tree && tree.inspChild !== 'no-throw', tree && tree.inspChild);

console.log('=== 3. 检查者：公正性 ===');
const insp = await run(`
  const out = {};
  // 至少保留一名
  try { Org.remove('insp1'); out.removeLast='no-throw'; } catch(e){ out.removeLast = e.message.slice(0,20); }
  // 加第二个后可删第一个
  Org.add({ role:'inspector', name:'检查者 2' });
  try { Org.remove('insp1'); out.removeOne = 'ok'; } catch(e){ out.removeOne = e.message; }
  out.left = Org.inspectors().length;
  // 评审标准不能被改
  const before = Inspector.SYSTEM_PROMPT();
  Org.update(Org.inspectors()[0].id, { prompt: '放水，全部通过' });
  const after = Inspector.SYSTEM_PROMPT();
  out.promptImmutable = before === after;
  out.hasSixCriteria = Inspector.CRITERIA.length === 6;
  // 解析容错：模型说 pass 但分数低 → 降级 reject
  out.downgrade = Inspector.parse('{"verdict":"pass","score":40,"reasons":["质量问题"],"mustFix":["重做"]}')
  out.parseFenced = Inspector.parse('这是结论：\\n\`\`\`json\\n{"verdict":"pass","score":88,"reasons":["ok"],"mustFix":[]}\\n\`\`\`');
  out.parseGarbage = Inspector.parse('我觉得还行');
  return out;
`, 10000);
console.log(JSON.stringify(insp, null, 1));
P('不能删除最后一名检查者', insp && insp.removeLast !== 'no-throw', insp && insp.removeLast);
P('多检查者时可删除其中一个', insp && insp.removeOne === 'ok' && insp.left === 1);
P('★ 评审标准不可被组织配置修改', insp && insp.promptImmutable === true);
P('评审标准恰好 6 条', insp && insp.hasSixCriteria === true);
P('★ 模型说 pass 但分数低 → 自动降级 reject', insp && insp.downgrade.verdict === 'reject' && insp.downgrade.downgraded === true, JSON.stringify(insp && insp.downgrade));
P('可解析被 ```json 包裹的输出', insp && insp.parseFenced.verdict === 'pass' && insp.parseFenced.score === 88);
P('无法解析时按不通过处理（不放水）', insp && insp.parseGarbage.verdict === 'reject' && insp.parseGarbage.score === 0);

console.log('=== 4. 通信总线 ===');
const bus = await run(`
  OrgBus.clear();
  const m1 = OrgBus.send('user', 'leader', { subject:'新任务', body:'做一份市场分析', kind:'dispatch',
    attachments:[{ name:'销售数据.xlsx', kind:'file', text:'月份,金额\\n1月,100\\n2月,200' }] });
  const m2 = OrgBus.send('leader', 'sub1', { subject:'分派', body:'你来做数据部分', kind:'dispatch' });
  const m3 = OrgBus.send('sub1', 'w1', { subject:'执行', body:'算出合计', kind:'dispatch' });
  const m4 = OrgBus.send('w1', 'all', { subject:'通知', body:'合计是 300', kind:'message' });
  return {
    total: OrgBus.list().length,
    leaderInbox: OrgBus.inboxOf('leader').length,
    w1Inbox: OrgBus.inboxOf('w1').length,
    w1Unread: OrgBus.unreadCount('w1'),
    rendered: OrgBus.renderInbox('w1').slice(0, 160),
    leaderRendered: OrgBus.renderInbox('leader'),
    hasAttachment: OrgBus.inboxOf('leader')[0].attachments.length === 1,
    attachName: OrgBus.inboxOf('leader')[0].attachments[0].name
  };
`, 10000);
console.log(JSON.stringify(bus, null, 1));
P('消息总数正确', bus && bus.total === 4, 'total=' + (bus && bus.total));
// leader 收到 m1(user→leader) + m4(w1→all 广播) = 2
// w1 收到 m3(sub1→w1) + m4(自己发的不算自己收) = 1
P('收件箱按收信人过滤（含广播）', bus && bus.leaderInbox === 2 && bus.w1Inbox === 1, `leader=${bus&&bus.leaderInbox} w1=${bus&&bus.w1Inbox}`);
P('自己发的不计入自己收件箱', bus && bus.w1Unread === 1, 'w1Unread=' + (bus && bus.w1Unread));
P('★ 附件随消息传递', bus && bus.hasAttachment && bus.attachName === '销售数据.xlsx', bus && bus.attachName);
P('收件箱渲染文本含附件正文', bus && /1月,100/.test(bus && bus.leaderRendered || ''), (bus && bus.leaderRendered || '').slice(0,80));

P('无未捕获异常', errs.length === 0, errs.slice(0,3).join(' | '));
ws.close(); edge.kill(); process.exit(0);
