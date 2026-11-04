/* ============ 04 办公文档生成（Word / Excel / PPT / PDF / 独立 HTML） ============ */
const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf', html: 'text/html;charset=utf-8', md: 'text/markdown;charset=utf-8', json: 'application/json', png: 'image/png', svg: 'image/svg+xml'
};
function artifactCard(art) {
  return { kind: 'file', art };
}
async function dataUrlToBytes(dataUrl) {
  const r = await fetch(dataUrl); return new Uint8Array(await r.arrayBuffer());
}

/* ---------- Word ---------- */
async function buildDocx(spec = {}) {
  await CDN.load('docx');
  const D = window.docx;
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell,
    WidthType, AlignmentType, Header, Footer, PageNumber, ImageRun, PageBreak, BorderStyle
  } = D;
  const kids = [];
  const title = spec.title || '';
  if (spec.header) kids.push(new Paragraph({ children: [new TextRun({ text: spec.header, size: 18, color: '666666' })], alignment: AlignmentType.RIGHT }));
  if (title) kids.push(new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 240 } }));
  if (spec.subtitle) kids.push(new Paragraph({ children: [new TextRun({ text: spec.subtitle, color: '666666', size: 22 })], spacing: { after: 240 } }));

  const blocks = spec.blocks || [];
  for (const b of blocks) {
    const type = (b.type || 'p').toLowerCase();
    if (type === 'h1') kids.push(new Paragraph({ text: b.text || '', heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 } }));
    else if (type === 'h2') kids.push(new Paragraph({ text: b.text || '', heading: HeadingLevel.HEADING_2, spacing: { before: 200, after: 100 } }));
    else if (type === 'h3') kids.push(new Paragraph({ text: b.text || '', heading: HeadingLevel.HEADING_3, spacing: { before: 160, after: 80 } }));
    else if (type === 'ul' || type === 'ol') {
      for (const it of b.items || []) kids.push(new Paragraph({ text: typeof it === 'string' ? it : (it.text || ''), bullet: { level: 0 } }));
    } else if (type === 'quote') {
      kids.push(new Paragraph({ children: [new TextRun({ text: b.text || '', italics: true, color: '555555' })], indent: { left: 480 }, spacing: { before: 100, after: 100 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'F59E0B', space: 12 } } }));
    } else if (type === 'table') {
      const rows = [];
      if (b.headers && b.headers.length) rows.push(new TableRow({ tableHeader: true, children: b.headers.map((h) => new TableCell({ shading: { fill: '1E3355' }, children: [new Paragraph({ children: [new TextRun({ text: String(h), bold: true, color: 'FFFFFF' })] })] })) }));
      for (const r of b.rows || []) rows.push(new TableRow({ children: (Array.isArray(r) ? r : [r]).map((c) => new TableCell({ children: [new Paragraph({ text: String(c == null ? '' : c) })] })) }));
      kids.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      kids.push(new Paragraph({ text: '', spacing: { after: 120 } }));
    } else if (type === 'image' && b.dataUrl) {
      try {
        const bytes = await dataUrlToBytes(b.dataUrl);
        const mt = /data:image\/([a-z+]+);/.exec(b.dataUrl);
        kids.push(new Paragraph({ children: [new ImageRun({ data: bytes, type: (mt && mt[1] === 'png' ? 'png' : 'jpg'), transformation: { width: b.width || 480, height: b.height || 300 } })], spacing: { after: 160 } }));
      } catch (e) { kids.push(new Paragraph({ text: '[图片插入失败]' })); }
    } else if (type === 'pagebreak') kids.push(new Paragraph({ children: [new PageBreak()] }));
    else if (type === 'kv') {
      for (const [k, v] of Object.entries(b.data || {})) kids.push(new Paragraph({ children: [new TextRun({ text: k + '：', bold: true }), new TextRun({ text: String(v) })] }));
    } else {
      kids.push(new Paragraph({ children: [new TextRun({ text: String(b.text || ''), size: 22 })], spacing: { after: 100, line: 320 } }));
    }
  }
  const section = {};
  if (spec.headerText) section.headers = { default: new Header({ children: [new Paragraph({ text: spec.headerText, alignment: AlignmentType.CENTER })] }) };
  section.footers = { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun('第 '), new TextRun({ children: [PageNumber.CURRENT] }), new TextRun(' 页')] })] }) };
  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: spec.font || 'Microsoft YaHei', size: 22 }, paragraph: { spacing: { line: 320 } } },
        heading1: { run: { font: spec.font || 'Microsoft YaHei', color: '162A4A', size: 32, bold: true } },
        heading2: { run: { font: spec.font || 'Microsoft YaHei', color: '1E3355', size: 28, bold: true } },
        heading3: { run: { font: spec.font || 'Microsoft YaHei', color: '2B4266', size: 24, bold: true } }
      }
    },
    sections: [{ properties: {}, ...section, children: kids }]
  });
  return Packer.toBlob(doc);
}

