/* ============ 06 Agent 循环：ReAct / 队列 / 裁剪 / 预算 / 确认 ============ */
const Agent = {
  busy: false,
  stopFlag: false,
  hooks: {},            // UI 注入：onStep / onDelta / onThink / onTool / onDone / onError / onUsage
  queue: [],

  /* ---- 上下文裁剪（A1） ---- */
  trim(messages, limit, keepRecent) {
    const sys = messages.filter((m) => m.role === 'system');
    const rest = messages.filter((m) => m.role !== 'system');
    if (estMessagesTokens(messages) <= limit) return messages;
    const turns = []; let cur = [];
    for (const m of rest) {
      if (m.role === 'user' && cur.length) { turns.push(cur); cur = []; }
      cur.push(m);
    }
    if (cur.length) turns.push(cur);
    const picked = []; let tok = estMessagesTokens(sys);
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      const tt = estMessagesTokens(t);
      const isRecent = picked.length < Math.ceil(keepRecent / 2);
      if (!isRecent && tok + tt > limit) break;
      picked.unshift(t);
      tok += tt;
    }
    const flat = picked.flat();
    const dropped = rest.length - flat.length;
    if (dropped > 0 && sys.length) sys[0] = Object.assign({}, sys[0], { content: sys[0].content + `\n\n（提示：为保证上下文长度，已裁剪较早的 ${dropped} 条消息。）` });
    return sys.concat(flat);
  },

  /* ---- 预算护栏（L3）
     作用域要分清：
       · 工具调用次数 = 每轮上限（防止单轮死循环）
       · token / 费用 = 每个会话累计（防止一轮对话花太多）
     这些都必须可重置，否则攒满后每一轮都会立刻失败，表现为「输出无故停止」。 */
  turnTools: 0,
  spendOf() {
    const s = State.current();
    if (!s.spend) s.spend = { tok: 0, cost: 0 };
    return s.spend;
  },
  budgetExceeded() {
    const b = State.settings.budget || {};
    const maxTools = Number(b.maxToolCalls) || 40;
    const maxTok = Number(b.maxTokens) || 200000;
    const maxCost = Number(b.maxCost);
    const sp = this.spendOf();
    if (this.turnTools >= maxTools) {
      return { kind: 'tools', msg: `本轮工具调用已达 ${maxTools} 次上限（防死循环）`, reset: false };
    }
    if (!b.unlimited && sp.tok >= maxTok) {
      return { kind: 'tokens', msg: `本会话已用 ${sp.tok} token，达到上限 ${maxTok}`, reset: true };
    }
    if (!b.unlimited && isFinite(maxCost) && maxCost > 0 && sp.cost >= maxCost) {
      return { kind: 'cost', msg: `本会话估算费用 ¥${sp.cost.toFixed(3)}，达到上限 ¥${maxCost}`, reset: true };
    }
    return null;
  },
  /** 清零本会话消耗；工具次数是每轮自动清零的 */
  resetBudget() {
    const s = State.current();
    s.spend = { tok: 0, cost: 0 };
    this.turnTools = 0;
    State.saveSessions();
  },

  /* ---- 入队（E1：串行） ---- */
  enqueue(text, opts = {}) {
    this.queue.push({ text, opts });
    if (!this.busy) this.drain();
    else this.hooks.onQueue && this.hooks.onQueue(this.queue.length);
  },
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const job = this.queue.shift();
        this.hooks.onQueue && this.hooks.onQueue(this.queue.length);
        await this.runTurn(job.text, job.opts);
      }
    } finally {
      this.busy = false;
      this.hooks.onIdle && this.hooks.onIdle();
    }
  },
  stop() { this.stopFlag = true; if (State.abort) State.abort.abort(); },

  /* ---- 单轮 ReAct ---- */
  async runTurn(userText, opts = {}) {
    const session = State.current();
    const s = State.settings;
    this.stopFlag = false;
    this.turnTools = 0;          // 每轮重置，只用于防单轮死循环
    const turnStart = performance.now();
    // 用户消息
    // 把沙箱里积攒的交互事件压缩成一小段附言带给模型（不塞进消息列表，也不显示在界面）
    let sandboxNote = '';
    const logs = Array.isArray(session.sandboxLog) ? session.sandboxLog.filter((x) => !x.consumed) : [];
    if (logs.length) {
      sandboxNote = '\n\n【沙箱交互事件】\n' + logs.slice(-10).map((x) => {
        const c = x.count > 1 ? ` ×${x.count}` : '';
        return `- ${x.name}${c}: ${truncate(JSON.stringify(x.payload), 120)}`;
      }).join('\n');
      logs.forEach((x) => { x.consumed = true; });
      session.sandboxLog = session.sandboxLog.slice(-20);
    }
    const userMsg = {
      role: 'user', content: userText + sandboxNote,
      display: opts.display != null ? opts.display : null,   // 界面上只显示这句，不显示附件全文
      images: opts.images || [], ts: Date.now(), files: opts.files || []
    };
    session.messages.push(userMsg);
    session.updatedAt = Date.now();
    if (session.messages.filter((m) => m.role === 'user').length === 1) {
      const titleSrc = (opts.display && String(opts.display).trim()) || userText;
      session.title = truncate(String(titleSrc).replace(/\n/g, ' '), 24) || '新会话';
    }
    State.saveSessions();
    this.hooks.onUser && this.hooks.onUser(userMsg);
    this.hooks.onStepsStart && this.hooks.onStepsStart();

    let step = 0, finalText = '';
    const maxSteps = clamp(Number(s.maxSteps) || 8, 1, 24);
    try {
      while (step < maxSteps) {
        step++;
        const over = this.budgetExceeded();
        if (over) {
          const e = new Error(over.msg);
          e.budget = over;       // 让 onError 渲染「继续（重置预算）」而不是直接死掉
          throw e;
        }
        if (this.stopFlag) break;
        const ctx = this.trim([{ role: 'system', content: buildSystemPrompt() }, ...session.messages.filter((m) => m.role !== 'system')], Number(s.contextLimit) || 24000, Number(s.keepRecent) || 6);
        State.abort = new AbortController();
        this.hooks.onStepStart && this.hooks.onStepStart(step);
        let res;
        try {
          res = await LLM.chat({
            messages: ctx,
            tools: Tools.schemas(),
            signal: State.abort.signal,
            session,
            onDelta: (d, all) => { finalText = all; this.hooks.onDelta && this.hooks.onDelta(d, all, step); },
            onThink: (d, all) => { this.hooks.onThink && this.hooks.onThink(d, all, step); }
          });
        } catch (e) {
          if (e.name === 'AbortError' || this.stopFlag) { this.hooks.onAborted && this.hooks.onAborted(); return; }
          throw e;
        }
        // 统计
        const inTok = res.usage.in || estMessagesTokens(ctx);
        const outTok = res.usage.out || estTokens(res.text || '');
        const b = s.budget;
        const cost = (inTok / 1e6) * Number(b.priceIn || 0) + (outTok / 1e6) * Number(b.priceOut || 0);
        State.usage.inTok += inTok; State.usage.outTok += outTok; State.usage.calls++; State.usage.cost += cost;
        { const sp = this.spendOf(); sp.tok += inTok + outTok; sp.cost += cost; }
        session.usage = session.usage || { inTok: 0, outTok: 0, calls: 0, toolCalls: 0, cost: 0 };
        session.usage.inTok += inTok; session.usage.outTok += outTok; session.usage.calls++; session.usage.cost += cost;
        this.hooks.onUsage && this.hooks.onUsage({ inTok, outTok, calls: 1, cost, step });

        const asst = {
          role: 'assistant', content: res.text || '',
          tool_calls: (res.toolCalls || []).map((t) => ({ id: t.id, name: t.name, arguments: t.arguments })),
          thinking: res.thinking || '', ts: Date.now(), step
        };
        session.messages.push(asst);
        this.hooks.onAssistantDone && this.hooks.onAssistantDone(asst, step);
        if (!asst.tool_calls.length) { finalText = res.text; break; }

        // 串行执行工具
        for (const call of asst.tool_calls) {
          if (this.stopFlag) break;
          const tool = Tools.get(call.name);
          const needConfirm = s.toolConfirm && tool && (tool.sensitive || s.confirmAll);
          let out;
          if (needConfirm) {
            const approved = await confirmDialog(
              '工具调用确认：' + call.name,
              `<div>模型请求执行一个${tool.sensitive ? ' <b style="color:#f59e0b">敏感</b> ' : ''}工具：</div>
               <div style="margin:6px 0"><code>${esc(call.name)}</code> — ${esc(tool.desc || '')}</div>
               <pre>${esc(JSON.stringify(call.arguments, null, 2)).slice(0, 3000)}</pre>
               <div style="font-size:12px;color:#94a8c6">可在 设置 → 安全 里关闭确认（不推荐）。</div>`,
              '允许执行'
            );
            if (!approved) out = { ok: false, summary: '用户拒绝了这次工具调用', display: { kind: 'denied', name: call.name } };
          }
          if (!out) {
            this.hooks.onToolStart && this.hooks.onToolStart(call);
            out = await Tools.exec(call.name, call.arguments, { session });
          }
          this.turnTools++;
          session.usage.toolCalls = (session.usage.toolCalls || 0) + 1;
          const toolMsg = { role: 'tool', tool_call_id: call.id, name: call.name, content: Tools.toToolText(out), ts: Date.now(), display: out.display, ok: out.ok };
          session.messages.push(toolMsg);
          this.hooks.onToolEnd && this.hooks.onToolEnd(call, out, step);
          this.hooks.onUsage && this.hooks.onUsage({ toolCalls: 1 });
          State.saveSessions();
        }
        if (this.stopFlag) break;
      }
      if (step >= maxSteps && !this.stopFlag) {
        this.hooks.onWarn && this.hooks.onWarn(`已达到最大步数 ${maxSteps}，Agent 主动停止。可在设置里调高「最大步数」。`);
      }
      this.hooks.onDone && this.hooks.onDone(finalText, Math.round(performance.now() - turnStart));
      // 自动朗读（F1）
      if (s.tts.enabled) TTS.speak(finalText);
    } catch (e) {
      if (e.name === 'AbortError') { this.hooks.onAborted && this.hooks.onAborted(); }
      else this.hooks.onError && this.hooks.onError(e);
    } finally {
      State.abort = null;
      session.updatedAt = Date.now();
      State.saveSessions();
    }
  },

  /* ---- 重新生成最后一轮 ---- */
  async regenerate() {
    const session = State.current();
    const idx = session.messages.map((m) => m.role).lastIndexOf('user');
    if (idx < 0) return toast('没有可重新生成的消息', 'err');
    const userMsg = session.messages[idx];
    session.messages = session.messages.slice(0, idx);
    State.saveSessions();
    UI.renderMessages();
    this.enqueue(userMsg.content, { images: userMsg.images || [], display: userMsg.display, files: userMsg.files });
  }
};

