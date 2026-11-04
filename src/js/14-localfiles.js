/* ============ 14 本机文件读写（File System Access API，需用户授权） ============ */
const LocalFiles = {
  files: new Map(),          // id -> { id, name, handle, text, size, writable }
  lastActiveId: '',

  supported() { return typeof window.showOpenFilePicker === 'function'; },

  /** 必须是用户手势触发（按钮点击） */
  async openPicker({ multiple = true, types = null } = {}) {
    if (!this.supported()) throw new Error('当前浏览器不支持直接读写本机文件（需 Chrome/Edge 86+）。可改用「上传附件」只读解析。');
    const opts = { multiple, excludeAcceptAllOption: false };
    opts.types = types || [{
      description: '文档与文本',
      accept: {
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
        'application/pdf': ['.pdf'],
        'text/plain': ['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yml', '.yaml'],
        'application/json': ['.json'],
        'text/javascript': ['.js', '.mjs', '.ts'],
        'text/html': ['.html'], 'text/css': ['.css'],
        'application/vnd.ms-excel': ['.xls']
      }
    }];
    const handles = await window.showOpenFilePicker(opts);
    const out = [];
    for (const h of handles) {
      const f = await h.getFile();
      const text = await this._readText(f);
      const rec = {
        id: uid('lf'), name: f.name, handle: h, size: f.size,
        text, lastModified: f.lastModified,
        writable: this._isWritable(h)
      };
      this.files.set(rec.id, rec);
      this.lastActiveId = rec.id;
      out.push(rec);
    }
    return out;
  },

  _isWritable(h) {
    try { return h.queryPermission && h.requestPermission ? undefined : undefined; } catch { return undefined; }
  },

  async _readText(file) {
    const name = file.name || '';
    const ext = DocParser.ext(name);
    // 办公文档 / PDF：走解析器
    if (DocParser.isOffice(name) || ext === 'pdf') {
      if (file.size > 40 * 1024 * 1024) return '[文件超过 40MB，未自动解析]';
      try {
        const r = await DocParser.read(file, name);
        return r.text || '';
      } catch (e) {
        return `[解析失败：${e.message}]`;
      }
    }
    const isTexty = /^text\//.test(file.type) || /\.(txt|md|markdown|csv|json|js|mjs|cjs|ts|tsx|jsx|py|html|htm|css|scss|xml|yaml|yml|log|ini|conf|sh|bat|ps1|java|c|h|cpp|hpp|rs|go|rb|php|sql|toml|env|gitignore)$/i.test(name);
    if (!isTexty && file.size > 2 * 1024 * 1024) return null;   // 二进制大文件不读
    try { return await file.text(); } catch { return null; }
  },

  find(nameOrId) {
    if (!nameOrId) { const r = this.files.get(this.lastActiveId); return r || null; }
    if (this.files.has(nameOrId)) return this.files.get(nameOrId);
    for (const f of this.files.values()) if (f.name === nameOrId) return f;
    for (const f of this.files.values()) if (f.name.includes(nameOrId)) return f;
    return null;
  },

  list() {
    return Array.from(this.files.values()).map((f) => ({
      id: f.id, name: f.name, size: f.size,
      chars: f.text == null ? null : f.text.length,
      textFile: f.text != null, active: f.id === this.lastActiveId
    }));
  },

  /** 真正写入；必须由用户点击触发以获取写权限 */
  async write(id, content) {
    const rec = this.files.get(id);
    if (!rec) throw new Error('文件句柄已失效，请重新打开文件');
    if (rec.text == null) throw new Error('该文件不是文本文件，未读取内容，不能覆盖写入');
    let perm = 'granted';
    if (rec.handle.queryPermission) perm = await rec.handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && rec.handle.requestPermission) perm = await rec.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('用户未授予写入权限');
    const w = await rec.handle.createWritable();
    await w.write(content);
    await w.close();
    rec.text = content;
    return { name: rec.name, chars: content.length };
  },

  /** 另存为（也可用于新建文件） */
  async saveAs(suggestedName, content) {
    if (typeof window.showSaveFilePicker !== 'function') throw new Error('当前浏览器不支持「另存为」（需 Chrome/Edge）');
    const h = await window.showSaveFilePicker({ suggestedName: safeName(suggestedName || 'untitled.txt', 'untitled.txt') });
    let perm = 'granted';
    if (h.queryPermission) perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && h.requestPermission) perm = await h.requestPermission({ mode: 'readwrite' });
    const w = await h.createWritable();
    await w.write(content);
    await w.close();
    const rec = { id: uid('lf'), name: h.name, handle: h, size: content.length, text: content, lastModified: Date.now() };
    this.files.set(rec.id, rec);
    this.lastActiveId = rec.id;
    return { id: rec.id, name: h.name, chars: content.length };
  },

  /** 行级 diff（只做可视化，不参与写入） */
  diff(oldText, newText) {
    const a = String(oldText || '').split('\n');
    const b = String(newText || '').split('\n');
    const out = [];
    const n = Math.max(a.length, b.length);
    // 简单 LCS 片段：先用公共前后缀裁剪，中间整体按变更处理（足够看清改了什么）
    let pre = 0;
    while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
    let sufA = a.length, sufB = b.length;
    while (sufA > pre && sufB > pre && a[sufA - 1] === b[sufB - 1]) { sufA--; sufB--; }
    const ctx = 3;
    const s = Math.max(0, pre - ctx), e = Math.min(a.length, sufA + ctx);
    for (let i = s; i < pre; i++) out.push({ t: ' ', s: a[i], n: i + 1 });
    for (let i = pre; i < sufA; i++) out.push({ t: '-', s: a[i], n: i + 1 });
    const newStart = pre;
    for (let i = pre; i < sufB; i++) out.push({ t: '+', s: b[i], n: i - newStart + 1 });
    for (let i = sufA; i < e; i++) out.push({ t: ' ', s: a[i], n: i + 1 });
    const added = out.filter((x) => x.t === '+').length;
    const removed = out.filter((x) => x.t === '-').length;
    return { rows: out, added, removed, unchanged: pre + (a.length - sufA) };
  }
};

