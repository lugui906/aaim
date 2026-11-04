/* ============ 13 长期记忆：跨会话事实库 ============ */
const Memory = {
  KEY: 'memory',
  list() {
    const v = Store.get(this.KEY, []);
    return Array.isArray(v) ? v : [];
  },
  save(arr) { Store.set(this.KEY, arr.slice(0, 300)); return arr; },
  add(text, source = 'user') {
    const t = String(text || '').trim();
    if (!t) return null;
    const arr = this.list();
    // 去重：完全相同或高度相似（前 24 字相同）则不重复存
    const sig = t.slice(0, 24).toLowerCase();
    const dup = arr.find((x) => x.text.toLowerCase() === t.toLowerCase() || x.text.slice(0, 24).toLowerCase() === sig);
    if (dup) { dup.ts = Date.now(); this.save(arr); return dup; }
    const item = { id: uid('mem'), text: t.slice(0, 1200), ts: Date.now(), source };
    arr.unshift(item);
    this.save(arr);
    return item;
  },
  remove(id) { this.save(this.list().filter((x) => x.id !== id)); },
  update(id, text) {
    const arr = this.list();
    const it = arr.find((x) => x.id === id);
    if (it) { it.text = String(text).slice(0, 1200); it.ts = Date.now(); this.save(arr); }
  },
  clear() { this.save([]); },
  count() { return this.list().length; },
  /** 注入系统提示的记忆块；按 token 预算截断，新的优先 */
  promptBlock(limit = 1600) {
    const arr = this.list();
    if (!arr.length) return '';
    const head = '【长期记忆】以下是用户在过往会话中确认过、需要长期遵守的事实与偏好（与本轮对话无关的不要强行套用；与用户当前说法冲突时，以当前说法为准）：';
    let out = '';
    for (const m of arr) {
      const line = '- ' + m.text.replace(/\n+/g, ' ');
      if ((out + line).length > limit) break;
      out += line + '\n';
    }
    return head + '\n' + out.trimEnd();
  },
  /** 供 recall 工具使用：关键词粗筛 */
  search(q, k = 8) {
    const arr = this.list();
    const terms = String(q || '').toLowerCase().split(/[\s,，、]+/).filter(Boolean);
    if (!terms.length) return arr.slice(0, k);
    const scored = arr.map((m) => {
      const t = m.text.toLowerCase();
      let s = 0;
      for (const term of terms) if (t.includes(term)) s += 2;
      if (t.includes(String(q).toLowerCase())) s += 3;
      return { ...m, _s: s };
    }).filter((x) => x._s > 0).sort((a, b) => b._s - a._s);
    return scored.slice(0, k);
  }
};

Tools.register({
  name: 'remember', category: 'memory',
  desc: '把一条值得长期记住的事实写入长期记忆（跨会话保留）。适用：用户的固定偏好、常用参数、项目背景、需长期遵守的规则。不要记录一次性的临时信息。',
  params: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要记住的一句话，简洁、自包含，例如「用户偏好深色主题，代码示例用 TypeScript」' },
      reason: { type: 'string', description: '为什么值得长期记住（可选）' }
    },
    required: ['text']
  },
  async run(args) {
    const item = Memory.add(args.text, 'agent');
    if (!item) throw new Error('text 为空');
    return {
      ok: true,
      summary: `已写入长期记忆：${truncate(item.text, 80)}（当前共 ${Memory.count()} 条）`,
      data: { id: item.id, total: Memory.count() },
      display: { kind: 'memory', action: 'add', item, total: Memory.count() }
    };
  }
});

Tools.register({
  name: 'recall', category: 'memory',
  desc: '在长期记忆里检索与关键词相关的事实。系统提示里已自动注入记忆摘要，只有在需要更早/更细的记忆时才调用。',
  params: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] },
  async run(args) {
    const hits = Memory.search(args.query, clamp(Number(args.limit) || 8, 1, 20));
    if (!hits.length) return { ok: true, summary: '长期记忆里没有匹配的内容', data: [], display: { kind: 'memory', action: 'search', hits } };
    return {
      ok: true,
      summary: `命中 ${hits.length} 条长期记忆：\n` + hits.map((h) => '- ' + h.text).join('\n'),
      data: hits.map((h) => ({ text: h.text, ts: h.ts, source: h.source })),
      display: { kind: 'memory', action: 'search', hits }
    };
  }
});

Tools.register({
  name: 'forget', category: 'memory', sensitive: true,
  desc: '删除长期记忆。按关键词匹配删除；keyword 为 * 时清空全部。删除不可撤销。',
  params: { type: 'object', properties: { keyword: { type: 'string', description: '要删除的记忆关键词，或 * 清空全部' } }, required: ['keyword'] },
  async run(args) {
    const kw = String(args.keyword || '').trim();
    if (!kw) throw new Error('keyword 为空');
    if (kw === '*') { const n = Memory.count(); Memory.clear(); return { ok: true, summary: `已清空长期记忆（${n} 条）`, display: { kind: 'memory', action: 'clear', total: 0 } }; }
    const hits = Memory.search(kw, 50);
    hits.forEach((h) => Memory.remove(h.id));
    return { ok: true, summary: hits.length ? `已删除 ${hits.length} 条记忆` : '没有匹配的记忆', display: { kind: 'memory', action: 'remove', hits, total: Memory.count() } };
  }
});
