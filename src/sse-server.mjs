// 假的 OpenAI 兼容 SSE 服务器：用来验证流式输出是否被中途截断
import http from 'http';
const PORT = Number(process.argv[2] || 9491);
const CHUNKS = Number(process.argv[3] || 300);
const delay = () => new Promise(r => setTimeout(r, 3));
const srv = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Max-Age': '600'
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  if (req.url.endsWith('/chat/completions')) {
    res.writeHead(200, { ...cors, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    // 先发一小段，再发很多小段
    for (let i = 0; i < CHUNKS; i++) {
      const piece = '段' + i + ' ';
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: piece } }] }) + '\n\n');
      await delay();
    }
    res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: CHUNKS * 2 } }) + '\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }
  res.writeHead(404, cors); res.end('no');
});
srv.listen(PORT, '127.0.0.1', () => console.log('SSE server on', PORT, 'chunks', CHUNKS));