/* ---------- Excel ---------- */
async function buildXlsx(spec = {}) {
  await CDN.load('xlsx');
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const sheets = spec.sheets && spec.sheets.length ? spec.sheets : [{ name: 'Sheet1', headers: ['列1', '列2'], rows: [['a', 'b']] }];
  for (const sh of sheets) {
    let ws;
    if (sh.aoa) ws = XLSX.utils.aoa_to_sheet(sh.aoa);
    else {
      const aoa = [];
      if (sh.headers) aoa.push(sh.headers);
      for (const r of sh.rows || []) aoa.push(Array.isArray(r) ? r : Object.values(r));
      ws = XLSX.utils.aoa_to_sheet(aoa);
    }
    if (sh.colWidths) ws['!cols'] = sh.colWidths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, (sh.name || 'Sheet').slice(0, 30));
  }
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
  return new Blob([buf], { type: MIME.xlsx });
}

/* ---------- PPT ---------- */
async function buildPptx(spec = {}) {
  await CDN.load('pptx');
  const P = window.PptxGenJS || window.pptxgenjs;
  if (!P) throw new Error('PptxGenJS 未加载');

  const ppt = new P();
  // ★ 关键：显式定义 16:9 宽屏画布（13.333 × 7.5 英寸）。
  // 内置 'LAYOUT_16x9' 实际是 10 × 5.625 英寸，坐标会超出画布被裁掉，看起来就像空页。
  const W = 13.333, H = 7.5;
  ppt.defineLayout({ name: 'AAM_WIDE', width: W, height: H });
  ppt.layout = 'AAM_WIDE';
  ppt.author = APP.name;
  ppt.title = spec.title || (spec.slides && spec.slides[0] && spec.slides[0].title) || '演示文稿';
  ppt.subject = spec.subject || '';

  const theme = Object.assign({
    bg: '162A4A',       // 深蓝底
    card: '1E3355',     // 卡片
    title: 'FFFFFF',
    body: 'D8E2F0',
    muted: '8FA6C4',
    accent: 'F59E0B'    // 橙
  }, spec.theme || {});

  const FONT = spec.font || 'Microsoft YaHei';

  ppt.defineSlideMaster({
    title: 'AAM_MASTER',
    background: { color: theme.bg },
    objects: []
  });

  /* 按可用空间自动选字号，同时返回实际需要的高度（英寸），便于后续元素紧跟其后 */
  const fitFont = (bullets, availW, availH, maxF, minF) => {
    for (let f = maxF; f > minF; f--) {
      const perLine = Math.max(6, Math.floor((availW * 72) / f));
      let lines = 0;
      for (const b of bullets) {
        const t = typeof b === 'string' ? b : (b.text || '');
        lines += Math.max(1, Math.ceil(t.length / perLine));
      }
      const need = (lines * f * 1.7 + bullets.length * f * 0.35 + 0.1) / 72;
      if (need <= availH) return { font: f, height: need };
    }
    const perLine = Math.max(6, Math.floor((availW * 72) / minF));
    let lines = 0;
    for (const b of bullets) {
      const t = typeof b === 'string' ? b : (b.text || '');
      lines += Math.max(1, Math.ceil(t.length / perLine));
    }
    return { font: minF, height: Math.min(availH, (lines * minF * 1.7) / 72) };
  };

  const slides = (spec.slides && spec.slides.length) ? spec.slides : [{ title: spec.title || '演示文稿', bullets: [] }];
  const total = slides.length;

  for (let i = 0; i < total; i++) {
    const sd = slides[i] || {};
    const s = ppt.addSlide({ masterName: 'AAM_MASTER' });
    const pageNo = i + 1;

    /* ---------- 封面页 ---------- */
    if (sd.layout === 'title' || (i === 0 && (sd.layout === 'cover' || spec.cover === true))) {
      s.addShape(ppt.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: H, fill: { color: theme.accent } });
      s.addText(sd.title || spec.title || '', {
        x: 0.9, y: 2.5, w: W - 2.0, h: 1.5, fontSize: 40, bold: true,
        color: theme.title, align: 'left', valign: 'middle', fontFace: FONT
      });
      if (sd.subtitle) s.addText(sd.subtitle, {
        x: 0.92, y: 4.05, w: W - 2.0, h: 0.8, fontSize: 18, color: theme.muted, align: 'left', fontFace: FONT
      });
      s.addShape(ppt.ShapeType.rect, { x: 0.95, y: 4.95, w: 1.6, h: 0.05, fill: { color: theme.accent } });
      if (sd.notes) s.addNotes(sd.notes);
      continue;
    }

    /* ---------- 内容页 ---------- */
    // 左侧橙色竖条
    s.addShape(ppt.ShapeType.rect, { x: 0.5, y: 0.46, w: 0.09, h: 0.56, fill: { color: theme.accent } });
    // 标题
    s.addText(sd.title || `第 ${pageNo} 页`, {
      x: 0.74, y: 0.38, w: W - 1.5, h: 0.75, fontSize: 26, bold: true,
      color: theme.title, align: 'left', valign: 'middle', fontFace: FONT
    });
    // 标题下细分隔线
    s.addShape(ppt.ShapeType.rect, { x: 0.74, y: 1.24, w: W - 1.48, h: 0.012, fill: { color: '2B4266' } });

    const top = 1.5;
    const bottom = H - 0.72;
    const availW = W - 1.6;                 // 左右各留 0.8
    const availH = bottom - top;
    let y = top;

    /* 表格优先占位：行高按字号+内边距估算，保证不挤压 */
    let tableH = 0;
    const tRows = (sd.table && sd.table.rows) ? sd.table.rows.length : 0;
    if (sd.table && sd.table.headers && sd.table.headers.length) {
      const rowH = 0.40;
      tableH = Math.min(availH * 0.66, 0.44 + tRows * rowH);
    }
    /* 图片占位 */
    const imgH = (sd.image && sd.image.data) ? Math.min(3.2, availH * 0.5) : 0;

    const bullets = (sd.bullets || []).map((b) => (typeof b === 'string' ? b : (b && b.text) || '')).filter((x) => String(x).trim());
    if (bullets.length) {
      const maxTextH = Math.max(0.8, availH - tableH - imgH - 0.15);
      const fit = fitFont(bullets, availW, maxTextH, 20, 11);
      const fs = fit.font;
      const textH = (tableH || imgH) ? fit.height : maxTextH;   // 有表格/图片时只占用实际需要高度
      s.addText(
        (sd.bullets || []).filter((b) => b != null).map((b) => {
          const obj = typeof b === 'string' ? { text: b } : b;
          const indent = obj.level || 0;
          return {
            text: String(obj.text || ''),
            options: {
              bullet: indent === 0 ? { code: '2022' } : { code: '25E6' },
              indentLevel: indent,
              fontSize: indent === 0 ? fs : Math.max(10, fs - 2),
              color: indent === 0 ? theme.body : theme.muted,
              bold: !!obj.bold,
              breakLine: true,
              paraSpaceAfter: Math.max(4, Math.round(fs * 0.35)),
              fontFace: FONT
            }
          };
        }),
        { x: 0.8, y, w: availW, h: textH, valign: 'top', fontFace: FONT, lineSpacingMultiple: 1.15 }
      );
      y += textH;
    }

    /* 表格 */
    if (tableH > 0) {
      const nCol = sd.table.headers.length;
      const rows = [sd.table.headers.map((h) => ({
        text: String(h == null ? '' : h),
        options: { bold: true, color: 'FFFFFF', fill: { color: theme.accent }, fontSize: 14, fontFace: FONT, margin: 6 }
      }))];
      for (const r of sd.table.rows || []) {
        const cells = Array.isArray(r) ? r : [r];
        rows.push(sd.table.headers.map((_, k) => ({
          text: String(cells[k] == null ? '' : cells[k]),
          options: { color: theme.body, fontSize: 13, fontFace: FONT, fill: { color: theme.card }, margin: 6 }
        })));
      }
      // 列宽：按各列最长内容加权，避免窄列被挤压换行
      let colW = sd.table.colW;
      if (!Array.isArray(colW)) {
        const weight = sd.table.headers.map((h, k) => {
          const lens = [String(h == null ? '' : h).length, ...(sd.table.rows || []).map((r) => String((Array.isArray(r) ? r[k] : (k === 0 ? r : '')) == null ? '' : (Array.isArray(r) ? r[k] : '')).length)];
          return Math.min(28, Math.max(6, Math.max(...lens)));
        });
        const sum = weight.reduce((a, b) => a + b, 0);
        colW = weight.map((w) => (w / sum) * availW);
      }
      s.addTable(rows, {
        x: 0.8, y: Math.min(y + 0.14, bottom - tableH), w: availW,
        colW, rowH: 0.40,
        border: { type: 'solid', color: '2B4266', pt: 1 },
        align: 'left', valign: 'middle', fontSize: 13, autoPage: false
      });
      y += tableH;
    }

    /* 图片 */
    if (imgH > 0) {
      const im = sd.image;
      s.addImage({
        data: im.data, x: im.x != null ? im.x : 0.8, y: im.y != null ? im.y : y + 0.1,
        w: im.w || Math.min(availW, 6), h: im.h || imgH
      });
      y += imgH;
    }

    /* 无正文时给一句提示，避免真的出现空白页 */
    if (!bullets.length && !tableH && !imgH) {
      s.addText(sd.emptyHint || '（本页待补充内容）', {
        x: 0.8, y: top, w: availW, h: 0.6, fontSize: 14, color: theme.muted, italic: true, fontFace: FONT
      });
    }

    /* 页脚 */
    s.addText(spec.footer || '', {
      x: 0.8, y: H - 0.52, w: W - 2.2, h: 0.3, fontSize: 10, color: theme.muted, fontFace: FONT
    });
    s.addText(`${pageNo} / ${total}`, {
      x: W - 1.32, y: H - 0.52, w: 0.9, h: 0.3, fontSize: 10,
      color: theme.muted, align: 'right', fontFace: FONT
    });

    if (sd.notes) s.addNotes(sd.notes);
  }

  const blob = await ppt.write({ outputType: 'blob' });
  return blob;
}

