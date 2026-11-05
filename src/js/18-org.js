/* ============ 18 企业式子 Agent：组织模型 / 通信总线 / 检查者 / 运行引擎 ============ */
/* 设计要点
   · 层级：大领导（1 个，可多个小领导）→ 小领导（可再挂小领导或执行者）→ 执行者
   · 检查者：独立于指挥链，数量 >= 1，评审标准写死在代码里，领导改不了也删不掉
   · 通信：所有 agent 共用一个消息总线，可随时互发；消息带附件（工具结果 / 上传内容）
   · 每个 agent 有独立上下文（自己的 messages），互相不污染
*/

const ORG_ROLES = {
  leader: { label: '大领导', icon: 'crown', canDelegate: true, level: 0 },
  subleader: { label: '小领导', icon: 'lead', canDelegate: true, level: 1 },
  worker: { label: '执行者', icon: 'worker', canDelegate: false, level: 2 },
  inspector: { label: '检查者', icon: 'shield', canDelegate: false, level: 0 }
};

/* ---------------- 组织数据模型 ---------------- */
const Org = {
  get data() {
    if (!State.org) State.org = this.defaults();
    return State.org;
  },
  defaults() {
    return {
      enabled: false,
      nodes: [
        this.makeNode({ id: 'leader', name: '大领导', role: 'leader', parentId: null, prompt: '你负责接收目标、拆解任务、分派给下级，并对最终交付负责。要明确验收标准。' }),
        this.makeNode({ id: 'sub1', name: '小领导', role: 'subleader', parentId: 'leader', prompt: '你负责把上级分派的任务再拆成可执行的子任务，交给执行者，并把结果整合后上报。' }),
        this.makeNode({ id: 'w1', name: '执行者 A', role: 'worker', parentId: 'sub1', prompt: '你是执行者，专注把交给你的具体任务做完，给出可直接使用的结果。' }),
        this.makeNode({ id: 'w2', name: '执行者 B', role: 'worker', parentId: 'sub1', prompt: '你是执行者，专注把交给你的具体任务做完，给出可直接使用的结果。' }),
        this.makeNode({ id: 'insp1', name: '检查者', role: 'inspector', parentId: null, prompt: '' })
      ],
      seq: 5,
      maxDepth: 4,
      maxRework: 2,        // 被检查者打回后最多重做几次
      maxStepsPerAgent: 4  // 单个 agent 最多几轮工具调用
    };
  },
  makeNode(o = {}) {
    const role = o.role || 'worker';
    return {
      id: o.id || uid('n'),
      name: o.name || (ORG_ROLES[role] ? ORG_ROLES[role].label : '成员'),
      role,
      parentId: o.parentId === undefined ? null : o.parentId,
      prompt: o.prompt != null ? o.prompt : '',
      model: o.model || '',            // 留空用全局设置
      expanded: o.expanded !== false,
      status: 'idle',                  // idle | running | done | error | blocked
      lastActive: 0
    };
  },
  save() { Store.set('org', this.data); },

  all() { return this.data.nodes; },
  get(id) { return this.data.nodes.find((n) => n.id === id) || null; },
  leaders() { return this.data.nodes.filter((n) => n.role === 'leader' && !n.parentId); },
  rootLeader() { return this.leaders()[0] || null; },
  inspectors() { return this.data.nodes.filter((n) => n.role === 'inspector'); },
  childrenOf(id) { return this.data.nodes.filter((n) => n.parentId === id); },
  /** 指挥链（不含检查者） */
  chain() { return this.data.nodes.filter((n) => n.role !== 'inspector'); },

  /** 深度（领导 = 0） */
  depth(id) {
    let d = 0, cur = this.get(id), guard = 0;
    while (cur && cur.parentId && guard++ < 20) { d++; cur = this.get(cur.parentId); }
    return d;
  },
  path(id) {
    const out = []; let cur = this.get(id), guard = 0;
    while (cur && guard++ < 20) { out.unshift(cur); cur = cur.parentId ? this.get(cur.parentId) : null; }
    return out;
  },

  add(opts) {
    const parent = opts.parentId ? this.get(opts.parentId) : null;
    if (opts.parentId && !parent) throw new Error('找不到上级');
    if (parent && !ORG_ROLES[parent.role].canDelegate) throw new Error(`${ORG_ROLES[parent.role].label}不能有下属`);
    if (parent && parent.role === 'inspector') throw new Error('检查者不参与指挥链');
    const d = parent ? this.depth(parent.id) + 1 : 0;
    if (d >= this.data.maxDepth) throw new Error(`层级超过上限（${this.data.maxDepth} 层）`);
    const n = this.makeNode(Object.assign({}, opts, { parentId: parent ? parent.id : null }));
    this.data.nodes.push(n);
    this.save();
    return n;
  },
  update(id, patch) {
    const n = this.get(id);
    if (!n) return null;
    // 检查者的名字可以改，但评审标准在代码里，这里改不了
    Object.assign(n, patch);
    this.save();
    return n;
  },
  remove(id) {
    const n = this.get(id);
    if (!n) return false;
    if (n.role === 'leader' && !n.parentId) throw new Error('大领导不能被删除');
    if (n.role === 'inspector' && this.inspectors().length <= 1) throw new Error('至少要保留一名检查者');
    // 连同子树一起删
    const kill = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const x of this.data.nodes) {
        if (x.parentId && kill.has(x.parentId) && !kill.has(x.id)) { kill.add(x.id); grew = true; }
      }
    }
    this.data.nodes = this.data.nodes.filter((x) => !kill.has(x.id));
    OrgBus.purgeAgents([...kill]);
    this.save();
    return true;
  },
  /** 依赖检查：能否开始运行 */
  validate() {
    const errs = [];
    if (!this.rootLeader()) errs.push('缺少大领导');
    if (!this.inspectors().length) errs.push('必须至少有一名检查者');
    for (const n of this.chain()) {
      if (ORG_ROLES[n.role].canDelegate && n.id !== 'leader') {
        // 允许领导没有下属（会被当成执行者用），只提示
      }
    }
    return { ok: errs.length === 0, errs };
  },
  resetRun() {
    for (const n of this.data.nodes) { n.status = 'idle'; n.lastActive = 0; }
    this.save();
  }
};

