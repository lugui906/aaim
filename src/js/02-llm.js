/* ============ 02 LLM 接入层：多提供商 / 流式 / 重试 / 演示模型 ============ */
const LLM = {
  buildUrl(p, base) {
    const b = (base || '').replace(/\/+$/, '');
    if (p.style === 'anthropic') return applyProxy(b + '/messages');
    return applyProxy(b + '/chat/completions');
  },
  headers(p, key) {
    const h = { 'Content-Type': 'application/json' };
    if (p.style === 'anthropic') {
      h['x-api-key'] = key;
      h['anthropic-version'] = '2023-06-01';
      h['anthropic-dangerous-direct-browser-access'] = 'true';
    } else if (key) h['Authorization'] = 'Bearer ' + key;
    return h;
  },

  /* ---- 内部消息 → 提供商格式 ---- */
  toOpenAI(messages, tools, s) {
    const out = [];
    for (const m of messages) {
      if (m.role === 'system') { out.push({ role: 'system', content: m.content }); continue; }
      if (m.role === 'user') {
        if (m.images && m.images.length && s.vision) {
          out.push({
            role: 'user', content: [
              { type: 'text', text: m.content || '' },
              ...m.images.map((im) => ({ type: 'image_url', image_url: { url: im.dataUrl } }))
            ]
          });
        } else out.push({ role: 'user', content: m.content || '' });
        continue;
      }
      if (m.role === 'assistant') {
        const msg = { role: 'assistant', content: m.content || '' };
        if (m.tool_calls && m.tool_calls.length) {
          msg.tool_calls = m.tool_calls.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: typeof t.arguments === 'string' ? t.arguments : JSON.stringify(t.arguments || {}) } }));
          if (!msg.content) msg.content = null;
        }
        out.push(msg); continue;
      }
      if (m.role === 'tool') { out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }); }
    }
    const body = {
      model: s.providers[s.provider].model,
      messages: out,
      temperature: Number(s.temperature),
      max_tokens: Number(s.maxTokens),
      stream: !!s.stream
    };
    if (s.stream) body.stream_options = { include_usage: true };
    if (tools && tools.length) { body.tools = tools; body.tool_choice = 'auto'; }
    return body;
  },
  toAnthropic(messages, tools, s) {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const out = [];
    for (const m of messages) {
      if (m.role === 'system') continue;
      if (m.role === 'user') {
        const c = [];
        if (m.images && m.images.length && s.vision) {
          for (const im of m.images) {
            const mt = /data:(image\/[a-z+]+);/.exec(im.dataUrl || '');
            const b64 = (im.dataUrl || '').split(',')[1] || '';
            if (mt) c.push({ type: 'image', source: { type: 'base64', media_type: mt[1], data: b64 } });
          }
        }
        if (m.content) c.push({ type: 'text', text: m.content });
        out.push({ role: 'user', content: c.length ? c : [{ type: 'text', text: ' ' }] });
        continue;
      }
      if (m.role === 'assistant') {
        const c = [];
        if (m.content) c.push({ type: 'text', text: m.content });
        for (const t of m.tool_calls || []) c.push({ type: 'tool_use', id: t.id, name: t.name, input: typeof t.arguments === 'string' ? safeJSON(t.arguments, {}) : (t.arguments || {}) });
        if (c.length) out.push({ role: 'assistant', content: c });
        continue;
      }
      if (m.role === 'tool') {
        out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] });
      }
    }
    // 合并相邻同角色（Anthropic 要求交替）
    const merged = [];
    for (const m of out) {
      const last = merged[merged.length - 1];
      if (last && last.role === m.role) last.content = last.content.concat(m.content);
      else merged.push({ role: m.role, content: m.content.slice() });
    }
    const body = { model: s.providers[s.provider].model, max_tokens: Number(s.maxTokens), temperature: Number(s.temperature), messages: merged, stream: !!s.stream };
    if (sys) body.system = sys;
    if (tools && tools.length) body.tools = tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters }));
    return body;
  },

  /* ---- 主入口：返回 {text, thinking, toolCalls, usage} ---- */
  async chat({ messages, tools, signal, onDelta, onThink, session }) {
    const s = State.settings;
    const p = PROVIDERS[s.provider];
    if (!p) throw new Error('未知提供商: ' + s.provider);
    if (p.style === 'mock') return MockLLM.run({ messages, tools, signal, onDelta, onThink });
    const conf = s.providers[s.provider];
    if (!conf.apiKey && s.provider !== 'custom') throw new Error('未配置 API Key：请点击右上角 ⚙ 设置 → 模型');
    const base = (conf.baseUrl || p.defaultBase || '').replace(/\/+$/, '');
    if (!base) throw new Error('未配置 Base URL');
    const url = this.buildUrl(p, base);
    const body = p.style === 'anthropic' ? this.toAnthropic(messages, tools, s) : this.toOpenAI(messages, tools, s);

    let attempt = 0, lastErr;
    while (attempt < 3) {
      attempt++;
      try {
        const res = await fetch(url, { method: 'POST', headers: this.headers(p, conf.apiKey), body: JSON.stringify(body), signal });
        if (!res.ok) {
          const txt = await res.text().catch(() => '');
          const err = new Error(`HTTP ${res.status} ${res.statusText} ${txt.slice(0, 400)}`);
          err.status = res.status;
          if ((res.status === 429 || res.status >= 500) && attempt < 3) { lastErr = err; await sleep(600 * attempt * attempt); continue; }
          throw err;
        }
        if (!s.stream) {
          const j = await res.json();
          return p.style === 'anthropic' ? this.parseAnthropicFull(j) : this.parseOpenAIFull(j);
        }
        const out = p.style === 'anthropic'
          ? await this.readAnthropicSSE(res, signal, onDelta, onThink)
          : await this.readOpenAISSE(res, signal, onDelta, onThink);
        if (!out.text && !out.toolCalls.length && !out.thinking) {
          if (attempt < 3) { lastErr = new Error('空响应，重试中'); await sleep(500 * attempt); continue; }
        }
        return out;
      } catch (e) {
        if (e.name === 'AbortError') throw e;
        lastErr = e;
        // 网络错误（TypeError: Failed to fetch）多为 CORS，不重试太多
        if (attempt < 3) { await sleep(500 * attempt); continue; }
        throw e;
      }
    }
    throw lastErr;
  },

  async readOpenAISSE(res, signal, onDelta, onThink) {
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', text = '', thinking = '', usage = { in: 0, out: 0 };
    const calls = new Map();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.usage) usage = { in: j.usage.prompt_tokens || 0, out: j.usage.completion_tokens || 0 };
        const d = j.choices && j.choices[0] && j.choices[0].delta;
        if (!d) continue;
        const rc = d.reasoning_content || (j.choices[0].message && j.choices[0].message.reasoning_content);
        if (rc) { thinking += rc; onThink && onThink(rc, thinking); }
        if (d.content) { text += d.content; onDelta && onDelta(d.content, text); }
        if (d.tool_calls) {
          for (const tc of d.tool_calls) {
            const i = tc.index != null ? tc.index : 0;
            const cur = calls.get(i) || { id: '', name: '', arguments: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function && tc.function.name) cur.name += tc.function.name;
            if (tc.function && tc.function.arguments) cur.arguments += tc.function.arguments;
            calls.set(i, cur);
          }
        }
      }
    }
    const toolCalls = Array.from(calls.values()).filter((c) => c.name).map((c) => ({ id: c.id || uid('call'), name: c.name, arguments: safeJSON(c.arguments || '{}', { _raw: c.arguments }) }));
    return { text, thinking, toolCalls, usage, raw: { style: 'openai' } };
  },

  async readAnthropicSSE(res, signal, onDelta, onThink) {
    const reader = res.body.getReader();
    const dec = new TextDecoder('utf-8');
    let buf = '', text = '', thinking = '', usage = { in: 0, out: 0 };
    const blocks = new Map();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch { continue; }
        if (j.type === 'message_start' && j.message && j.message.usage) usage.in = j.message.usage.input_tokens || 0;
        if (j.type === 'message_delta') { if (j.usage) { usage.out = j.usage.output_tokens || 0; if (j.usage.input_tokens) usage.in = j.usage.input_tokens; } }
        if (j.type === 'content_block_start') {
          if (j.content_block.type === 'tool_use') blocks.set(j.index, { id: j.content_block.id, name: j.content_block.name, json: '' });
          if (j.content_block.type === 'text' && j.content_block.text) { text += j.content_block.text; onDelta && onDelta(j.content_block.text, text); }
          if (j.content_block.type === 'thinking' && j.content_block.thinking) { thinking += j.content_block.thinking; onThink && onThink(j.content_block.thinking, thinking); }
        }
        if (j.type === 'content_block_delta') {
          const d = j.delta || {};
          if (d.type === 'text_delta' && d.text) { text += d.text; onDelta && onDelta(d.text, text); }
          if (d.type === 'thinking_delta' && d.thinking) { thinking += d.thinking; onThink && onThink(d.thinking, thinking); }
          if (d.type === 'input_json_delta' && blocks.has(j.index)) blocks.get(j.index).json += (d.partial_json || '');
        }
      }
    }
    const toolCalls = Array.from(blocks.values()).map((b) => ({ id: b.id || uid('call'), name: b.name, arguments: safeJSON(b.json || '{}', { _raw: b.json }) }));
    return { text, thinking, toolCalls, usage, raw: { style: 'anthropic' } };
  },

  parseOpenAIFull(j) {
    const m = (j.choices && j.choices[0] && j.choices[0].message) || {};
    const toolCalls = (m.tool_calls || []).map((t) => ({ id: t.id, name: t.function.name, arguments: safeJSON(t.function.arguments || '{}', {}) }));
    return { text: m.content || '', thinking: m.reasoning_content || '', toolCalls, usage: { in: (j.usage && j.usage.prompt_tokens) || 0, out: (j.usage && j.usage.completion_tokens) || 0 }, raw: { style: 'openai' } };
  },
  parseAnthropicFull(j) {
    let text = '', thinking = '';
    const toolCalls = [];
    for (const b of j.content || []) {
      if (b.type === 'text') text += b.text;
      if (b.type === 'thinking') thinking += b.thinking || '';
      if (b.type === 'tool_use') toolCalls.push({ id: b.id, name: b.name, arguments: b.input || {} });
    }
    return { text, thinking, toolCalls, usage: { in: (j.usage && j.usage.input_tokens) || 0, out: (j.usage && j.usage.output_tokens) || 0 }, raw: { style: 'anthropic' } };
  }
};

