/* ============ 07 自包含 Markdown 渲染（不依赖 CDN，先转义再解析） ============ */
const MD = {
  inline(s) {
    let t = esc(s);
    // 行内代码先占位，避免内部被其它规则改写
    const codes = [];
    t = t.replace(/`([^`\n]+)`/g, (m, c) => { codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000'; });
    t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
    t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g, (m, txt, href) => {
      const safeHref = /^(https?:|mailto:|#|\/|\.\/|data:image\/)/i.test(href) ? href : '#';
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    t = t.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    t = t.replace(/(^|\s)(https?:\/\/[^\s<）)]+)/g, (m, pre, url) => pre + `<a href="${url}" target="_blank" rel="noopener">${truncate(url, 60)}</a>`);
    t = t.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code>' + codes[Number(i)] + '</code>');
    return t;
  },

  render(src) {
    const text = String(src == null ? '' : src).replace(/\r\n?/g, '\n');
    const lines = text.split('\n');
    let out = '';
    let i = 0;
    const flushList = () => { };
    while (i < lines.length) {
      const line = lines[i];
      // 代码块
      if (/^\s*```/.test(line)) {
        const lang = (line.match(/^\s*```(\S*)/) || [])[1] || '';
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        const code = esc(buf.join('\n'));
        out += `<pre><code class="lang-${esc(lang || 'txt')}" data-lang="${esc(lang)}">${code}</code></pre>`;
        continue;
      }
      // 表格
      if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
        out += '<table><thead><tr>' + head.map((h) => `<th>${this.inline(h)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map((r) => '<tr>' + head.map((_, k) => `<td>${this.inline(r[k] == null ? '' : r[k])}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>';
        continue;
      }
      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) { out += `<h${h[1].length}>${this.inline(h[2])}</h${h[1].length}>`; i++; continue; }
      // 分隔线
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) { out += '<hr>'; i++; continue; }
      // 引用
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
        out += `<blockquote>${this.render(buf.join('\n'))}</blockquote>`;
        continue;
      }
      // 列表
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        const ordered = /^\s*\d+[.)]\s+/.test(line);
        const items = [];
        let j = i;
        while (j < lines.length) {
          const m2 = lines[j].match(/^\s*([-*+]|\d+[.)])\s+(.*)$/);
          if (m2) { items.push({ indent: (lines[j].match(/^\s*/) || [''])[0].length, text: m2[2] }); j++; }
          else if (/^\s{2,}\S/.test(lines[j]) && items.length) { items[items.length - 1].text += '\n' + lines[j].trim(); j++; }
          else break;
        }
        i = j;
        const base = Math.min(...items.map((x) => x.indent));
        const li = items.map((it) => {
          const task = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
          if (task) return `<li class="task"><input type="checkbox" disabled ${task[1].toLowerCase() === 'x' ? 'checked' : ''}> ${this.inline(task[2])}</li>`;
          const pad = it.indent > base ? ' class="sub"' : '';
          return `<li${pad}>${this.inline(it.text)}</li>`;
        }).join('');
        const tag = ordered ? 'ol' : 'ul';
        out += ordered && /^\s*\[[ xX]\]/.test(items[0].text) ? `<ul class="tasks">${li}</ul>` : `<${tag}>${li}</${tag}>`;
        continue;
      }
      // 空行
      if (!line.trim()) { i++; continue; }
      // 段落
      const buf = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|>|\||([-*+]|\d+[.)])\s)/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (buf.length) out += `<p>${this.inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`;
      else i++;
    }
    return out;
  },

  /** 渲染后做代码高亮（有 hljs 才做，失败静默） */
  highlight(root) {
    if (!window.hljs) return;
    root.querySelectorAll('pre code').forEach((c) => {
      try { window.hljs.highlightElement(c); } catch { }
    });
  },

  /** 从 Markdown 中提取文件链接（tool 生成的下载卡片） */
  extractFileCards(text) {
    const out = [];
    const re = /\[([^\]]+)\]\((blob:|data:)[^)]*\)/g;
    let m;
    while ((m = re.exec(text))) out.push({ name: m[1] });
    return out;
  }
};