/* ---------------- 多 Agent 协作：delegate_task（A8） ---------------- */
Tools.register({
  name: 'delegate_task', category: 'agent', sensitive: false,
  desc: '把一个可以独立完成的子任务委派给子 Agent（上下文隔离，只给只读工具：搜索/抓取/计算）。返回子 Agent 的结论摘要。适合并行不了但需要独立调查的子问题。',
  params: {
    type: 'object',
    properties: {
      task: { type: 'string', description: '子任务描述，要自包含（子 Agent 看不到当前对话）' },
      max_steps: { type: 'integer', description: '子 Agent 最大步数，默认 3' }
    },
    required: ['task']
  },
  async run(args, ctx) {
    const allowed = ['web_search', 'web_fetch', 'run_js', 'kb_search', 'render_chart'];
    const subTools = Tools.schemas().filter((t) => allowed.includes(t.function.name));
    const msgs = [
      { role: 'system', content: '你是子 Agent。只做被指派的子任务，尽量少调用工具，最后用 200 字内中文给出结论与来源链接。' },
      { role: 'user', content: String(args.task || '') }
    ];
    const maxSteps = clamp(Number(args.max_steps) || 3, 1, 6);
    const trace = [];
    for (let i = 0; i < maxSteps; i++) {
      if (Agent.stopFlag) break;
      const res = await LLM.chat({ messages: msgs, tools: subTools, signal: State.abort ? State.abort.signal : undefined });
      State.usage.inTok += res.usage.in || 0; State.usage.outTok += res.usage.out || 0;
      if (!res.toolCalls.length) {
        trace.push({ text: res.text });
        return { ok: true, summary: `子 Agent 完成：\n${res.text}`, data: { steps: trace, answer: res.text }, display: { kind: 'delegate', task: args.task, answer: res.text, trace } };
      }
      msgs.push({ role: 'assistant', content: res.text || '', tool_calls: res.toolCalls });
      for (const c of res.toolCalls) {
        const out = await Tools.exec(c.name, c.arguments, ctx);
        trace.push({ tool: c.name, summary: truncate(out.summary, 160) });
        msgs.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: Tools.toToolText(out, 3000) });
      }
    }
    const last = trace.filter((t) => t.text).pop();
    return { ok: true, summary: '子 Agent 达到步数上限，已收集：\n' + (last ? last.text : JSON.stringify(trace).slice(0, 800)), display: { kind: 'delegate', task: args.task, answer: last ? last.text : '(未完成)', trace } };
  }
});