/* ---------------- 通信总线：Agent 之间实时互发 ---------------- */
const OrgBus = {
  list() { return (State.orgBus || []).slice(); },
  save() { Store.set('orgBus', (State.orgBus || []).slice(-400)); },

  /**
   * 发消息
   * @param {string} from 发送者 id（'user' 表示人）
   * @param {string|'all'} to 接收者 id
   * @param {object} opt { subject, body, attachments:[{name, kind, text, chars}], kind }
   */
  send(from, to, opt = {}) {
    if (!State.orgBus) State.orgBus = [];
    const msg = {
      id: uid('m'),
      from, to,
      subject: String(opt.subject || '').slice(0, 200),
      body: String(opt.body || ''),
      attachments: (opt.attachments || []).map((a) => ({
        name: a.name || '附件', kind: a.kind || 'text',
        chars: a.chars != null ? a.chars : (a.text ? a.text.length : 0),
        text: String(a.text || '').slice(0, 20000)
      })),
      kind: opt.kind || 'message',      // message | dispatch | report | review
      ts: Date.now(),
      readBy: []
    };
    State.orgBus.push(msg);
    if (State.orgBus.length > 400) State.orgBus = State.orgBus.slice(-400);
    this.save();
    this.emit(msg);
    return msg;
  },

  /** 取某个 agent 的收件箱 */
  inboxOf(id, { unreadOnly = false, limit = 20 } = {}) {
    return this.list()
      .filter((m) => (m.to === id || m.to === 'all') && m.from !== id)
      .filter((m) => !unreadOnly || !m.readBy.includes(id))
      .slice(-limit);
  },
  markRead(id, ids) {
    const set = new Set(ids || this.list().map((m) => m.id));
    for (const m of this.list()) if (set.has(m.id) && !m.readBy.includes(id)) m.readBy.push(id);
    this.save();
  },
  unreadCount(id) { return this.inboxOf(id, { unreadOnly: true, limit: 999 }).length; },

  /** 把收件箱渲染成给模型看的文本（把附件正文也带上） */
  renderInbox(id, limit = 8) {
    const msgs = this.inboxOf(id, { unreadOnly: true, limit });
    if (!msgs.length) return '';
    const nameOf = (aid) => (aid === 'user' ? '用户' : (Org.get(aid) ? Org.get(aid).name : aid));
    return msgs.map((m) => {
      let line = `【来自 ${nameOf(m.from)}｜${m.kind}】${m.subject ? m.subject + '：' : ''}${m.body}`;
      for (const a of m.attachments) {
        line += `\n  ▸ 附件《${a.name}》：${truncate(a.text, 1500)}`;
      }
      return line;
    }).join('\n\n');
  },

  purgeAgents(ids) {
    const set = new Set(ids);
    State.orgBus = this.list().filter((m) => !set.has(m.from) && !set.has(m.to));
    this.save();
  },
  clear() { State.orgBus = []; this.save(); this.emit(null); },

  _subs: new Set(),
  subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); },
  emit(msg) { for (const fn of this._subs) { try { fn(msg); } catch { } } }
};

