/* ============ 16 办公文档解析：docx / xlsx / pptx（真实提取文本与表格） ============ */
const DocParser = {
  /** 扩展名 */
  ext(name) {
    const m = /\.([a-z0-9]+)$/i.exec(String(name || ''));
    return m ? m[1].toLowerCase() : '';
  },
  /** 需要走办公文档解析的类型 */
  OFFICE: ['docx', 'xlsx', 'pptx', 'xls', 'csv'],
  /** 浏览器端无法解析的老二进制格式 */
  LEGACY: { doc: 'Word 97-2003（.doc）', xls: 'Excel 97-2003（.xls）→ 可直接读，见下', ppt: 'PowerPoint 97-2003（.ppt）', wps: 'WPS 文字（.wps）', et: 'WPS 表格（.et）', dps: 'WPS 演示（.dps）' },
  /** 这些可以读 */
  READABLE: ['docx', 'xlsx', 'pptx', 'xls', 'csv'],

  isOffice(name) {
    return this.READABLE.includes(this.ext(name));
  },
  /** 明确不支持、要给出指引的 */
  unsupportedHint(name) {
    const e = this.ext(name);
    if (e === 'doc' || e === 'wps' || e === 'rtf') return '这是旧版 Word / WPS 格式，浏览器无法直接解析。请用 Word/WPS「另存为 .docx」后再上传。';
    if (e === 'ppt' || e === 'dps') return '这是旧版 PPT / WPS 演示格式，请用 PowerPoint/WPS「另存为 .pptx」后再上传。';
    if (e === 'pages') return 'Pages 格式不支持，请导出为 .docx 或 PDF。';
    if (e === 'numbers') return 'Numbers 格式不支持，请导出为 .xlsx 或 CSV。';
    if (e === 'key') return 'Keynote 格式不支持，请导出为 .pptx 或 PDF。';
    if (e === 'zip' || e === 'rar' || e === '7z') return '压缩包请先解压，再逐个上传里面的文档。';
    if (e === 'enc' || e === 'pdf_enc') return '文件已加密，无法解析。';
    return '';
  },

  /** 统一入口：File / Blob → { text, meta } */
  async read(file, name) {
    const fname = name || file.name || 'file';
    const e = this.ext(fname);
    if (e === 'pdf') return { text: await readPdfBlob(file), meta: { kind: 'pdf' } };
    if (e === 'docx') return await this.docx(file, fname);
    if (e === 'xlsx' || e === 'xls' || e === 'csv') return await this.xlsx(file, fname);
    if (e === 'pptx') return await this.pptx(file, fname);
    const hint = this.unsupportedHint(fname);
    if (hint) throw new Error(hint);
    throw new Error(`不支持的格式：.${e || '?'}（支持 PDF / DOCX / XLSX / PPTX / XLS / CSV / TXT / MD / JSON / 图片）`);
  },

  async readBuffer(buf, name) {
    return this.read(new Blob([buf]), name);
  },

  /* ---------------- DOCX ---------------- */
  async docx(blob, fname) {
    await CDN.load('jszip');
    const JSZip = window.JSZip;
    let zip;
    try { zip = await JSZip.loadAsync(await blob.arrayBuffer()); }
    catch (e) { throw new Error('不是有效的 docx（可能已损坏或其实是 .doc 改扩展名）'); }
    const docFile = zip.file('word/document.xml');
    if (!docFile) throw new Error('docx 内缺少 word/document.xml，文件可能已损坏');
    const xml = await docFile.async('string');
    const dom = new DOMParser().parseFromString(xml, 'application/xml');
    if (dom.getElementsByTagName('parsererror').length) throw new Error('document.xml 解析失败');

    const lines = [];
    const body = dom.getElementsByTagName('w:body')[0] || dom.documentElement;
    const MAX = 3000;

    const paraText = (p) => {
      let s = '';
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType !== 1) continue;
          const tag = c.tagName;
          if (tag === 'w:t') s += c.textContent || '';
          else if (tag === 'w:tab') s += '\t';
          else if (tag === 'w:br' || tag === 'w:cr') s += '\n';
          else if (tag === 'w:drawing' || tag === 'w:pict') s += '[图片]';
          else if (tag === 'w:hyperlink' || tag === 'w:r' || tag === 'w:ins' || tag === 'w:smartTag') walk(c);
          else if (tag === 'w:delText') { }
        }
      };
      walk(p);
      return s;
    };

    const headingLevel = (p) => {
      const st = p.getElementsByTagName('w:pStyle')[0];
      if (!st) return 0;
      const v = st.getAttribute('w:val') || '';
      const m = /^(?:Heading|heading|标题)\s*(\d)/.exec(v);
      if (m) return Math.min(6, Number(m[1]));
      if (/^(Title|标题)$/i.test(v)) return 1;
      return 0;
    };

    const tableText = (tbl) => {
      const rows = [];
      for (const tr of tbl.getElementsByTagName('w:tr')) {
        const cells = [];
        for (const tc of tr.getElementsByTagName('w:tc')) {
          const parts = [];
          for (const p of tc.getElementsByTagName('w:p')) {
            const t = paraText(p).trim();
            if (t) parts.push(t);
          }
          cells.push(parts.join(' ').replace(/\|/g, '\\|'));
        }
        if (cells.length) rows.push(cells);
      }
      if (!rows.length) return '';
      const cols = Math.max(...rows.map((r) => r.length));
      const norm = rows.map((r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c; });
      let out = '\n| ' + norm[0].join(' | ') + ' |\n| ' + norm[0].map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < norm.length; i++) out += '| ' + norm[i].join(' | ') + ' |\n';
      return out + '\n';
    };

    const isNoise = (t) => /^\s*\d+\s*(\/|of)\s*\d+\s*$/i.test(t) || /^\s*第\s*\d+\s*页\s*$/.test(t);

    let count = 0;
    for (const node of body.children) {
      if (count++ > MAX) { lines.push('…（文档过长，后续内容已省略）'); break; }
      const tag = node.tagName;
      if (tag === 'w:p') {
        const t = paraText(node);
        const lvl = headingLevel(node);
        if (t.trim()) { if (!isNoise(t.trim())) lines.push(lvl ? '#'.repeat(lvl) + ' ' + t.trim() : t.trim()); }
        else lines.push('');
      } else if (tag === 'w:tbl') {
        const t = tableText(node);
        if (t) lines.push(t);
      } else if (tag === 'w:sdt') {
        const inner = node.getElementsByTagName('w:p');
        for (const p of inner) { const t = paraText(p).trim(); if (t) lines.push(t); }
      }
    }

    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('这个 docx 里没有可提取的文字（可能整篇是图片扫描件，需要 OCR）');

    // 附带的元信息
    let title = '';
    try {
      const core = zip.file('docProps/core.xml');
      if (core) {
        const cx = await core.async('string');
        const cd = new DOMParser().parseFromString(cx, 'application/xml');
        title = (cd.getElementsByTagName('dc:title')[0] || {}).textContent || '';
      }
    } catch { }
    return {
      text,
      meta: { kind: 'docx', title, paragraphs: text.split('\n').filter(Boolean).length, ext: 'docx' }
    };
  },

  /* ---------------- XLSX / XLS / CSV ---------------- */
  async xlsx(blob, fname) {
    await CDN.load('xlsx');
    const XLSX = window.XLSX;
    let wb;
    const buf = await blob.arrayBuffer();
    try {
      wb = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true, raw: false });
    } catch (e) {
      throw new Error('表格解析失败：' + e.message + '（若是 .xls 且带密码，请先另存为 .xlsx）');
    }
    if (!wb || !wb.SheetNames || !wb.SheetNames.length) throw new Error('这个表格里没有工作表');
    const out = [];
    let totalRows = 0;
    for (const sn of wb.SheetNames.slice(0, 20)) {
      const ws = wb.Sheets[sn];
      if (!ws) continue;
      let rows;
      try { rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '', raw: false }); }
      catch { continue; }
      if (!rows || !rows.length) { out.push(`## 工作表：${sn}\n（空）\n`); continue; }
      const cols = Math.min(30, Math.max(...rows.map((r) => r.length)));
      const cap = rows.slice(0, 300).map((r) => {
        const c = r.slice(0, cols).map((v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' '));
        while (c.length < cols) c.push('');
        return c;
      });
      let tbl = `## 工作表：${sn}（${rows.length} 行 × ${cols} 列）\n\n`;
      tbl += '| ' + cap[0].join(' | ') + ' |\n| ' + cap[0].map(() => '---').join(' | ') + ' |\n';
      for (let i = 1; i < cap.length; i++) tbl += '| ' + cap[i].join(' | ') + ' |\n';
      if (rows.length > cap.length) tbl += `\n…（还有 ${rows.length - cap.length} 行未展开）\n`;
      out.push(tbl);
      totalRows += rows.length;
    }
    const text = out.join('\n').trim();
    if (!text) throw new Error('未能从表格中提取到内容');
    return { text, meta: { kind: 'xlsx', sheets: wb.SheetNames.length, rows: totalRows, ext: 'xlsx' } };
  },

  /* ---------------- PPTX ---------------- */
  async pptx(blob, fname) {
    await CDN.load('jszip');
    const JSZip = window.JSZip;
    let zip;
    try { zip = await JSZip.loadAsync(await blob.arrayBuffer()); }
    catch (e) { throw new Error('不是有效的 pptx（可能已损坏或其实是 .ppt 改扩展名）'); }

    const slideFiles = Object.keys(zip.files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = Number((/slide(\d+)\.xml$/.exec(a) || [])[1] || 0);
        const nb = Number((/slide(\d+)\.xml$/.exec(b) || [])[1] || 0);
        return na - nb;
      });
    if (!slideFiles.length) throw new Error('pptx 内没有找到幻灯片');

    const notesMap = {};
    for (const p of Object.keys(zip.files)) {
      const m = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(p);
      if (m) notesMap[Number(m[1])] = p;
    }

    const out = [];
    // 去掉页码、"第 x 页"、纯数字等版式噪音
    const isNoise = (t) => /^\s*\d+\s*(\/|of)\s*\d+\s*$/i.test(t) || /^\s*第\s*\d+\s*页\s*$/.test(t) || /^\s*\d{1,3}\s*$/.test(t);

    for (let i = 0; i < slideFiles.length; i++) {
      const xml = await zip.file(slideFiles[i]).async('string');
      const dom = new DOMParser().parseFromString(xml, 'application/xml');

      // 1) 表格单独转 Markdown，避免拆成散行
      const tables = [];
      const inTable = new Set();
      for (const tbl of dom.getElementsByTagName('a:tbl')) {
        const rows = [];
        for (const tr of tbl.getElementsByTagName('a:tr')) {
          const cells = [];
          for (const tc of tr.getElementsByTagName('a:tc')) {
            const txt = Array.from(tc.getElementsByTagName('a:t')).map((t) => t.textContent || '').join('').trim();
            cells.push(txt.replace(/\|/g, '\\|').replace(/\n/g, ' '));
          }
          if (cells.length) rows.push(cells);
        }
        for (const p of tbl.getElementsByTagName('a:p')) inTable.add(p);
        if (!rows.length) continue;
        const cols = Math.max(...rows.map((r) => r.length));
        const norm = rows.map((r) => { const c = r.slice(); while (c.length < cols) c.push(''); return c; });
        let md = '| ' + norm[0].join(' | ') + ' |\n| ' + norm[0].map(() => '---').join(' | ') + ' |\n';
        for (let k = 1; k < norm.length; k++) md += '| ' + norm[k].join(' | ') + ' |\n';
        tables.push(md);
      }

      // 2) 正文段落（排除表格内的段落）
      const lines = [];
      for (const p of dom.getElementsByTagName('a:p')) {
        if (inTable.has(p)) continue;
        let t = '';
        for (const n of p.getElementsByTagName('a:t')) t += n.textContent || '';
        t = t.trim();
        if (t && !isNoise(t)) lines.push(t);
      }

      let seg = `## 第 ${i + 1} 页\n`;
      const parts = [];
      if (lines.length) parts.push(lines.join('\n'));
      for (const md of tables) parts.push(md.trimEnd());
      seg += parts.length ? parts.join('\n\n') : '（本页无文字，可能是纯图片）';

      // 3) 演讲者备注（过滤纯数字占位）
      const nf = notesMap[i + 1];
      if (nf) {
        try {
          const nx = await zip.file(nf).async('string');
          const nd = new DOMParser().parseFromString(nx, 'application/xml');
          const nt = Array.from(nd.getElementsByTagName('a:t'))
            .map((t) => (t.textContent || '').trim())
            .filter((t) => t && !isNoise(t))
            .join(' ')
            .trim();
          if (nt) seg += `\n\n> 备注：${nt}`;
        } catch { }
      }
      out.push(seg);
    }
    const text = out.join('\n\n');
    return { text, meta: { kind: 'pptx', slides: slideFiles.length, ext: 'pptx' } };
  }
};

/* PDF 解析抽成公共函数，附件与知识库共用 */
async function readPdfBlob(file) {
  await CDN.load('pdfjs');
  const pdfjs = window.pdfjsLib;
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
  }
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let out = '';
  const max = Math.min(doc.numPages, 80);
  for (let i = 1; i <= max; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += tc.items.map((it) => it.str).join(' ') + '\n\n';
    if (out.length > 200000) { out += '…（已截断）'; break; }
  }
  const text = out.trim();
  if (!text) throw new Error('这个 PDF 没有可提取的文字（可能是扫描件，需要 OCR）');
  return text;
}