function safeJSON(s, def) {
  try { return JSON.parse(s); } catch { return def === undefined ? null : def; }
}

/* ============ 内置演示模型（无需 Key，走真实 ReAct 循环） ============ */
const MockLLM = {
  async run({ messages, tools, signal, onDelta, onThink }) {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const lastMsg = messages[messages.length - 1];
    const emit = async (t, delay = 9) => {
      let acc = '';
      for (const ch of t) {
        if (signal && signal.aborted) throw new DOMException('aborted', 'AbortError');
        acc += ch; onDelta && onDelta(ch, acc);
        if (delay) await sleep(delay);
      }
      return acc;
    };
    const toolNames = new Set((tools || []).map((t) => t.function.name));
    // 工具返回后 → 总结
    if (lastMsg && lastMsg.role === 'tool') {
      // ★ 只列「本轮」新产生的工具结果：之前写成 slice(-3) 会把前几轮的也列出来，
      //   表现就是同一个工具在摘要里重复出现好几遍。
      let turnStart = -1;
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') { turnStart = i; break; }
      }
      const tools_ = messages.slice(turnStart + 1).filter((m) => m.role === 'tool');
      const summary = tools_.map((t) => {
        // 工具消息的 content 是"摘要 + 数据"的拼接文本，这里只取第一段摘要，避免把 JSON 贴给用户
        const raw = String(t.content || '');
        const firstPara = raw.split('\n\n')[0].replace(/\n/g, ' ').trim();
        return `- **${t.name}**：${truncate(firstPara, 150)}`;
      }).join('\n');
      const txt = `工具已执行完毕，结果摘要如下：\n\n${summary}\n\n> 这是内置演示模型的固定话术。想要真实推理，请在 ⚙ 设置里填一个真实提供商的 API Key（或本地代理地址）。`;
      await emit(txt, 6);
      return { text: txt, thinking: '', toolCalls: [], usage: { in: estMessagesTokens(messages), out: estTokens(txt) }, raw: { style: 'mock' } };
    }
    // 只用用户自己写的那句做意图匹配，附件全文里的 xlsx/表格 等词不该触发工具
    const rawQ = (lastUser && lastUser.content) || '';
    const q = (() => {
      const i = rawQ.indexOf('\n\n【附件：');
      const head = i > 0 ? rawQ.slice(0, i) : (/^【附件：/.test(rawQ) ? '' : rawQ);
      return head.trim();
    })();
    const has = (arr) => arr.some((k) => q.toLowerCase().includes(k));
    const pick = (name, args) => (toolNames.has(name) ? { id: uid('call'), name, arguments: args } : null);
    // 生成类意图：必须出现"做/生成/写/导出/来个"等动作词，光提名词（"读这三个文档"）不算
    const ACT = ['做', '生成', '写', '导出', '来一个', '来个', '整一个', '创建', '新建', '帮我出', '出一份', '给我', 'make', 'create', 'generate'];
    const wantsMake = has(ACT);
    let call = null, head = '';

    // 附件已带的上下文：用户是让读文件时，不该触发"生成文档"
    const hasAttachment = !!(lastUser && Array.isArray(lastUser.files) && lastUser.files.length);
    const readIntent = has(['读', '总结', '概括', '分析', '看看', '看一下', '要点', '讲了什么', '提炼']);
    if (hasAttachment && readIntent && !wantsMake) {
      // 直接基于附件内容回答，不调工具
      const names = lastUser.files.map((f) => f.name).join('、');
      const txt = `你上传了 ${lastUser.files.length} 个文件（${names}），内容已经读进上下文了。\n\n> 这是内置演示模型，只会复述固定话术，没法真的做摘要。\n> 换成真实模型（⚙ → 模型 → 填 Key）就能直接总结这些文档。\n\n当前对话里已经带着这几个文件的全文（Word 的段落与表格、Excel 每个工作表、PPT 每页正文与备注），真实模型可以直接引用。`;
      await emit(txt, 5);
      return { text: txt, thinking: '用户上传了文件并要求阅读总结，应基于附件内容作答，不需要生成新文档。', toolCalls: [], usage: { in: estMessagesTokens(messages), out: estTokens(txt) }, raw: { style: 'mock' } };
    }
    if (has(['搜索', '搜一下', '查一下', '最新', '新闻', 'search'])) {
      call = pick('web_search', { query: q.slice(0, 80) || 'AI Agent', count: State.settings.search.count, need_content: State.settings.search.needContent });
      head = `我打算先联网检索「${truncate(q, 40)}」，然后再汇总。\n\n`;
    } else if (wantsMake && has(['excel', '表格', 'xlsx', '统计表'])) {
      call = pick('generate_xlsx', { filename: '演示表格.xlsx', sheets: [{ name: '示例', headers: ['项目', '数量', '金额'], rows: [['A 方案', 12, 3600], ['B 方案', 8, 2400], ['C 方案', 5, 1500]] }] });
      head = '我用 generate_xlsx 生成一个三级数据表的演示文件。\n\n';
    } else if (wantsMake && has(['ppt', '演示文稿', '幻灯片', '汇报'])) {
      call = pick('generate_pptx', { filename: '演示文稿.pptx', title: '单文件 AI Agent 演示', slides: [{ title: '能做什么', bullets: ['多轮对话 + 工具调用', '一键出 Word/Excel/PPT/PDF', '图表与沙箱演示'] }, { title: '怎么接模型', bullets: ['填 Base URL 与 Key', '或用本地代理绕 CORS'] }] });
      head = '我用 generate_pptx 生成一份两页的演示文稿。\n\n';
    } else if (wantsMake && has(['word', 'docx', '文档', '报告'])) {
      call = pick('generate_docx', { filename: '演示文档.docx', title: '单文件 AI Agent 能力说明', blocks: [{ type: 'h1', text: '一、概览' }, { type: 'p', text: '本页面把 LLM 接入、工具调用、文档生成、图表渲染装进了一个 HTML。' }, { type: 'h2', text: '二、要点' }, { type: 'ul', items: ['ReAct 循环', '流式输出', '沙箱代码执行'] }] });
      head = '我用 generate_docx 生成一份 Word 说明文档。\n\n';
    } else if (wantsMake && has(['pdf'])) {
      call = pick('generate_pdf', { filename: '演示.pdf', title: '单文件 AI Agent', lines: ['1. 多提供商 LLM 接入', '2. ReAct 工具调用循环', '3. 文档/图表/沙箱生成'] });
      head = '我用 generate_pdf 生成一份 PDF。\n\n';
    } else if (has(['图表', '柱状', '折线', 'chart', '画图'])) {
      call = pick('render_chart', { title: '示例销售趋势', type: 'line', categories: ['1月', '2月', '3月', '4月', '5月'], series: [{ name: '销售额', data: [120, 180, 150, 240, 300] }, { name: '成本', data: [80, 90, 110, 130, 160] }] });
      head = '我用 render_chart 渲染一张折线图（ECharts）。\n\n';
    } else if (has(['流程图', '思维导图', 'mermaid'])) {
      call = pick('render_mermaid', { code: 'graph TD\n  A[用户提问] --> B{需要外部信息?}\n  B -- 是 --> C[调用工具]\n  C --> D[观察结果]\n  D --> B\n  B -- 否 --> E[生成回答]' });
      head = '我用 render_mermaid 画一张 ReAct 循环流程图。\n\n';
    } else if (has(['演示页', '小应用', 'html', '交互', '计算器'])) {
      call = pick('render_html', { title: '交互式小演示', html: '<h3>点击计数</h3><button id="b">+1</button><p>当前：<b id="n">0</b></p><script>let n=0;b.onclick=()=>{n++;document.getElementById("n").textContent=n;parent.postMessage({source:"aaim-sandbox",type:"event",name:"count",payload:n},"*")}<\/script>' });
      head = '我用 render_html 在沙箱里渲染一个可交互演示。\n\n';
    } else if (has(['沙箱', '运行代码', '执行js', '算一下'])) {
      call = pick('run_js', { code: 'const r = [1,2,3,4,5].reduce((a,b)=>a+b,0);\nreturn { sum: r, avg: r/5 };' });
      head = '我把这段 JS 放进沙箱执行。\n\n';
    }
    if (!head) {
      const txt = `你好，我是 **内置演示模型**（不需要 API Key）。这条回复是本地生成的，用来验证界面与工具链路是否正常。\n\n| 能力 | 说明 | 状态 |\n| --- | --- | --- |\n| 多轮对话 | 上下文裁剪 / 清空 / 新建 | 可用 |\n| 工具调用 | ReAct 循环、串行执行 | 可用 |\n| 流式输出 | 逐字显示、可停止、可重试 | 可用 |\n| 文档生成 | Word / Excel / PPT / PDF | 可用 |\n\n试试这些说法：\n\n- 「**搜索**一下 2026 年 AI Agent 的趋势」\n- 「用 **Excel** 做个表格」\n- 「做个 **PPT**」「写一份 **Word** 文档」「生成 **PDF**」\n- 「画个 **图表**」「画个 **流程图**」「做个交互 **html** 演示」\n\n> 换成真模型：右上角 ⚙ → 模型 → 选提供商、填 Base URL 与 Key（浏览器直连被 CORS 拦时填代理地址）。`;
      await emit(txt, 5);
      return { text: txt, thinking: '', toolCalls: [], usage: { in: estMessagesTokens(messages), out: estTokens(txt) }, raw: { style: 'mock' } };
    }
    await emit(head, 8);
    await sleep(120);
    return { text: head, thinking: '需要外部能力，调用注册表中的工具来获取真实结果。', toolCalls: call ? [call] : [], usage: { in: estMessagesTokens(messages), out: estTokens(head) }, raw: { style: 'mock' } };
  }
};