/* ---------------- 检查者：评审标准写死在代码里，领导改不了 ---------------- */
/* 这是「完全公正」的实现方式：
   · 评审用的 system prompt 是下面的常量，不读节点的 prompt 字段
   · 检查者不能被删除（至少保留 1 名）
   · 检查者不接收领导的分派指令，只接收待审内容
   · 评审结论带打分与必须修改项，打回必须给出可执行理由
*/
const Inspector = {
  CRITERIA: [
    '1. 是否真正回答了被分派的任务，而不是答非所问或泛泛而谈',
    '2. 关键事实是否有依据（引用、数据、工具结果），有没有编造',
    '3. 交付物是否完整可用（该有的部分是否都在，格式是否可用）',
    '4. 有没有明显的逻辑错误、自相矛盾、单位/数字错误',
    '5. 是否遵守了任务里写明的约束（范围、口径、格式要求）',
    '6. 有没有把没做完的事说成做完了'
  ],

  /** 硬编码的评审指令：任何界面操作都改不到这里 */
  SYSTEM_PROMPT() {
    return [
      '你是一名独立的质量检查员，与被检查的下属没有任何隶属关系，也不受其上级影响。',
      '你的唯一职责是判断交付物是否合格，并且必须保持公正：',
      '· 不因为任务看起来简单就放松标准，也不因为交付物很长就给高分',
      '· 只依据任务要求与交付内容本身判断，不看是谁做的',
      '· 交付物有问题时必须明确指出，并给出可以照着改的具体意见',
      '',
      '评审标准：',
      this.CRITERIA.join('\n'),
      '',
      '严格按下面的 JSON 输出，不要输出任何其它内容：',
      '{"verdict":"pass"|"reject","score":0-100,"reasons":["..."],"mustFix":["..."]}',
      'score < 70 或存在实质性缺陷时必须 reject，并在 mustFix 里写清要改什么。'
    ].join('\n');
  },

  /** 同一次评审用哪个节点（多个检查者时轮询，避免总用同一个） */
  pick(excludeIds = []) {
    const all = Org.inspectors().filter((n) => !excludeIds.includes(n.id));
    const pool = all.length ? all : Org.inspectors();
    if (!pool.length) return null;
    this._rr = ((this._rr || 0) + 1) % pool.length;
    return pool[this._rr];
  },

  async review({ task, output, context, inspectorId }) {
    const who = inspectorId ? Org.get(inspectorId) : this.pick();
    if (!who) return { verdict: 'pass', score: 100, reasons: ['未配置检查者，跳过审核'], mustFix: [], skipped: true };

    const payload = [
      '【被分派的任务】',
      task || '(未填写)',
      '',
      context ? '【任务背景】\n' + context + '\n' : '',
      '【待审交付内容】',
      truncate(String(output || ''), 12000),
      '',
      '请给出评审结论（只输出 JSON）。'
    ].filter(Boolean).join('\n');

    let raw = '';
    try {
      const res = await LLM.chat({
        messages: [
          { role: 'system', content: this.SYSTEM_PROMPT() },
          { role: 'user', content: payload }
        ],
        tools: [],                     // 检查者不调用任何工具，避免被工具结果带偏
        signal: State.abort ? State.abort.signal : undefined
      });
      raw = res.text || '';
      State.usage.inTok += res.usage.in || 0;
      State.usage.outTok += res.usage.out || 0;
      State.usage.calls++;
    } catch (e) {
      return { verdict: 'error', score: 0, reasons: ['检查者调用失败：' + e.message], mustFix: ['请检查模型配置后重试'], inspectorId: who.id };
    }

    const parsed = this.parse(raw);
    parsed.inspectorId = who.id;
    parsed.raw = truncate(raw, 600);
    return parsed;
  },

  /** 容错解析：模型可能带 ```json 包裹或多说几句 */
  parse(raw) {
    const text = String(raw || '');
    let json = null;
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidates = [fence && fence[1], text].filter(Boolean);
    for (const c of candidates) {
      const m = /\{[\s\S]*\}/.exec(c);
      if (!m) continue;
      try { json = JSON.parse(m[0]); break; } catch { }
    }
    if (!json || typeof json !== 'object') {
      // 解析不出来：按不通过处理，但标出原因，避免"假通过"
      return { verdict: 'reject', score: 0, reasons: ['检查者返回的不是可解析的 JSON'], mustFix: ['请检查者重新评审'], unparsed: true };
    }
    const verdict = String(json.verdict || '').toLowerCase() === 'pass' ? 'pass' : 'reject';
    const score = Math.max(0, Math.min(100, Number(json.score) || 0));
    const reasons = Array.isArray(json.reasons) ? json.reasons.map(String) : (json.reasons ? [String(json.reasons)] : []);
    const mustFix = Array.isArray(json.mustFix) ? json.mustFix.map(String) : [];
    // 分数过低时即使模型说 pass 也按 reject 处理（防止放水）
    const finalVerdict = (verdict === 'pass' && score >= 70) ? 'pass' : 'reject';
    return { verdict: finalVerdict, score, reasons, mustFix, downgraded: verdict === 'pass' && finalVerdict === 'reject' };
  }
};