/* ---------------- 工具 ---------------- */
Tools.register({
  name: 'local_list_files', category: 'localfile',
  desc: '列出本次会话里用户已授权的本机文件（文件名、大小、字符数、是否文本）。支持 Word/Excel/PPT/PDF 的文本提取。写入前先用它确认目标文件。',
  params: { type: 'object', properties: {} },
  async run() {
    const list = LocalFiles.list();
    if (!list.length) {
      return {
        ok: true,
        summary: '还没有已授权的本机文件。请让用户点击输入框左侧的「📂」按钮选择文件（浏览器要求用户亲自选中，网页不能自行遍历磁盘）。',
        data: [], display: { kind: 'localfiles', list: [] }
      };
    }
    return { ok: true, summary: `已授权 ${list.length} 个文件：\n` + list.map((f) => `- ${f.name}（${fmtBytes(f.size)}${f.chars != null ? '，' + f.chars + ' 字' : '，二进制'}）`).join('\n'), data: list, display: { kind: 'localfiles', list } };
  }
});

Tools.register({
  name: 'local_read_file', category: 'localfile',
  desc: '读取用户已授权的本机文件的文本内容，可按行区间读取（大文件建议分段）。未授权任何文件时提示用户点「📂」选择。',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '文件名（可只写一部分）；留空则用最近打开的那个' },
      start_line: { type: 'integer', description: '起始行，从 1 开始' },
      max_lines: { type: 'integer', description: '最多返回多少行，默认 400' }
    }
  },
  async run(args) {
    const rec = LocalFiles.find(args.name);
    if (!rec) throw new Error('没有找到该文件。请用户点击「📂」按钮先选择它（网页不能自行读磁盘）。');
    if (rec.text == null) throw new Error(`「${rec.name}」不是可读文本（支持的文档类型：PDF / DOCX / XLSX / PPTX / 纯文本）`);
    const lines = rec.text.split('\n');
    const start = clamp((Number(args.start_line) || 1) - 1, 0, Math.max(0, lines.length - 1));
    const max = clamp(Number(args.max_lines) || 400, 1, 2000);
    const slice = lines.slice(start, start + max);
    const body = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
    return {
      ok: true,
      summary: `读取「${rec.name}」第 ${start + 1}–${start + slice.length} 行（共 ${lines.length} 行，${rec.text.length} 字符）`,
      data: body,
      display: { kind: 'localfileRead', name: rec.name, total: lines.length, start: start + 1, end: start + slice.length, preview: slice.slice(0, 40).join('\n') }
    };
  }
});

