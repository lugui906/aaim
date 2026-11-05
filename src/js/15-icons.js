/* ============ 15 图标：统一 SVG（不用 emoji） ============ */
const Icons = {
  _wrap(inner, size = 16, sw = 1.7) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
  },
  // 基础
  plus(s = 16) { return this._wrap('<path d="M12 5v14M5 12h14"/>', s, 1.9); },
  close(s = 15) { return this._wrap('<path d="M6 6l12 12M18 6L6 18"/>', s, 1.8); },
  menu(s = 17) { return this._wrap('<path d="M4 7h16M4 12h16M4 17h16"/>', s, 1.8); },
  more(s = 17) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>`; },
  gear(s = 17) { return this._wrap('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.7 8a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3.6h.1A1.7 1.7 0 0 0 10 2.1V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>', s, 1.6); },
  sun(s = 17) { return this._wrap('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>', s); },
  moon(s = 17) { return this._wrap('<path d="M20.5 14.8A8.6 8.6 0 0 1 9.2 3.5a8.7 8.7 0 1 0 11.3 11.3z"/>', s); },
  folder(s = 16) { return this._wrap('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2h7A1.5 1.5 0 0 1 19 9.7v8.8A1.5 1.5 0 0 1 17.5 20h-13A1.5 1.5 0 0 1 3 18.5z"/>', s); },
  mic(s = 16) { return this._wrap('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11.5a7 7 0 0 0 14 0M12 18.5V21"/>', s); },
  send(s = 17) { return this._wrap('<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>', s, 2.2); },
  stop(s = 14) { return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`; },
  download(s = 14) { return this._wrap('<path d="M12 4v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>', s, 1.8); },
  external(s = 14) { return this._wrap('<path d="M14 5h5v5"/><path d="M19 5l-7.5 7.5"/><path d="M18.5 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7A1.5 1.5 0 0 1 6 5.5h4.5"/>', s, 1.7); },
  copy(s = 14) { return this._wrap('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6.5V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15h1"/>', s, 1.6); },
  speaker(s = 14) { return this._wrap('<path d="M4 9.5h3l4-3.5v12l-4-3.5H4z"/><path d="M15 9a4 4 0 0 1 0 6"/><path d="M17.8 6.6a7.5 7.5 0 0 1 0 10.8"/>', s, 1.6); },
  retry(s = 14) { return this._wrap('<path d="M20 11.5a8 8 0 1 0-2.3 5.6"/><path d="M20 4.5v7h-7"/>', s, 1.7); },
  refresh(s = 15) { return this._wrap('<path d="M20 11.5a8 8 0 1 0-2.3 5.6"/><path d="M20 4.5v7h-7"/>', s, 1.7); },
  // 文件类型
  file(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/>', s, 1.6); },
  fileDoc(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.5 12.5h7M8.5 16h5"/>', s, 1.5); },
  fileSheet(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.5 12h7v5h-7z"/><path d="M8.5 14.5h7"/>', s, 1.4); },
  fileSlide(s = 15) { return this._wrap('<rect x="3.5" y="5" width="17" height="11" rx="1.6"/><path d="M12 16v3.5M8.5 21h7"/>', s, 1.6); },
  filePdf(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/><path d="M8.8 17v-4.5h1.6a1.4 1.4 0 0 1 0 2.8H8.8"/>', s, 1.4); },
  fileHtml(s = 15) { return this._wrap('<path d="M4 4.5l1.5 14L12 20.5l6.5-2L20 4.5z"/><path d="M8.5 8.5h7l-.4 4.2-3.1.9-3.1-.9"/>', s, 1.4); },
  fileText(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/><path d="M9 12.5h6M9 16h4"/>', s, 1.5); },
  fileCode(s = 15) { return this._wrap('<path d="M14 3.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h10A1.5 1.5 0 0 0 18.5 19V8z"/><path d="M14 3.5V8h4.5"/><path d="M10.2 12.5L8.5 14.5l1.7 2M13.8 12.5l1.7 2-1.7 2"/>', s, 1.4); },
  // 其它
  brain(s = 14) { return this._wrap('<path d="M9.5 4.5a2.7 2.7 0 0 0-2.7 2.7 2.4 2.4 0 0 0-1.4 4.3A2.6 2.6 0 0 0 6.9 16a2.6 2.6 0 0 0 2.6 2.2V4.5z"/><path d="M14.5 4.5a2.7 2.7 0 0 1 2.7 2.7 2.4 2.4 0 0 1 1.4 4.3A2.6 2.6 0 0 1 17.1 16a2.6 2.6 0 0 1-2.6 2.2V4.5z"/>', s, 1.4); },
  tool(s = 13) { return this._wrap('<path d="M14.5 5.5a3.5 3.5 0 0 1 4.7 4.7l-8.5 8.5-2.9.6.6-2.9z"/><path d="M5 6l2.2 2.2"/>', s, 1.5); },
  memory(s = 14) { return this._wrap('<path d="M12 3.5c-3 0-4.5 1.8-4.5 4 0 1.3.4 2.2-.6 3.4-1 1.2-1.4 2.3-1.4 3.4 0 2.4 2.2 4.2 4.5 4.2h4c2.3 0 4.5-1.8 4.5-4.2 0-1.1-.4-2.2-1.4-3.4-1-1.2-.6-2.1-.6-3.4 0-2.2-1.5-4-4.5-4z"/><path d="M9.5 20v-4.5M14.5 20v-4.5"/>', s, 1.4); },
  // 企业模式
  crown(s = 14) { return this._wrap('<path d="M4 8l3.2 3L12 5l4.8 6L20 8l-1.4 8.5H5.4z"/><path d="M5.4 19h13.2"/>', s, 1.5); },
  lead(s = 14) { return this._wrap('<circle cx="12" cy="7.5" r="2.8"/><path d="M5.5 19.5a6.5 6.5 0 0 1 13 0"/>', s, 1.6); },
  worker(s = 14) { return this._wrap('<rect x="4" y="6.5" width="16" height="12" rx="2"/><path d="M9 6.5V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v1.5"/><path d="M4 12h16"/>', s, 1.5); },
  shield(s = 14) { return this._wrap('<path d="M12 3.5l7 2.5v5.5c0 4-3 7.2-7 8.5-4-1.3-7-4.5-7-8.5V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>', s, 1.5); },
  mail(s = 14) { return this._wrap('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/>', s, 1.5); },
  flow(s = 14) { return this._wrap('<rect x="9" y="3" width="6" height="4.5" rx="1.2"/><rect x="3" y="16.5" width="6" height="4.5" rx="1.2"/><rect x="15" y="16.5" width="6" height="4.5" rx="1.2"/><path d="M12 7.5v4M6 16.5v-2.2a1.3 1.3 0 0 1 1.3-1.3h9.4a1.3 1.3 0 0 1 1.3 1.3v2.2"/>', s, 1.5); },
  check(s = 13) { return this._wrap('<path d="M5 12.5l4.5 4.5L19 7"/>', s, 2); },
  alert(s = 13) { return this._wrap('<circle cx="12" cy="12" r="8.5"/><path d="M12 8v5M12 16.2v.1"/>', s, 1.6); }
};

/** 文件类型 → 图标（注意：必须保留 this 绑定，Icons 的方法内部用到 this._wrap） */
function fileIcon(kind, size = 15) {
  const map = {
    docx: 'fileDoc', xlsx: 'fileSheet', pptx: 'fileSlide', pdf: 'filePdf',
    html: 'fileHtml', md: 'fileText', json: 'fileCode', reveal: 'fileSlide'
  };
  const name = map[kind] || 'file';
  return Icons[name](size);
}