/* ---------- PDF（文本通过 canvas 渲染，保证中文可用） ---------- */
async function buildPdf(spec = {}) {
  await CDN.load('pdflib');
  const { PDFDocument } = window.PDFLib;
  const W = 1240, H = 1754;                     // A4 @150dpi
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const font = (size, bold) => `${bold ? '700 ' : ''}${size}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`;
  const lines = [];
  const push = (text, size, bold, gap) => lines.push({ text: String(text == null ? '' : text), size, bold, gap });
  if (spec.title) { push(spec.title, 34, true, 26); }
  if (spec.subtitle) push(spec.subtitle, 18, false, 22);
  for (const l of spec.lines || []) {
    if (typeof l === 'string') push(l, 17, false, 12);
    else push(l.text || '', l.size || 17, !!l.bold, l.gap || 12);
  }
  const margin = 90, maxW = W - margin * 2, usableH = H - margin * 2;
  const wrapLine = (it) => {
    ctx.font = font(it.size, it.bold);
    const parts = []; let cur = '';
    for (const ch of it.text) {
      if (ctx.measureText(cur + ch).width > maxW) { parts.push(cur); cur = ch; } else cur += ch;
    }
    parts.push(cur);
    return parts;
  };
  // 先分页
  const pageSlices = []; let curSlice = [], used = 0;
  for (const it of lines) {
    const parts = wrapLine(it);
    const h = parts.length * it.size * 1.65 + it.gap;
    if (used + h > usableH && curSlice.length) { pageSlices.push(curSlice); curSlice = []; used = 0; }
    curSlice.push({ it, parts });
    used += h;
  }
  if (curSlice.length) pageSlices.push(curSlice);
  const pdf = await PDFDocument.create();
  // 逐页渲染
  for (const slice of pageSlices) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    let yy = margin;
    for (const { it, parts } of slice) {
      ctx.font = font(it.size, it.bold);
      ctx.fillStyle = it.bold ? '#111111' : '#222222';
      for (const p of parts) { ctx.fillText(p, margin, yy + it.size); yy += it.size * 1.65; }
      yy += it.gap;
    }
    const png = await pdf.embedPng(cv.toDataURL('image/png'));
    const pg = pdf.addPage([595.28, 841.89]);
    pg.drawImage(png, { x: 0, y: 0, width: 595.28, height: 841.89 });
  }
  pdf.setTitle(spec.title || 'document');
  const bytes = await pdf.save();
  return new Blob([bytes], { type: MIME.pdf });
}