/* ---------------- 语音播报（F1） ---------------- */
const TTS = {
  speaking: false,
  voices: [],
  load() {
    if (!('speechSynthesis' in window)) return [];
    this.voices = speechSynthesis.getVoices();
    return this.voices;
  },
  split(text, max = 280) {
    const clean = String(text).replace(/```[\s\S]*?```/g, '（代码块略）').replace(/[#*`>|]/g, '').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/\n{2,}/g, '\n');
    const out = [];
    let buf = '';
    for (const seg of clean.split(/(?<=[。！？；.!?;\n])/)) {
      if ((buf + seg).length > max && buf) { out.push(buf); buf = seg; }
      else buf += seg;
    }
    if (buf.trim()) out.push(buf);
    return out.filter((s) => s.trim());
  },
  speak(text, { rate } = {}) {
    if (!('speechSynthesis' in window)) return toast('当前浏览器不支持语音合成', 'err');
    if (!this.voices.length) this.load();
    speechSynthesis.cancel();
    const parts = this.split(text, Number(State.settings.tts.maxChars) || 280);
    if (!parts.length) return;
    this.speaking = true;
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = /[\u4e00-\u9fff]/.test(p) ? 'zh-CN' : 'en-US';
      u.rate = rate || Number(State.settings.tts.rate) || 1;
      const want = State.settings.tts.voice;
      const v = this.voices.find((x) => x.name === want) || this.voices.find((x) => x.lang.startsWith('zh'));
      if (v) u.voice = v;
      if (i === parts.length - 1) u.onend = () => { this.speaking = false; UI.updateTtsBtn && UI.updateTtsBtn(); };
      speechSynthesis.speak(u);
    });
  },
  stop() { if ('speechSynthesis' in window) speechSynthesis.cancel(); this.speaking = false; }
};

/* ---------------- 语音输入（E4） ---------------- */
const ASR = {
  rec: null,
  start(onText, onEnd) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return toast('当前浏览器不支持语音识别（建议 Chrome/Edge）', 'err');
    const r = new SR();
    r.lang = 'zh-CN'; r.interimResults = true; r.continuous = false;
    r.onresult = (e) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      onText(t, e.results[e.results.length - 1].isFinal);
    };
    r.onerror = (e) => { toast('语音识别错误：' + e.error, 'err'); onEnd && onEnd(); };
    r.onend = () => { onEnd && onEnd(); };
    r.start(); this.rec = r;
  },
  stop() { if (this.rec) { try { this.rec.stop(); } catch { } this.rec = null; } }
};
