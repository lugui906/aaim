# 源码目录

`index.html` 是构建产物，这里是它的源码与测试。

## 目录

```
shell.html       页面骨架（含 /*__CSS__*/ 与 /*__JS__*/ 占位）
site.css         全部样式
js/00-16*.js     按功能拆分的模块
build.mjs        合并成单文件
fixtures/        测试用的构造数据
```

模块职责：

| 文件 | 内容 |
| --- | --- |
| `00-util.js` | DOM 助手、存储、CDN 多源加载、toast/modal |
| `01-state.js` | 默认设置、会话模型、系统提示词拼装 |
| `02-llm.js` | 多提供商接入、SSE 双协议解析、重试、内置演示模型 |
| `03-tools.js` | 工具注册表、搜索适配器、抓取、沙箱执行 |
| `04-docs.js` | Word / Excel / PPT / PDF / 独立 HTML 生成 |
| `05-media.js` | 图表、Mermaid、文生图、幻灯片、知识库检索 |
| `06-agent.js` | ReAct 循环、上下文裁剪、预算护栏、队列、TTS/ASR |
| `07-md.js` | 自包含 Markdown 渲染器（先转义再解析） |
| `08-ui.js` | 消息渲染、折叠步骤、工具结果卡片、产物条 |
| `09-app.js` | 输入区、事件绑定、导入导出、插件 |
| `10-spec.js` | A–O 规格对照表数据 |
| `11/12-drawer.js` | 设置抽屉各面板 |
| `13-memory.js` | 长期记忆（remember / recall / forget） |
| `14-localfiles.js` | 本机文件读写（File System Access API） |
| `15-icons.js` | 统一 SVG 图标 |
| `16-docparse.js` | DOCX / XLSX / PPTX / PDF 真实内容提取 |

## 构建

```bash
node build.mjs
cp ../aaim-agent.html ../index.html
```

只用 Node 内置模块，无需 `npm install`。

## 测试

基于无头 Edge + CDP，需要本机有 `/opt/microsoft/msedge/msedge`：

```bash
node selftest2.mjs   # 核心功能（记忆、折叠、产物、文件权限、沙箱）
node t6.mjs          # 界面约定（无模型名、SVG 图标、思考折叠、产物常显）
node t9.mjs          # 文档解析闭环（生成 docx/xlsx/pptx 再读回校验）
node t13.mjs         # 附件在气泡下方 + 不泄漏原始 JSON
node navtest.mjs     # 移动端侧栏六种关闭方式
node smoke.mjs       # 冒烟：启动无报错
```

每个脚本自带端口占用检查与退出清理，避免残留进程连到旧页面。
