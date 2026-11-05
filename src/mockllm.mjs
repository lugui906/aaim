// 模拟 OpenAI 兼容服务：按 system prompt 判断是哪个角色，返回对应的 tool_calls / 文本
import http from 'http';
const PORT = Number(process.argv[2] || 9601);
const log = [];
let reviewCount = 0;
let rejectFirstN = 0;
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
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rejectFirstN }));
    return;
  }
  if (req.url.includes('/__log')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ calls: log }));
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
    : nodeName === '执行者 A' ? 'workerA'
    : nodeName === '执行者 B' ? 'workerB'
    : 'unknown:' + nodeName;
  log.push({ role, nodeName, sysHead: sys.slice(0, 60), userHead: String(user).slice(0, 80), tools: (j.tools || []).map(t => t.function.name) });

  const send = (obj) => {
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
    if (hasToolResult) return text('已收到小领导交付的《季度对比表》，结论：A 方案最优，推荐主推。');
    return calls([{ id: 'c1', type: 'function', function: { name: 'dispatch_task', arguments: JSON.stringify({ agent_id: 'sub1', task: '把三个方案的数据做成对比表，并给出推荐', acceptance: '含三个方案合计金额与明确推荐' }) } }]);
  }
  if (role === 'subleader') {
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
