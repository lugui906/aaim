/* ============ 01 状态 / 默认配置 / 会话模型 ============ */
const APP = { name: 'Aaim Agent', version: '1.0.0', build: '2026-11' };

const PROVIDERS = {
  mock: {
    label: '内置演示模型（无需 Key）', style: 'mock', defaultBase: '', models: ['demo-agent'],
    hint: '本地模拟：会真实触发工具调用（搜索/文档/图表/沙箱），用于离线体验与自检。'
  },
  openai: {
    label: 'OpenAI 兼容', style: 'openai', defaultBase: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'], hint: '浏览器直连通常被 CORS 拦，需在下方填代理地址。'
  },
  deepseek: {
    label: 'DeepSeek', style: 'openai', defaultBase: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'], hint: '官方 API 不支持浏览器跨域直连，需代理；搜索/抓取走同一 Key。'
  },
  ark: {
    label: '豆包 · 火山方舟', style: 'openai', defaultBase: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115', 'doubao-1-5-vision-pro-32k-250115'], hint: '模型名也可填接入点 ID（ep-xxxx）。'
  },
  qwen: {
    label: '通义千问 · 百炼', style: 'openai', defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max', 'qwen-vl-max', 'qwen3-max'], hint: '百炼兼容模式支持 tools/function calling。'
  },
  anthropic: {
    label: 'Anthropic Claude', style: 'anthropic', defaultBase: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'], hint: '浏览器直连需加 anthropic-dangerous-direct-browser-access 头，本应用已自动添加。'
  },
  custom: {
    label: '自定义 / 本地代理', style: 'openai', defaultBase: 'http://127.0.0.1:11434/v1',
    models: ['gpt-3.5-turbo', 'local-model'], hint: 'Ollama / one-api / new-api / LiteLLM 等任意 OpenAI 兼容端点。'
  }
};