/* ---------- 独立 HTML 小应用（J7 / K4） ---------- */
function buildStandaloneHtml({ title = 'AI 生成的小应用', html = '', css = '', js = '' }) {
  const doc = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:0;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;background:#f7f9fc;color:#12213a}
.wrap{max-width:880px;margin:0 auto;padding:24px}${css}</style></head>
<body><div class="wrap">${html}</div><script>${js}<\/script></body></html>`;
  return new Blob([doc], { type: MIME.html });
}

/* ---------- 工具：generate_docx / xlsx / pptx / pdf / make_html_app ---------- */
Tools.register({
  name: 'generate_docx', category: 'office',
  desc: '生成 Word .docx 文件并给出下载按钮。请传结构化 blocks，不要传代码。blocks 支持 h1/h2/h3、p、ul/ol、table、quote、kv、pagebreak、image。',
  params: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: '文件名，如《季度报告.docx》' },
      title: { type: 'string', description: '文档大标题' },
      subtitle: { type: 'string' },
      headerText: { type: 'string', description: '页眉文字' },
      font: { type: 'string', description: '正文字体，默认 Microsoft YaHei（可填 SimSun / 等线 等）' },
      blocks: {
        type: 'array', description: '内容块数组',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'h1|h2|h3|p|ul|ol|table|quote|kv|pagebreak|image' },
            text: { type: 'string' }, items: { type: 'array', items: { type: 'string' } },
            headers: { type: 'array', items: { type: 'string' } },
            rows: { type: 'array', items: { type: 'array', items: {} } },
            data: { type: 'object' }, dataUrl: { type: 'string' }
          }
        }
      }
    },
    required: ['filename', 'blocks']
  },
  async run(args) {
    const blob = await buildDocx(args);
    let name = safeName(args.filename || args.title || '文档', 'document');
    name = name.replace(/\.(docx|doc|txt)$/i, '') + '.docx';
    const finalName = name;
    const art = addArtifact({ name: finalName, mime: MIME.docx, size: blob.size, blob, kind: 'docx' });
    return { ok: true, summary: `已生成 Word 文档《${finalName}》（${fmtBytes(blob.size)}，${(args.blocks || []).length} 个内容块）`, data: { filename: finalName, size: blob.size }, display: artifactCard(art) };
  }
});

Tools.register({
  name: 'generate_xlsx', category: 'office',
  desc: '生成 Excel .xlsx 文件（支持多工作表）。每个 sheet 传 headers + rows（二维数组）或 aoa。',
  params: {
    type: 'object',
    properties: {
      filename: { type: 'string' },
      sheets: {
        type: 'array', items: {
          type: 'object', properties: {
            name: { type: 'string' }, headers: { type: 'array', items: {} },
            rows: { type: 'array', items: { type: 'array', items: {} } },
            colWidths: { type: 'array', items: { type: 'integer' } }
          }
        }
      }
    },
    required: ['filename', 'sheets']
  },
  async run(args) {
    const blob = await buildXlsx(args);
    let name = safeName(args.filename || '表格.xlsx', 'sheet.xlsx');
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    const art = addArtifact({ name, mime: MIME.xlsx, size: blob.size, blob, kind: 'xlsx' });
    const rows = (args.sheets || []).reduce((a, s) => a + (s.rows || []).length, 0);
    return { ok: true, summary: `已生成 Excel《${name}》（${(args.sheets || []).length} 个工作表，共 ${rows} 行，${fmtBytes(blob.size)}）`, data: { filename: name, size: blob.size }, display: artifactCard(art) };
  }
});

Tools.register({
  name: 'generate_pptx', category: 'office',
  desc: '生成 PowerPoint .pptx 文件（16:9 宽屏 13.33×7.5 英寸，深蓝+橙主题）。每页传 title + bullets；可加 table{headers,rows} 做表格、layout:"title" 做封面页、notes 写演讲者备注。要点多时会自动缩小字号以防溢出。',
  params: {
    type: 'object',
    properties: {
      filename: { type: 'string' }, title: { type: 'string' },
      footer: { type: 'string', description: '页脚文字（如课程名/日期）' },
      slides: {
        type: 'array', description: '幻灯片数组，第一页建议用 layout:"title" 做封面', items: {
          type: 'object', properties: {
            title: { type: 'string' }, subtitle: { type: 'string' },
            layout: { type: 'string', description: '填 "title" 表示封面页（大标题+副标题+左侧色条）' },
            bullets: { type: 'array', items: { type: 'string' }, description: '要点数组，建议每页 3–5 条、每条 30 字以内' },
            table: { type: 'object', properties: { headers: { type: 'array', items: {} }, rows: { type: 'array', items: { type: 'array', items: {} } } }, description: '可选表格' },
            notes: { type: 'string', description: '演讲者备注（放映时不显示，写在这一页要讲的话）' }
          }
        }
      }
    },
    required: ['filename', 'slides']
  },
  async run(args) {
    const blob = await buildPptx(args);
    let name = safeName(args.filename || '演示文稿.pptx', 'slides.pptx');
    if (!/\.pptx$/i.test(name)) name += '.pptx';
    const art = addArtifact({ name, mime: MIME.pptx, size: blob.size, blob, kind: 'pptx' });
    return { ok: true, summary: `已生成 PPT《${name}》（${(args.slides || []).length} 页，${fmtBytes(blob.size)}）`, data: { filename: name, size: blob.size }, display: artifactCard(art) };
  }
});

Tools.register({
  name: 'generate_pdf', category: 'office',
  desc: '生成 PDF 文件。传 title 与 lines（字符串数组，或 {text,size,bold} 对象）。中文通过 canvas 渲染为图像后嵌入以保证不乱码，因此 PDF 内文字不可选中/搜索（需要可复制文本请改用 Word）。',
  params: {
    type: 'object',
    properties: {
      filename: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' },
      lines: { type: 'array', items: {} }
    },
    required: ['filename', 'lines']
  },
  async run(args) {
    const blob = await buildPdf(args);
    let name = safeName(args.filename || '文档.pdf', 'doc.pdf');
    if (!/\.pdf$/i.test(name)) name += '.pdf';
    const art = addArtifact({ name, mime: MIME.pdf, size: blob.size, blob, kind: 'pdf' });
    return { ok: true, summary: `已生成 PDF《${name}》（${fmtBytes(blob.size)}）`, data: { filename: name, size: blob.size }, display: artifactCard(art) };
  }
});

Tools.register({
  name: 'make_html_app', category: 'ui',
  desc: '把 html/css/js 打包成一个可离线打开的单页应用（.html）并给出下载按钮，同时可在沙箱中预览。',
  params: {
    type: 'object',
    properties: {
      title: { type: 'string' }, filename: { type: 'string' },
      html: { type: 'string', description: 'body 内的 HTML' },
      css: { type: 'string', description: '额外 CSS' },
      js: { type: 'string', description: '脚本（不含 <script> 标签）' }
    },
    required: ['title', 'html']
  },
  async run(args) {
    const blob = buildStandaloneHtml(args);
    let name = safeName(args.filename || args.title, 'app');
    if (!/\.html?$/i.test(name)) name += '.html';
    const art = addArtifact({ name, mime: MIME.html, size: blob.size, blob, kind: 'html' });
    return { ok: true, summary: `已打包独立网页《${name}》（${fmtBytes(blob.size)}）`, data: { filename: name, size: blob.size }, display: { kind: 'fileframe', art, html: `<style>${args.css || ''}</style>${args.html}<script>${args.js || ''}<\/script>` } };
  }
});
