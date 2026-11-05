// 模拟 OpenAI 兼容服务：按 system prompt 判断是哪个角色，返回对应的 tool_calls / 文本
import http from 'http';
const PORT = Number(process.argv[2] || 9601);
const log = [];
let reviewCount = 0;
let rejectFirstN = 0;
let mode = 'serial';
let delayMs = 0;
let inflight = 0, peakInflight = 0;
const srv = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Max-Age': '600'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.url.includes('/__reset')) {
    reviewCount = 0;
    const u = new URL(req.url, 'http://x');
    rejectFirstN = Number(u.searchParams.get('rejectFirst') || 0);
    mode = u.searchParams.get('mode') || 'serial';
    delayMs = Number(u.searchParams.get('delay') || 0);
    inflight = 0; peakInflight = 0;
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rejectFirstN, mode, delayMs }));
    return;
  }
  if (req.url.includes('/__log')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ calls: log, peakInflight, inflight }));
    return;
  }
  let body = '';
  for await (const c of req) body += c;
  let j = {};
  try { j = JSON.parse(body || '{}'); } catch { }
  const msgs = j.messages || [];
  const sys = (msgs[0] && msgs[0].content) || '';
  const user = (msgs.filter(m => m.role === 'user').pop() || {}).content || '';
  // 必须从开头的「你是「XXX」」提取，否则下级 prompt 里的「你的上级是「大领导」」会误判
  const nm = /^你是「([^」]+)」/.exec(sys.trim());
  const nodeName = nm ? nm[1] : '';
  const role = /质量检查员/.test(sys) ? 'inspector'
    : nodeName === '大领导' ? 'leader'
    : nodeName === '小领导' ? 'subleader'
    : nodeName === '小领导 B' ? 'subleader2'
    : nodeName === '执行者 A' ? 'workerA'
    : nodeName === '执行者 B' ? 'workerB'
    : 'unknown:' + nodeName;
  log.push({ role, nodeName, mode, hasToolResult: msgs.some(m => m.role === 'tool'), roles: msgs.map(m=>m.role), userHead: String(user).slice(0, 60), tools: (j.tools || []).map(t => t.function.name) });

  inflight++;
  peakInflight = Math.max(peakInflight, inflight);
  let released = false;
  const done = () => { if (!released) { released = true; inflight--; } };
  const send = async (obj) => {
    if (delayMs) await new Promise(r => setTimeout(r, delayMs));
    done();
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const text = (t) => send({ choices: [{ message: { role: 'assistant', content: t }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  const calls = (arr) => send({ choices: [{ message: { role: 'assistant', content: '', tool_calls: arr }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 100, completion_tokens: 50 } });

  // 是否已经拿到工具结果
  const hasToolResult = msgs.some(m => m.role === 'tool');

  if (role === 'inspector') {
    reviewCount++;
    if (reviewCount <= rejectFirstN) {
      return text('```json\n{"verdict":"reject","score":55,"reasons":["缺少具体数字","结论不够明确"],"mustFix":["补上三个方案的合计金额","给出明确推荐"]}\n```');
    }
    return text('{"verdict":"pass","score":92,"reasons":["结构清晰","数字齐全","结论明确"],"mustFix":[]}');
  }
  if (role === 'leader') {
    if (mode === 'flat_parallel') {
      if (hasToolResult) return text('已收到各下级交付，结论：A 方案最优，推荐主推。');
      return calls([{ id: 'f1', type: 'function', function: {
        name: 'dispatch_parallel',
        arguments: JSON.stringify({ tasks: [
          { agent_id: 'sub1', task: '做出三方案对比表并给出推荐' },
          { agent_id: 'sub2', task: '调研市场行情并给出定价建议' }
        ] })
      } }]);
    }
    if (mode === 'flat_serial') {
      const nn = msgs.filter(m => m.role === 'tool').length;
      if (nn === 0) return calls([{ id:'g1', type:'function', function:{ name:'dispatch_task',
        arguments: JSON.stringify({ agent_id:'sub1', task:'做出三方案对比表并给出推荐' }) } }]);
      if (nn === 1) return calls([{ id:'g2', type:'function', function:{ name:'dispatch_task',
        arguments: JSON.stringify({ agent_id:'sub2', task:'调研市场行情并给出定价建议' }) } }]);
      return text('已收到各下级交付，结论：A 方案最优，推荐主推。');
    }
    if (mode === 'serial2') {
      const n = msgs.filter(m => m.role === 'tool').length;
      if (n === 0) return calls([{ id:'s1', type:'function', function:{ name:'dispatch_task',
        arguments: JSON.stringify({ agent_id:'sub1', task:'做出三方案对比表并给出推荐', acceptance:'含合计' }) } }]);
      if (n === 1) return calls([{ id:'s2', type:'function', function:{ name:'dispatch_task',
        arguments: JSON.stringify({ agent_id:'sub2', task:'调研市场行情并给出定价建议', acceptance:'给出价格区间' }) } }]);
      return text('已收到各下级交付，结论：A 方案最优，推荐主推。');
    }
    if (hasToolResult) return text('已收到各下级交付，结论：A 方案最优，推荐主推。');
    if (mode === 'parallel') {
      return calls([{ id: 'c1', type: 'function', function: {
        name: 'dispatch_parallel',
        arguments: JSON.stringify({ tasks: [
          { agent_id: 'sub1', task: '做出三方案对比表并给出推荐', acceptance: '含合计与明确推荐' },
          { agent_id: 'sub2', task: '调研市场行情并给出定价建议', acceptance: '给出明确价格区间' }
        ] })
      } }]);
    }
    return calls([{ id: 'c1', type: 'function', function: { name: 'dispatch_task', arguments: JSON.stringify({ agent_id: 'sub1', task: '把三个方案的数据做成对比表，并给出推荐', acceptance: '含三个方案合计金额与明确推荐' }) } }]);
  }
  if (role === 'subleader2') {
    if (mode === 'flat_serial' || mode === 'flat_parallel') return text('市场调研结论：竞品定价区间 260–320 元/套，建议定在 300 元。');
    if (hasToolResult) return text('市场调研结论：竞品定价区间 260–320 元/套，建议我们定在 300 元。');
    return calls([{ id: 'c9', type: 'function', function: { name: 'send_message', arguments: JSON.stringify({ to: 'sub1', subject: '进度同步', body: '我这边在查行情，稍后把价格区间给你' }) } }]);
  }
  if (role === 'subleader') {
    // flat 模式：小领导自己就是叶子，不再往下派，便于做干净的串行/并行对比
    if (mode === 'flat_serial' || mode === 'flat_parallel') {
      return text('小领导汇总：合计金额 A 3600 / B 2400 / C 1500，推荐 A。');
    }
    if (hasToolResult) return text('小领导汇总：执行者 A 已完成对比表，合计金额 A 3600 / B 2400 / C 1500，推荐 A。');
    return calls([{ id: 'c2', type: 'function', function: { name: 'dispatch_task', arguments: JSON.stringify({ agent_id: 'w1', task: '算出三个方案的合计金额：A 12 套×300，B 8×300，C 5×300' }) } }]);
  }
  if (role === 'workerA') {
    if (hasToolResult) return text('执行者 A：A=3600，B=2400，C=1500');
    return calls([{ id: 'c3', type: 'function', function: { name: 'run_js', arguments: JSON.stringify({ code: 'return 12*300' }) } }]);
  }
  return text('（模拟响应）');
});
srv.listen(PORT, '127.0.0.1', () => console.log('mock llm on', PORT));
