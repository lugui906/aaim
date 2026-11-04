import fs from 'fs';
import path from 'path';
const dir = '/home/l/aaim-agent/src';
const jsDir = path.join(dir, 'js');
const files = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
let js = files.map(f => `/* ===== ${f} ===== */\n` + fs.readFileSync(path.join(jsDir, f), 'utf8')).join('\n');
js += '\n/* expose for debugging / automation */\nObject.assign(window,{App,Agent,Tools,UI,State,MD,KB,Charts,ChartTheme,Mermaid,Drawer,LLM,Sandbox,SPEC,Artifacts,Store,CDN,PROVIDERS,Form,applyProxy,buildSystemPrompt,runSearch,Memory,LocalFiles,TTS,ASR});\n';
// 尾部启动
js += '\n/* ===== boot ===== */\ndocument.addEventListener("DOMContentLoaded", () => { try { App.boot(); } catch (e) { console.error(e); document.body.insertAdjacentHTML("beforeend", `<pre style="position:fixed;bottom:0;left:0;right:0;background:#300;color:#fbb;padding:8px;z-index:999;font-size:12px">启动失败: ${e.message}\\n${e.stack||""}</pre>`); } });\n';
if (/<\/script/i.test(js)) { console.error('!! JS 含未转义的 </script'); process.exit(1); }
const css = fs.readFileSync(path.join(dir, 'site.css'), 'utf8');
let html = fs.readFileSync(path.join(dir, 'shell.html'), 'utf8');
html = html.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js);
const out = process.argv[2] || '/home/l/aaim-agent/aaim-agent.html';
fs.writeFileSync(out, html);
console.log('files:', files.join(', '));
console.log('js bytes:', js.length, 'css:', css.length, 'total:', html.length);
console.log('out:', out);