Tools.register({
  name: 'local_write_file', category: 'localfile', sensitive: true,
  desc: '修改用户已授权的本机文件。只生成待写入的内容与差异预览，真正的写入需要用户在卡片上点击「写入文件」按钮（浏览器安全模型要求）。mode=replace 整文件覆盖；mode=patch 用 find/replace 精确替换（更安全，推荐）。',
  params: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '目标文件名（可部分匹配）；留空用最近打开的文件' },
      mode: { type: 'string', description: 'replace 或 patch，默认 patch' },
      content: { type: 'string', description: 'mode=replace 时的新全文' },
      find: { type: 'string', description: 'mode=patch 时要替换的原文（必须唯一且逐字一致）' },
      replace: { type: 'string', description: 'mode=patch 时替换成的内容' },
      all: { type: 'boolean', description: 'patch 模式下是否替换所有出现，默认 false（只替换唯一匹配）' }
    },
    required: ['name']
  },
  async run(args) {
    const rec = LocalFiles.find(args.name);
    if (!rec) throw new Error('没有找到该文件。请用户点击「📂」按钮先选择它。');
    if (rec.text == null) throw new Error('该文件不是文本文件，不能编辑');
    const mode = args.mode === 'replace' ? 'replace' : 'patch';
    let next;
    if (mode === 'replace') {
      if (State.settings.localAllowReplace === false) throw new Error('设置里已关闭「允许整文件覆盖」，请改用 mode=patch 精确替换');
      if (typeof args.content !== 'string') throw new Error('mode=replace 需要 content');
      next = args.content;
    } else {
      if (!args.find) throw new Error('mode=patch 需要 find');
      const occurrences = rec.text.split(args.find).length - 1;
      if (occurrences === 0) throw new Error('原文里找不到要替换的片段，请先用 local_read_file 确认实际内容（注意缩进与换行）');
      if (occurrences > 1 && !args.all) throw new Error(`该片段出现 ${occurrences} 次，请补充上下文使其唯一，或设置 all=true`);
      next = args.all ? rec.text.split(args.find).join(args.replace || '') : rec.text.replace(args.find, args.replace || '');
    }
    const d = LocalFiles.diff(rec.text, next);
    return {
      ok: true,
      summary: `已准备好「${rec.name}」的修改：+${d.added} 行 / -${d.removed} 行。需要用户点击卡片上的「写入文件」才会真正保存。`,
      data: { name: rec.name, added: d.added, removed: d.removed },
      display: { kind: 'writeplan', fileId: rec.id, name: rec.name, mode, content: next, diff: d }
    };
  }
});

Tools.register({
  name: 'local_save_as', category: 'localfile',
  desc: '把内容另存为本机新文件（也可当「新建文件」用）。生成待保存卡片，用户点击「选择位置并保存」后才会落盘。',
  params: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '建议的文件名，如 notes.md' },
      content: { type: 'string', description: '文件内容' }
    },
    required: ['filename', 'content']
  },
  async run(args) {
    if (typeof args.content !== 'string') throw new Error('content 必须是字符串');
    return {
      ok: true,
      summary: `已准备好另存为「${args.filename}」（${args.content.length} 字符）。需要用户点击「选择位置并保存」。`,
      data: { filename: args.filename, chars: args.content.length },
      display: { kind: 'saveplan', filename: args.filename, content: args.content }
    };
  }
});
