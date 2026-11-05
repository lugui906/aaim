/* ============ 19 企业模式 UI：组织树 / 运行轨迹 / 消息总线 ============ */
const OrgUI = {
  inited: false,
  _lastEventAt: 0,

  init() {
    if (this.inited) return;
    this.inited = true;

    // 惰性初始化组织架构：保证首次进入就有可用的团队（领导 + 小领导 + 执行者 + 检查者）
    if (!State.org || !Array.isArray(State.org.nodes) || !State.org.nodes.length) {
      State.org = Org.defaults();
      Org.save();
    }

    // 模式切换由顶栏 #modeChip → App.toggleOrgMode() 负责，这里不再重复绑定

    // 组织树操作
    $('#orgAddLeader') && $('#orgAddLeader').addEventListener('click', () => this.addNodeDialog('leader'));
    $('#orgRunBtn') && $('#orgRunBtn').addEventListener('click', () => this.startRun());
    $('#orgStopBtn') && $('#orgStopBtn').addEventListener('click', () => {
      OrgRuntime.stop();
      toast('已请求停止', '');
      this.render();
    });
    $('#orgResetBtn') && $('#orgResetBtn').addEventListener('click', () => {
      Org.resetRun(); OrgRuntime.trace = []; this.render(); toast('已重置状态', 'ok');
    });
    $('#orgBusBtn') && $('#orgBusBtn').addEventListener('click', () => this.openBus());
    $('#orgClearBus') && $('#orgClearBus').addEventListener('click', () => {
      OrgBus.clear(); this.openBus(); toast('消息已清空');
    });

    // 运行轨迹订阅
    OrgRuntime.hooks.onEvent = (ev) => this.appendEvent(ev);
    OrgRuntime.hooks.onAsk = (q) => this.askUser(q);
    OrgRuntime.hooks.onEnd = () => { this.render(); this.setRunningUI(false); };

    // 目标输入
    const ta = $('#orgGoal');
    if (ta) {
      ta.addEventListener('input', () => autoGrow(ta));
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.startRun(); }
      });
    }
    const fileInput = $('#orgFile');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => { this.attachFiles(Array.from(e.target.files || [])); e.target.value = ''; });
    }
    const attachBtn = $('#orgAttachBtn');
    if (attachBtn) attachBtn.addEventListener('click', () => fileInput && fileInput.click());

    State.orgAttachments = [];

    if (State.org && State.org.enabled) this.applyMode(true);
  },

  toggleMode() {
    const on = !(Org.data.enabled);
    Org.data.enabled = on;
    Org.save();
    this.applyMode(on);
    toast(on ? '已进入企业模式：把目标交给大领导' : '已回到普通对话模式', 'ok', 2200);
  },

  applyMode(on) {
    document.body.classList.toggle('org-mode', !!on);
    // 顶栏 chip 的外观由 UI.updateModeChip() 统一维护，这里不再重复操作不存在的 #modeSwitch
    if (on) {
      this.render();
      // 关键：进入企业模式时必须放上引导占位，否则中间是一大片空白
      if (!$('#orgTrace') || !$('#orgTrace').children.length) this.clearTrace();
      setTimeout(() => { const g = $('#orgGoal'); if (g && !g.value) g.focus(); }, 120);
    }
  },

  setRunningUI(run) {
    const r = $('#orgRunBtn'), s = $('#orgStopBtn');
    if (r) { r.style.display = run ? 'none' : ''; r.disabled = run; }
    if (s) s.style.display = run ? '' : 'none';
    const g = $('#orgGoal');
    if (g) g.disabled = run;
  },

  /* ---------------- 渲染组织树 ---------------- */
  render() {
    this.renderTree();
    this.renderStats();
  },

  renderTree() {
    const box = $('#orgTree');
    if (!box) return;
    box.innerHTML = '';
    const leader = Org.rootLeader();
    if (!leader) { box.append(el('div', { class: 'org-empty', text: '还没有大领导' })); return; }

    const build = (node, depth) => {
      const kids = Org.childrenOf(node.id);
      const role = ORG_ROLES[node.role];
      const unread = OrgBus.unreadCount(node.id);
      const st = node.status || 'idle';

      // 名字里已经包含角色名时不再重复显示（否则会出现「大领导 大领导」「执行者 A 执行者」）
      const nm = String(node.name || '').trim();
      const showRole = !nm.includes(role.label);
      const row = el('div', {
        class: `orgnode role-${node.role} st-${st}`,
        style: `--depth:${depth}`,
        title: `${role.label}${node.prompt ? '\n' + node.prompt.slice(0, 80) : ''}`
      },
        el('span', { class: 'org-dot' }),
        el('span', { class: 'org-name', text: node.name }),
        showRole ? el('span', { class: 'org-role', text: role.label }) : null,
        unread ? el('span', { class: 'org-unread', text: String(unread), title: unread + ' 条未读消息' }) : null,
        el('span', { class: 'org-acts' },
          role.canDelegate ? el('button', {
            class: 'org-mini', title: '添加下级', text: '+',
            onclick: (e) => { e.stopPropagation(); this.addNodeDialog(node.role === 'leader' ? 'subleader' : 'worker', node.id); }
          }) : null,
          el('button', {
            class: 'org-mini', title: '编辑', text: '⋯',
            onclick: (e) => { e.stopPropagation(); this.editNodeDialog(node.id); }
          }),
          (node.role === 'leader' && !node.parentId) ? null : el('button', {
            class: 'org-mini danger', title: '删除', text: '×',
            onclick: (e) => {
              e.stopPropagation();
              try { Org.remove(node.id); this.render(); toast('已删除', 'ok'); }
              catch (err) { toast(err.message, 'err', 4000); }
            }
          })));

      const wrap = el('div', { class: 'orgitem' }, row);
      if (kids.length) {
        const kidsBox = el('div', { class: 'orgkids' });
        for (const k of kids) kidsBox.append(build(k, depth + 1));
        wrap.append(kidsBox);
      }
      return wrap;
    };

    // 指挥链
    box.append(el('div', { class: 'org-sec', text: '指挥链' }));
    box.append(build(leader, 0));

    // 检查者（独立分组，显示"独立于指挥链"）
    box.append(el('div', { class: 'org-sec', text: '独立监督' }));
    const inspectors = Org.inspectors();
    if (!inspectors.length) box.append(el('div', { class: 'org-empty', text: '缺少检查者（必须至少 1 名）' }));
    for (const ins of inspectors) {
      box.append(el('div', { class: 'orgitem' },
        el('div', { class: `orgnode role-inspector st-${ins.status || 'idle'}` },
          el('span', { class: 'org-dot' }),
          el('span', { class: 'org-name', text: ins.name }),
          el('span', { class: 'org-role lock', title: '评审标准由代码固定，任何角色都改不了', text: '公正' }),
          el('span', { class: 'org-acts' },
            el('button', { class: 'org-mini', title: '查看评审标准', text: '?', onclick: (e) => { e.stopPropagation(); this.showCriteria(); } }),
            el('button', { class: 'org-mini', title: '重命名', text: '⋯', onclick: (e) => { e.stopPropagation(); this.editNodeDialog(ins.id, true); } }),
            inspectors.length > 1 ? el('button', {
              class: 'org-mini danger', text: '×', onclick: (e) => {
                e.stopPropagation();
                try { Org.remove(ins.id); this.render(); } catch (err) { toast(err.message, 'err'); }
              }
            }) : null))));
    }
    box.append(el('button', {
      class: 'org-addins', text: '+ 增加检查者', onclick: () => this.addNodeDialog('inspector')
    }));
  },

  renderStats() {
    const box = $('#orgStats');
    if (!box) return;
    const chain = Org.chain();
    const nodes = Org.all();          // 统计要含检查者，否则人数对不上
    const running = nodes.filter((n) => n.status === 'running').length;
    const done = nodes.filter((n) => n.status === 'done').length;
    const blocked = nodes.filter((n) => n.status === 'blocked').length;
    const reviews = OrgRuntime.trace.filter((e) => e.type === 'review');
    const passed = reviews.filter((e) => e.verdict === 'pass').length;
    const rejected = reviews.filter((e) => e.verdict !== 'pass').length;
    box.innerHTML = '';
    const item = (k, v, cls, tip) => box.append(el('span', { class: 'ostat ' + (cls || ''), title: tip || '' }, el('b', { text: String(v) }), el('span', { text: k })));
    item('在编', nodes.length, '', '指挥链 + 检查者');
    item(running > 1 ? '并行中' : '运行中', running, running ? 'hot' : '');
    item('完成', done, done ? 'ok' : '');
    blocked ? item('未通过', blocked, 'warn') : null;
    item('审核通过', passed, passed ? 'ok' : '');
    item('被打回', rejected, rejected ? 'warn' : '');
    item('消息', OrgBus.list().length);
  },

  /* ---------------- 运行轨迹 ---------------- */
  appendEvent(ev) {
    const box = $('#orgTrace');
    if (!box) return;
    const empty = box.querySelector('.trace-empty');
    if (empty) empty.remove();

    const nodeName = (id) => {
      if (!id) return '';
      if (id === 'user') return '你';
      const n = Org.get(id);
      return n ? n.name : id;
    };
    const roleCls = (id) => { const n = Org.get(id); return n ? 'role-' + n.role : ''; };

    let node = null;
    if (ev.type === 'start') {
      node = el('div', { class: 'tevt tevt-start' },
        el('span', { class: 'tevt-ico', html: Icons.send(13) }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd', text: '任务开始' }),
          el('div', { class: 'tevt-tx', text: ev.text }),
          ev.attachments && ev.attachments.length ? el('div', { class: 'tevt-att', text: '附件：' + ev.attachments.join('、') }) : null));
    } else if (ev.type === 'node-start') {
      node = el('div', { class: 'tevt tevt-nodestart ' + roleCls(ev.nodeId) },
        el('span', { class: 'tevt-ico', html: Icons.worker ? Icons.worker(13) : '' }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' }, el('b', { text: nodeName(ev.nodeId) }), el('span', { class: 'tevt-tag', text: '开始' })),
          el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'dispatch') {
      node = el('div', { class: 'tevt tevt-dispatch' + (ev.group ? ' in-parallel' : '') },
        el('span', { class: 'tevt-ico', html: Icons.lead ? Icons.lead(13) : '' }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' },
            el('span', { class: 'who ' + roleCls(ev.nodeId), text: nodeName(ev.nodeId) }),
            el('span', { class: 'arrow', text: '→' }),
            el('span', { class: 'who ' + roleCls(ev.to), text: nodeName(ev.to) }),
            ev.group ? el('span', { class: 'tevt-tag par', text: '并行' }) : null),
          el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'report') {
      node = el('div', { class: 'tevt tevt-report' + (ev.group ? ' in-parallel' : '') },
        el('span', { class: 'tevt-ico', html: Icons.check(13) }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' },
            el('span', { text: ev.text }),
            ev.group ? el('span', { class: 'tevt-tag par', text: '并行' }) : null),
          ev.group ? el('div', { class: 'tevt-tx', text: `交付给 ${nodeName(ev.to)}` }) : null));
    } else if (ev.type === 'review') {
      const pass = ev.verdict === 'pass';
      node = el('div', { class: 'tevt tevt-review ' + (pass ? 'pass' : 'reject') },
        el('span', { class: 'tevt-ico', html: Icons.shield ? Icons.shield(13) : '' }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' },
            el('b', { text: nodeName(ev.inspectorId) }),
            el('span', { class: 'verdict ' + (pass ? 'ok' : 'no'), text: pass ? '通过' : '打回' }),
            el('span', { class: 'score', text: ev.score + ' 分' }),
            el('span', { class: 'sub', text: '审核 ' + nodeName(ev.nodeId) })),
          (ev.reasons && ev.reasons.length) ? el('div', { class: 'tevt-tx', text: ev.reasons.join('；') }) : null,
          (ev.mustFix && ev.mustFix.length) ? el('div', { class: 'tevt-fix', text: '必须改：' + ev.mustFix.join('；') }) : null));
    } else if (ev.type === 'parallel-start' || ev.type === 'parallel-end') {
      const isStart = ev.type === 'parallel-start';
      node = el('div', { class: 'tevt tevt-parallel' },
        el('span', { class: 'tevt-ico', html: Icons.flow ? Icons.flow(13) : '' }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' },
            el('b', { text: isStart ? '并行分派' : '并行完成' }),
            el('span', { class: 'tevt-tag', text: '同时执行' })),
          el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'node-rework') {
      node = el('div', { class: 'tevt tevt-warn' },
        el('span', { class: 'tevt-ico', html: Icons.retry(13) }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'node-blocked') {
      node = el('div', { class: 'tevt tevt-warn' },
        el('span', { class: 'tevt-ico', html: Icons.alert(13) }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'node-error') {
      node = el('div', { class: 'tevt tevt-err' },
        el('span', { class: 'tevt-ico', html: Icons.alert(13) }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'message') {
      node = el('div', { class: 'tevt tevt-msg' },
        el('span', { class: 'tevt-ico', html: Icons.mail ? Icons.mail(13) : '' }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'ask') {
      node = el('div', { class: 'tevt tevt-ask' },
        el('span', { class: 'tevt-ico', html: Icons.alert(13) }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-tx', text: ev.text })));
    } else if (ev.type === 'tool') {
      node = el('div', { class: 'tevt tevt-tool' },
        el('span', { class: 'tevt-ico', html: Icons.tool(13) }),
        el('div', { class: 'tevt-body' },
          el('div', { class: 'tevt-hd' }, el('span', { class: 'who', text: nodeName(ev.nodeId) }), el('span', { class: 'tevt-tag', text: ev.name }))));
      if (ev.display && ['chart', 'images', 'mermaid', 'file', 'fileframe'].includes(ev.display.kind)) {
        node.querySelector('.tevt-body').append(UI.displayNode(ev.display, { name: ev.name }));
      }
    } else if (ev.type === 'finish') {
      node = el('div', { class: 'tevt tevt-finish' },
        el('span', { class: 'tevt-ico', html: Icons.check(13) }),
        el('div', { class: 'tevt-body' }, el('div', { class: 'tevt-hd', text: '任务结束' })));
    } else {
      return;   // delta 之类的不渲染
    }

    if (node) {
      box.append(node);
      scrollBottomOrg();
      this.renderStats();
      // 状态变化时刷新树上的点
      this._treeTick = (this._treeTick || 0) + 1;
      if (this._treeTick % 3 === 0) this.renderTree();
    }
  },

  clearTrace() {
    const box = $('#orgTrace');
    if (!box) return;
    box.innerHTML = '';
    const lead = Org.rootLeader();
    const members = Org.all();
    const flow = el('div', { class: 'te-flow' },
      el('span', { class: 'tef-node lead', text: lead ? lead.name : '大领导' }),
      el('span', { class: 'tef-arrow', text: '→' }),
      el('span', { class: 'tef-node', text: '小领导' }),
      el('span', { class: 'tef-arrow', text: '→' }),
      el('span', { class: 'tef-node', text: '执行者' }),
      el('span', { class: 'tef-arrow', text: '→' }),
      el('span', { class: 'tef-node insp', text: '检查者' }));
    box.append(el('div', { class: 'trace-empty' },
      el('div', { class: 'te-ico', html: Icons.flow ? Icons.flow(22) : '' }),
      el('h3', { text: '把目标交给团队' }),
      el('p', { class: 'sub', text: '写在下面的输入框里发给大领导。它会拆解任务、分派给小领导与执行者，每份产出都要过独立检查者 —— 不合格会被打回重做。' }),
      flow,
      el('div', { class: 'te-tips' },
        el('div', {}, el('b', { text: String(members.length) }), el('span', { text: ' 名成员在编' })),
        el('div', {}, el('b', { text: '1' }), el('span', { text: ' 名独立检查者（标准固定）' })),
        el('div', {}, el('b', { text: '3' }), el('span', { text: ' 层可嵌套（领导/小领导/执行者）' }))),
      el('p', { class: 'te-hint', text: '小提示：左侧组织架构里可以加人、改角色说明；工具结果卡片上点「交给团队」可把材料一并带上。' })));
  },

  /* ---------------- 运行 ---------------- */
  async startRun() {
    const ta = $('#orgGoal');
    const goal = (ta && ta.value || '').trim();
    if (!goal) return toast('先写清楚要让团队做什么', 'err');

    const v = Org.validate();
    if (!v.ok) return toast('组织配置不完整：' + v.errs.join('；'), 'err', 6000);
    if (!curKeyReady()) return toast('还没配模型 Key：右上角 ⚙ → 模型', 'err', 6000);

    const atts = State.orgAttachments || [];
    if (ta) { ta.value = ''; autoGrow(ta); }
    State.orgAttachments = []; this.renderOrgAttachments();

    this.clearTrace();
    this.setRunningUI(true);
    toast('已交给大领导，团队开始工作', 'ok', 2200);
    try {
      const res = await OrgRuntime.run(goal, { attachments: atts });
      this.appendFinal(res);
    } catch (e) {
      toast('运行失败：' + e.message, 'err', 7000);
      this.appendEvent({ type: 'node-error', text: e.message });
    } finally {
      this.setRunningUI(false);
      this.render();
    }
  },

  appendFinal(res) {
    const box = $('#orgTrace');
    if (!box) return;
    const rv = res && res.review;
    const node = el('div', { class: 'finalcard' },
      el('div', { class: 'fc-hd' },
        el('b', { text: '最终交付' }),
        rv ? el('span', { class: 'verdict ' + (rv.verdict === 'pass' ? 'ok' : 'no'), text: rv.verdict === 'pass' ? '检查通过' : '检查未通过' }) : null,
        rv ? el('span', { class: 'score', text: rv.score + ' 分' }) : null,
        el('span', { style: 'flex:1' }),
        el('button', { class: 'btn sm ghost', html: Icons.copy(13) + '<span>复制</span>', onclick: () => copyText(res.text || '') })),
      el('div', { class: 'fc-body md', html: MD.render(res.text || '') }),
      rv && rv.mustFix && rv.mustFix.length
        ? el('div', { class: 'fc-fix', text: '检查者要求继续改进：' + rv.mustFix.join('；') })
        : null);
    box.append(node);
    scrollBottomOrg();
    MD.highlight(node);
  },

  askUser({ nodeId, question }) {
    return new Promise((resolve) => {
      const who = Org.get(nodeId);
      let done = false;
      const m = openModal({
        title: (who ? who.name : '成员') + ' 想确认一件事',
        bodyHTML: '',
        okText: '提交回答',
        cancelText: '跳过',
        onOk: (body) => {
          done = true;
          const v = (body.querySelector('textarea') || {}).value || '';
          resolve(v.trim());
        }
      });
      m.body.append(el('div', { class: 'hint', style: 'margin-bottom:8px', text: question }));
      m.body.append(el('textarea', { rows: '4', placeholder: '回答会作为消息发回给它…', style: 'width:100%' }));
      // 取消/关闭时视为跳过
      const obs = new MutationObserver(() => {
        if (!document.querySelector('#modal').classList.contains('open') && !done) { done = true; resolve(''); obs.disconnect(); }
      });
      obs.observe($('#modal'), { attributes: true, attributeFilter: ['class'] });
    });
  },

  /* ---------------- 节点编辑 ---------------- */
  addNodeDialog(role, parentId = null) {
    const roleName = ORG_ROLES[role] ? ORG_ROLES[role].label : role;
    const parent = parentId ? Org.get(parentId) : null;
    let n = 1;
    const base = role === 'worker' ? '执行者' : role === 'subleader' ? '小领导' : role === 'inspector' ? '检查者' : '领导';
    while (Org.all().some((x) => x.name === `${base} ${n}`)) n++;
    const defName = `${base} ${n}`;

    const nameInput = el('input', { type: 'text', value: defName });
    const promptArea = el('textarea', { rows: '3', placeholder: '给它的角色说明（可留空）' });
    const body = el('div', {},
      el('div', { class: 'field' }, el('label', { text: '名称' }), nameInput),
      role === 'inspector'
        ? el('div', { class: 'hint', text: '检查者的评审标准由代码固定，任何人都改不了，保证公正。' })
        : el('div', { class: 'field' }, el('label', { text: '角色说明' }), promptArea));

    openModal({
      title: `添加${roleName}` + (parent ? `（隶属 ${parent.name}）` : ''),
      bodyHTML: '', okText: '添加',
      onOk: () => {
        try {
          Org.add({ role, parentId, name: nameInput.value.trim() || defName, prompt: promptArea.value.trim() });
          this.render();
          toast('已添加', 'ok');
        } catch (e) { toast(e.message, 'err', 5000); return false; }
      }
    }).body.append(body);
  },

  editNodeDialog(id, nameOnly = false) {
    const n = Org.get(id);
    if (!n) return;
    const nameInput = el('input', { type: 'text', value: n.name });
    const promptArea = el('textarea', { rows: '5', placeholder: '角色说明' });
    promptArea.value = n.prompt || '';

    const wrap = el('div', {},
      el('div', { class: 'field' }, el('label', { text: '名称' }), nameInput));
    if (!nameOnly && n.role !== 'inspector') {
      wrap.append(el('div', { class: 'field' }, el('label', { text: '角色说明' }), promptArea));
      const subs = Org.childrenOf(id);
      // 允许调整归属（换上级）
      if (n.parentId) {
        const opts = Org.chain().filter((x) => x.id !== id && ORG_ROLES[x.role].canDelegate && Org.depth(x.id) < Org.depth(id));
        if (opts.length) {
          const sel = el('select', {});
          sel.append(el('option', { value: '', text: '（保持当前上级）' }));
          for (const o of opts) sel.append(el('option', { value: o.id, text: o.name + '（' + ORG_ROLES[o.role].label + '）' }));
          wrap.append(el('div', { class: 'field' }, el('label', { text: '改上级' }), sel));
          wrap._parentSel = sel;
        }
      }
    }
    if (n.role === 'inspector') {
      wrap.append(el('div', { class: 'hint', text: '评审标准固定为 6 条（回答准确性、事实依据、交付完整性、逻辑一致性、约束遵守、不虚报完成），不可修改。' }));
    }

    openModal({
      title: '编辑 · ' + n.name, bodyHTML: '', okText: '保存',
      onOk: () => {
        const patch = { name: nameInput.value.trim() || n.name };
        if (!nameOnly && n.role !== 'inspector') patch.prompt = promptArea.value;
        if (wrap._parentSel && wrap._parentSel.value) patch.parentId = wrap._parentSel.value;
        Org.update(id, patch);
        this.render();
        toast('已保存', 'ok');
      }
    }).body.append(wrap);
  },

  showCriteria() {
    openModal({
      title: '检查者的评审标准（代码固定）',
      hideCancel: true, okText: '关闭',
      bodyHTML: `<div class="hint" style="margin-bottom:10px">以下标准写在代码里，任何角色（包括大领导）都无法修改，也不能删除最后一名检查者。</div>
        <ol style="padding-left:18px;line-height:1.9;color:var(--text-1)">
          ${Inspector.CRITERIA.map((c) => `<li>${esc(String(c).replace(/^\d+\.\s*/, ''))}</li>`).join('')}
        </ol>
        <div class="hint" style="margin-top:10px">输出格式：<code>{"verdict":"pass|reject","score":0-100,"reasons":[],"mustFix":[]}</code><br>
        分数低于 70 分即使模型判 pass 也会被降级为 reject（防止放水）。</div>`
    });
  },

  /* ---------------- 消息总线 ---------------- */
  openBus() {
    const list = OrgBus.list().slice().reverse();
    const nameOf = (id) => (id === 'user' ? '你' : (Org.get(id) ? Org.get(id).name : id));
    const rows = list.length
      ? list.map((m) => {
        const cls = { dispatch: 'd', report: 'r', review: 'v', message: 'm' }[m.kind] || 'm';
        return `<div class="busrow ${cls}">
          <div class="bus-hd"><b>${esc(nameOf(m.from))}</b><span class="arrow">→</span><b>${esc(m.to === 'all' ? '全员' : nameOf(m.to))}</b>
          <span class="bus-kind">${esc(m.kind)}</span><span class="bus-t">${fmtTime(m.ts).slice(11, 16)}</span></div>
          ${m.subject ? `<div class="bus-sub">${esc(m.subject)}</div>` : ''}
          <div class="bus-body">${esc(truncate(m.body, 300))}</div>
          ${m.attachments.length ? `<div class="bus-att">附件：${m.attachments.map((a) => esc(a.name) + '（' + a.chars + ' 字）').join('、')}</div>` : ''}
        </div>`;
      }).join('')
      : '<div class="hint">还没有任何消息。运行一次任务后，这里会显示全部往来。</div>';
    openModal({
      title: `消息总线（${list.length} 条）`, hideCancel: true, okText: '关闭',
      bodyHTML: `<div class="hint" style="margin-bottom:10px">所有 Agent 之间的往来都在这里，包含分派、交付、审核结论与附带的工具结果。</div><div class="buslist">${rows}</div>`
    });
  },

  /* ---------------- 附件（可把工具结果/上传内容随下一轮发送） ---------------- */
  async attachFiles(files) {
    if (!state0(files)) return;
    if (!State.orgAttachments) State.orgAttachments = [];
    for (const f of files) {
      try {
        let text = '';
        const ext = DocParser.ext(f.name);
        if (DocParser.isOffice(f.name) || ext === 'pdf') {
          const r = await DocParser.read(f, f.name);
          text = r.text || '';
        } else if (/^image\//.test(f.type)) {
          text = '[图片文件：' + f.name + '，' + fmtBytes(f.size) + ']';
        } else {
          text = await f.text();
        }
        State.orgAttachments.push({ name: f.name, kind: 'file', text: text.slice(0, 20000), chars: text.length });
      } catch (e) { toast(f.name + ' 读取失败：' + e.message, 'err', 5000); }
    }
    this.renderOrgAttachments();
    toast(`已附加 ${State.orgAttachments.length} 个材料，会随任务一起发给大领导`, 'ok', 2600);
  },

  /** 把任意文本作为材料附加（如工具返回结果） */
  attachText(name, text, kind = 'tool') {
    if (!State.orgAttachments) State.orgAttachments = [];
    State.orgAttachments.push({ name, kind, text: String(text || '').slice(0, 20000), chars: String(text || '').length });
    this.renderOrgAttachments();
  },

  renderOrgAttachments() {
    const box = $('#orgAttach');
    if (!box) return;
    const arr = State.orgAttachments || [];
    box.innerHTML = '';
    box.style.display = arr.length ? 'flex' : 'none';
    arr.forEach((a, i) => {
      box.append(el('span', { class: 'a' },
        el('span', { class: 'artico', html: Icons.file(12) }),
        el('span', { class: 'aname', text: a.name }),
        el('span', { class: 'achars', text: a.chars + ' 字' }),
        el('span', { class: 'rm', html: Icons.close(10), onclick: () => { arr.splice(i, 1); this.renderOrgAttachments(); } })));
    });
  }
};

function state0(x) { return x && x.length; }
function scrollBottomOrg() {
  const s = $('#orgTrace');
  if (!s) return;
  const near = s.scrollHeight - s.scrollTop - s.clientHeight < 200;
  if (near) s.scrollTop = s.scrollHeight;
}