/* ---------------- 运行引擎 ---------------- */
const OrgRuntime = {
  running: false,
  abortFlag: false,
  trace: [],            // 本次运行的完整轨迹（UI 实时展示）
  hooks: {},            // UI 注入
  _budget: {},

  /** 子 Agent 可用的工具白名单（排除需要人工确认的敏感工具） */
  TOOL_WHITELIST: ['web_search', 'web_fetch', 'kb_search', 'render_chart', 'render_mermaid',
    'generate_docx', 'generate_xlsx', 'generate_pptx', 'generate_pdf', 'make_html_app',
    'list_artifacts', 'recall', 'delegate_task'],

  say(ev) {
    ev.ts = Date.now();
    this.trace.push(ev);
    if (this.trace.length > 600) this.trace.splice(0, 200);
    const fn = this.hooks.onEvent;
    if (fn) { try { fn(ev); } catch { } }
  },

  reset() {
    this.abortFlag = false;
    this.trace = [];
    this._budget = {};
    Org.resetRun();
  },

  /** 顶部入口：把目标交给大领导，直到产出最终答复 */
  async run(goal, opts = {}) {
    const v = Org.validate();
    if (!v.ok) throw new Error('组织配置不完整：' + v.errs.join('；'));
    if (this.running) throw new Error('已有任务在运行');
    const leader = Org.rootLeader();
    if (!leader) throw new Error('缺少大领导');

    this.running = true;
    this.reset();
    const attachments = opts.attachments || [];
    this.say({ type: 'start', nodeId: leader.id, text: '接收目标：' + truncate(goal, 120), attachments: attachments.map((a) => a.name) });

    // 用户 → 大领导
    OrgBus.send('user', leader.id, { subject: '新任务', body: goal, attachments, kind: 'dispatch' });

    try {
      const res = await this.runNode(leader.id, goal, {
        attachments, depth: 0, top: true, acceptance: opts.acceptance || ''
      });
      this.say({ type: 'finish', nodeId: leader.id, text: '任务结束' });
      return res;
    } finally {
      this.running = false;
      Org.save();
      if (this.hooks.onEnd) this.hooks.onEnd();
    }
  },

  stop() { this.abortFlag = true; for (const n of Org.all()) if (n.status === 'running') n.status = 'idle'; },

  /** 节点的角色 prompt（检查者走硬编码，不用这里的 prompt） */
  buildSystemPrompt(node, ctx = {}) {
    const boss = node.parentId ? Org.get(node.parentId) : null;
    const subs = Org.childrenOf(node.id);
    const subText = subs.length
      ? subs.map((s) => `- ${s.id}｜${s.name}（${ORG_ROLES[s.role].label}）`).join('\n')
      : '（你没有直属下级，需要自己动手完成）';

    const lines = [
      `你是「${node.name}」，一家 AI 公司里的${ORG_ROLES[node.role].label}。`,
      boss ? `你的上级是「${boss.name}」。` : '你是最高负责人，直接对用户负责。',
      '',
      '【你的团队（可以直接分派的对象）】',
      subText,
      '',
      '【工作方式】',
      '· 收到任务先判断：能自己做就直接做；需要拆解就用 dispatch_task 分派给下级（会立刻执行并返回结果）。',
      '· 分派时把「要做什么、验收标准、边界」写清楚，下级看不到你和其他人的对话。',
      '· 你可以用 send_message 给公司里任何人（含平级、下级、上级）发消息，它不会阻塞。',
      '· 有不明白或缺少关键信息时，用 ask_user 直接问用户。',
      '· 最后必须给出可以直接交给上级的成品，不要写"建议你去查"这类空话。',
      '',
      '【硬性要求】',
      '· 你的产出会被独立检查者审核，不合格会被打回重做。请一次性把事实、数据、交付物写清楚。',
      '· 不确定的事要标明"未确认"，不要把猜测写成事实。',
      '· 用中文，结构清晰。'
    ];
    if (node.prompt && node.prompt.trim()) {
      lines.push('', '【上级给你的角色说明】', node.prompt.trim());
    }
    if (ctx.acceptance) lines.push('', '【本次任务的验收标准】', ctx.acceptance);
    return lines.join('\n');
  },

  /** 为某个节点构造工具集 */
  nodeTools(node) {
    const subs = Org.childrenOf(node.id);
    const tools = [];

    if (subs.length) {
      tools.push({
        type: 'function',
        function: {
          name: 'dispatch_task',
          description: '把子任务分派给某个直属下级，会立即执行并返回它的交付结果（已通过检查者审核）。',
          parameters: {
            type: 'object',
            properties: {
              agent_id: { type: 'string', description: '下级 id，可选值：' + subs.map((s) => s.id).join(' / ') },
              task: { type: 'string', description: '要它做的具体事情，自包含（下级看不到你的上下文）' },
              acceptance: { type: 'string', description: '验收标准：什么样算做完' }
            },
            required: ['agent_id', 'task']
          }
        }
      });
    }

    tools.push({
      type: 'function',
      function: {
        name: 'send_message',
        description: '给公司里任意成员发一条消息（不阻塞，对方下次工作时能看到）。可用于同步进展、请求协助、告知结论。',
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: '收件人 id，或填 all 广播' },
            subject: { type: 'string' },
            body: { type: 'string' }
          },
          required: ['to', 'body']
        }
      }
    });

    tools.push({
      type: 'function',
      function: {
        name: 'ask_user',
        description: '当缺少关键信息、或需要用户在多个方案里做选择时，直接向用户提问。',
        parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] }
      }
    });

    // 基础能力：只给白名单里的
    const base = Tools.schemas().filter((t) => this.TOOL_WHITELIST.includes(t.function.name));
    return tools.concat(base);
  },

  /** 执行一次节点：ReAct + 审核 + 打回重做 */
  async runNode(nodeId, task, ctx = {}) {
    const node = Org.get(nodeId);
    if (!node) throw new Error('节点不存在：' + nodeId);
    if (node.role === 'inspector') throw new Error('检查者不执行任务');
    if (this.abortFlag) return { text: '（已停止）', aborted: true };

    const cfg = Org.data;
    let attempt = 0;
    let lastOutput = '';
    let lastReview = null;
    const history = [];   // 打回意见累积给下一次

    while (attempt <= cfg.maxRework) {
      if (this.abortFlag) break;
      attempt++;
      node.status = 'running'; node.lastActive = Date.now(); Org.save();
      this.say({ type: 'node-start', nodeId, attempt, text: `${node.name} 开始工作${attempt > 1 ? `（第 ${attempt} 次，上一轮被打回）` : ''}` });

      let out;
      try {
        out = await this.runAgentLoop(node, task, Object.assign({}, ctx, { rework: history, attempt }));
      } catch (e) {
        node.status = 'error'; Org.save();
        this.say({ type: 'node-error', nodeId, text: `${node.name} 出错：${e.message}` });
        throw e;
      }
      lastOutput = out.text || '';

      // ★ 审核：检查者独立评审
      const rev = await Inspector.review({
        task,
        output: lastOutput,
        context: ctx.acceptance ? '验收标准：' + ctx.acceptance : ''
      });
      lastReview = rev;
      this.say({
        type: 'review', nodeId, inspectorId: rev.inspectorId,
        verdict: rev.verdict, score: rev.score,
        text: `检查者评分 ${rev.score} → ${rev.verdict === 'pass' ? '通过' : '打回'}`,
        reasons: rev.reasons, mustFix: rev.mustFix
      });

      if (rev.verdict === 'pass' || rev.skipped) break;

      if (attempt > cfg.maxRework) {
        // 重做次数用尽：仍然上报，但标记未通过，让上级和用户看到
        node.status = 'blocked'; Org.save();
        this.say({ type: 'node-blocked', nodeId, text: `${node.name} 重做 ${cfg.maxRework} 次仍未通过检查，带着问题上报` });
        break;
      }
      // 把打回意见作为下一轮的输入
      history.push({ attempt, score: rev.score, mustFix: rev.mustFix, reasons: rev.reasons });
      this.say({ type: 'node-rework', nodeId, text: `${node.name} 被打回，问题：` + truncate((rev.mustFix || []).join('；') || (rev.reasons || []).join('；'), 160) });
    }

    node.status = (lastReview && lastReview.verdict === 'pass') ? 'done' : (node.status === 'blocked' ? 'blocked' : 'done');
    node.lastActive = Date.now(); Org.save();

    return { text: lastOutput, review: lastReview, attempts: attempt, node: node.name };
  },

  /** 单个节点的 ReAct 循环 */
  async runAgentLoop(node, task, ctx = {}) {
    const tools = this.nodeTools(node);
    const hasSubs = Org.childrenOf(node.id).length > 0;

    // 收件箱（未读）
    const inbox = OrgBus.renderInbox(node.id);
    if (inbox) OrgBus.markRead(node.id, OrgBus.inboxOf(node.id, { unreadOnly: true, limit: 99 }).map((m) => m.id));

    const taskText = [
      '【当前任务】',
      task,
      '',
      ctx.acceptance ? '【验收标准】\n' + ctx.acceptance + '\n' : '',
      ctx.attachments && ctx.attachments.length
        ? '【随任务附上的材料】\n' + ctx.attachments.map((a) => `《${a.name}》：\n${truncate(a.text, 4000)}`).join('\n\n')
        : '',
      inbox ? '【你的新消息】\n' + inbox : '',
      (ctx.rework && ctx.rework.length)
        ? '【上一版被打回，必须修复】\n' + ctx.rework.map((r) => `- 第 ${r.attempt} 版（${r.score} 分）：${(r.mustFix && r.mustFix.length ? r.mustFix : r.reasons || []).join('；')}`).join('\n')
        : ''
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: this.buildSystemPrompt(node, ctx) },
      { role: 'user', content: taskText }
    ];

    const maxSteps = Number(Org.data.maxStepsPerAgent) || 4;
    let text = '';

    for (let step = 0; step < maxSteps; step++) {
      if (this.abortFlag) break;
      const res = await LLM.chat({
        messages,
        tools,
        signal: State.abort ? State.abort.signal : undefined,
        onDelta: (d, all) => { this.say({ type: 'delta', nodeId: node.id, text: all.slice(-80) }); }
      });
      State.usage.inTok += res.usage.in || 0;
      State.usage.outTok += res.usage.out || 0;
      State.usage.calls++;
      text = res.text || text;

      if (!res.toolCalls.length) break;

      messages.push({
        role: 'assistant', content: res.text || '',
        tool_calls: res.toolCalls.map((c) => ({ id: c.id, name: c.name, arguments: c.arguments }))
      });

      for (const call of res.toolCalls) {
        if (this.abortFlag) break;
        let outText = '';
        try {
          outText = await this.execNodeTool(node, call, ctx);
        } catch (e) {
          outText = '工具执行失败：' + e.message;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: String(outText).slice(0, 12000) });
      }
    }
    return { text };
  },

  /** 节点工具的实际执行 */
  async execNodeTool(node, call, ctx) {
    const name = call.name;
    const args = call.arguments || {};

    if (name === 'dispatch_task') {
      const sub = Org.get(String(args.agent_id || ''));
      if (!sub) throw new Error('找不到这个下级：' + args.agent_id + '（可选：' + Org.childrenOf(node.id).map((s) => s.id).join('/') + '）');
      if (sub.parentId !== node.id) throw new Error(sub.name + ' 不是你的直属下级');
      const d = Org.depth(sub.id);
      if (d >= Org.data.maxDepth) throw new Error('层级超限');

      this.say({
        type: 'dispatch', nodeId: node.id, to: sub.id,
        text: `${node.name} → ${sub.name}：${truncate(args.task, 100)}`
      });
      OrgBus.send(node.id, sub.id, {
        subject: '任务分派', body: String(args.task || ''), kind: 'dispatch'
      });

      const subRes = await this.runNode(sub.id, String(args.task || ''), {
        attachments: ctx.attachments || [],
        depth: (ctx.depth || 0) + 1,
        acceptance: String(args.acceptance || ''),
        top: false
      });

      OrgBus.send(sub.id, node.id, {
        subject: '任务结果', body: truncate(subRes.text, 8000), kind: 'report'
      });
      this.say({
        type: 'report', nodeId: sub.id, to: node.id,
        text: `${sub.name} 交付给 ${node.name}（${subRes.review ? subRes.review.score + ' 分 ' + (subRes.review.verdict === 'pass' ? '通过' : '未通过') : '未审核'}）`
      });

      const rv = subRes.review;
      return [
        `下级「${sub.name}」的交付：`,
        subRes.text || '(空)',
        '',
        rv ? `检查者评分：${rv.score}（${rv.verdict === 'pass' ? '通过' : '未通过'}）` : '',
        rv && rv.mustFix && rv.mustFix.length ? '待改进：' + rv.mustFix.join('；') : ''
      ].filter(Boolean).join('\n');
    }

    if (name === 'send_message') {
      const to = String(args.to || 'all');
      if (to !== 'all' && !Org.get(to)) throw new Error('找不到收件人：' + to);
      OrgBus.send(node.id, to, { subject: String(args.subject || ''), body: String(args.body || ''), kind: 'message' });
      this.say({ type: 'message', nodeId: node.id, to, text: `${node.name} → ${to === 'all' ? '全员' : Org.get(to).name}：${truncate(args.body, 80)}` });
      return '已发送。';
    }

    if (name === 'ask_user') {
      this.say({ type: 'ask', nodeId: node.id, text: `${node.name} 询问用户：${truncate(args.question, 150)}` });
      if (this.hooks.onAsk) {
        try {
          const ans = await this.hooks.onAsk({ nodeId: node.id, question: String(args.question || '') });
          if (ans) {
            OrgBus.send('user', node.id, { subject: '用户的回答', body: ans, kind: 'message' });
            return '用户回答：' + ans;
          }
        } catch { }
      }
      return '用户暂时没有回答，请按最合理的假设继续，并标注这是假设。';
    }

    // 其它基础工具
    const out = await Tools.exec(name, args, { orgNode: node.id });
    if (out && out.display) {
      this.say({ type: 'tool', nodeId: node.id, name, display: out.display, text: `${node.name} 调用了 ${name}` });
    }
    return Tools.toToolText(out, 6000);
  }
};