const DEFAULT_SETTINGS = {
  provider: 'mock',
  providers: {
    mock: { baseUrl: '', apiKey: '', model: 'demo-agent' },
    openai: { baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' },
    deepseek: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat' },
    ark: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', model: 'doubao-1-5-pro-32k-250115' },
    qwen: { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-plus' },
    anthropic: { baseUrl: 'https://api.anthropic.com/v1', apiKey: '', model: 'claude-sonnet-4-5' },
    custom: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', model: 'local-model' }
  },
  proxy: '',                  // CORS 薄代理，支持 https://p.example.com/?url={url} 或纯前缀
  temperature: 0.7,
  maxTokens: 2048,
  maxSteps: 8,
  systemPrompt: '',
  stream: true,
  toolConfirm: true,          // 敏感工具执行前确认（A9）
  showThinking: true,
  theme: 'light',
  sendWithEnter: true,
  contextLimit: 24000,        // 发送前 token 预算，超出触发裁剪（A1）
  keepRecent: 6,              // 裁剪时保留的最近消息条数
  tts: { enabled: false, rate: 1, voice: '', maxChars: 280 },
  vision: true,
  budget: { maxTokens: 200000, maxCost: 0.6, maxToolCalls: 40, priceIn: 2, priceOut: 8, unlimited: false }, // 元/百万 token 的估算单价
  search: {
    provider: 'deepseek',     // deepseek | tavily | serper | custom | none
    count: 8, needContent: true, searchType: 'web', enableSource: true,
    deepseekKey: '',          // 留空则复用 DeepSeek 的 Key
    tavilyKey: '', serperKey: '',
    customUrl: '', customBody: '', customPath: 'results',
    deepFetch: true
  },
  image: {
    provider: 'openai',       // openai | ark | qwen | custom
    size: '1024x1024', quality: 'standard', n: 1,
    arkKey: '', arkModel: 'doubao-seedream-3-0-t2i-250415', arkBase: 'https://ark.cn-beijing.volces.com/api/v3',
    qwenKey: '', qwenModel: 'wanx2.1-t2i-turbo', qwenBase: 'https://dashscope.aliyuncs.com/api/v1'
  },
  localConfirm: true,
  localAllowReplace: true,
  kb: { embedProvider: 'none', embedKey: '', embedModel: 'text-embedding-3-small', topK: 5 },
  lang: 'zh'
};

/* 深合并默认设置 */
function mergeDefaults(dst, def) {
  for (const [k, v] of Object.entries(def)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      dst[k] = mergeDefaults(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v);
    } else if (dst[k] === undefined) dst[k] = v;
  }
  return dst;
}

const State = {
  settings: mergeDefaults(Store.get('settings', {}) || {}, JSON.parse(JSON.stringify(DEFAULT_SETTINGS))),
  sessions: Store.get('sessions', []) || [],
  currentId: Store.get('currentId', '') || '',
  tools: [],            // 由 ToolRegistry 填充
  plugins: Store.get('plugins', []) || [],
  kb: Store.get('kb', { docs: [], chunks: [] }) || { docs: [], chunks: [] },
  audit: [],            // 本次运行的工具审计（L4）
  org: Store.get('org', null),        // 企业模式的组织架构（惰性初始化）
  orgBus: Store.get('orgBus', []) || [],  // Agent 之间的通信记录
  running: false,
  abort: null,
  queue: [],            // E1
  usage: { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0, startedAt: 0 },
  searchHealth: {},     // 提供商用健康度（D10）
  saveSettings() { Store.set('settings', this.settings); },
  saveSessions() { Store.set('sessions', this.sessions.slice(0, 40)); Store.set('currentId', this.currentId); },
  current() {
    let s = this.sessions.find((x) => x.id === this.currentId);
    if (!s) {
      s = newSession('新会话');
      this.sessions.unshift(s); this.currentId = s.id;
    }
    return s;
  }
};

function newSession(title = '新会话') {
  return {
    id: uid('s'), title, createdAt: Date.now(), updatedAt: Date.now(), messages: [],
    usage: { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0 },
    spend: { tok: 0, cost: 0 },        // 本会话实际消耗（预算护栏用这个，不是全局累计）
    pinned: false
  };
}

function curProviderConf() { return State.settings.providers[State.settings.provider] || {}; }

/* 当前模型显示名 */
function curModelLabel() {
  const p = State.settings.provider;
  const c = State.settings.providers[p] || {};
  return (PROVIDERS[p] ? PROVIDERS[p].label : p) + ' · ' + (c.model || '-');
}
function curKeyReady() {
  const p = State.settings.provider;
  if (p === 'mock') return true;
  const c = State.settings.providers[p] || {};
  if (p === 'custom') return true;
  return !!(c.apiKey && c.apiKey.trim());
}

/* 应用代理（C4：只做 URL 改写，不写业务） */
function applyProxy(url) {
  const px = (State.settings.proxy || '').trim();
  if (!px) return url;
  if (px.includes('{url}')) return px.replace('{url}', encodeURIComponent(url));
  if (px.includes('{raw}')) return px.replace('{raw}', url);
  return px.replace(/\/+$/, '') + '/' + url;
}

/* 系统提示词 */
function buildSystemPrompt() {
  const custom = (State.settings.systemPrompt || '').trim();
  const list = (typeof Tools !== 'undefined' ? Tools.active() : []).map((t) => `- ${t.name}: ${t.desc.split('\n')[0]}`);
  const memBlock = (typeof Memory !== 'undefined' ? Memory.promptBlock() : '');
  const localList = (typeof LocalFiles !== 'undefined' ? LocalFiles.list() : []);
  const base = [
    `你是 ${APP.name}，一个运行在浏览器单文件页面里的 AI Agent。`,
    `当前时间：${fmtTime(Date.now())}。可调用工具 ${list.length} 个：`,
    list.join('\n') || '（暂无）',
    '',
    '工作准则：',
    '1. 需要事实、链接、最新信息时先用 web_search；要读全文用 web_fetch，不要凭空编造 URL 或数据。',
    '2. 需要交付文件（Word/Excel/PPT/PDF）时，直接把「结构化内容」传给对应工具，不要输出零散代码。',
    '3. 需要看图/图表时用 render_chart；流程图/思维导图用 render_mermaid；可交互演示用 render_html。',
    '4. 一次只发起必要的工具调用；拿到结果后用简洁中文回答，必要时给表格。',
    '5. 引用网页时在句末标注 [来源n] 并附链接。',
    '6. 用户提到"这个文件/这个项目/改一下"等本机文件时，先用 local_list_files 看已授权文件，再用 local_read_file 读原文；修改用 local_write_file 的 patch 模式（先读后改，find 片段必须逐字一致且唯一），不要凭空重写整篇。',
    '7. 用户透露了稳定的偏好、身份、项目背景或长期规则时，主动用 remember 记下来（一次一句，简洁自包含）。',
    '8. 无法完成时明确说明原因与替代方案，不要假装完成。'
  ].join('\n');
  const parts = [base];
  if (memBlock) parts.push(memBlock);
  if (localList.length) parts.push('【已授权的本机文件】\n' + localList.map((f) => `- ${f.name}（${f.chars != null ? f.chars + ' 字' : '二进制'}）${f.active ? ' ← 最近使用' : ''}`).join('\n'));
  if (custom) parts.push('【用户自定义指令】\n' + custom);
  return parts.join('\n\n');
}
