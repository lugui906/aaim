# Aaim Agent · 单文件 AI Agent

一个 HTML 文件就是一个完整的 AI Agent 前端：**无后端、无构建依赖、无账号体系**。双击打开即用，数据只留在本机浏览器里。

- 在线试用：<https://lugui906.github.io/aaim/>
- 本地文件：`index.html`（约 300 KB，双击用 Chrome / Edge 打开）

---

## 起步三步

1. 打开页面。默认是**内置演示模型**，不需要任何 Key，可以直接体验完整的 ReAct 工具循环（会真的调用工具：画图表、生成文档、跑沙箱代码）。
2. 接真模型：右上角 **⚙ → 模型** → 选提供商 → 填 Base URL 与 API Key。
3. 如果浏览器报 `Failed to fetch`，那是 CORS 拦截：在同一面板填**代理地址**（支持 `https://p.example.com/?url={url}` 或纯前缀形式），或改用自带 CORS 头的本地端点（如 `http://127.0.0.1:11434/v1`）。

## 能力一览

| 区块 | 内容 |
| --- | --- |
| **模型** | OpenAI 兼容 / DeepSeek / 豆包方舟 / 千问百炼 / Anthropic / 自定义本地端点 + 内置演示模型 |
| **Agent** | ReAct 工具循环、流式输出（OpenAI 与 Anthropic 双协议）、停止、重试、上下文裁剪、串行队列、预算护栏、敏感工具确认、子 Agent 委派 |
| **搜索** | DeepSeek Search / Fetch、Tavily、Serper、自定义适配器；失败自动降级；结果卡片含相关性评分与权威度 |
| **文档生成** | Word（docx.js）、Excel（SheetJS）、PPT（PptxGenJS，16:9 宽屏）、PDF（pdf-lib + canvas 渲染中文）、独立 HTML 小应用 |
| **文档解析** | DOCX / XLSX / PPTX / PDF / XLS / CSV 真读内容：Word 的标题层级与表格、Excel 每个工作表转 Markdown、PPT 每页正文+表格+演讲者备注 |
| **可视化** | ECharts 图表（导出 PNG）、Mermaid 流程图（导出 SVG）、reveal.js 幻灯片 |
| **沙箱** | `iframe sandbox="allow-scripts"`（**不加** allow-same-origin）执行 JS 与渲染可交互演示，`postMessage` 事件回传 Agent |
| **本机文件** | File System Access API：授权后可读可改，patch 模式先出逐行 diff，点按钮才真正落盘 |
| **长期记忆** | 跨会话事实库，每轮自动注入系统提示；`remember` / `recall` / `forget` 三个工具 |
| **数据** | 会话持久化、Markdown/JSON 导出、配置导入导出（不含 Key）、本地知识库（分块 + BM25，可选向量融合） |
| **企业式多 Agent** | 大领导 → 小领导 → 执行者可嵌套（最多 4 层）；每份产出必过独立检查者，不合格打回重做；成员之间可实时互发消息；可把工具结果或上传材料随任务下发 |
| **其它** | 图片直发 vision、语音输入、TTS 朗读、深/浅主题、响应式、插件式工具注册 |

界面参照 deepseek.com 的视觉语言：暖白画布 `#f9f8f8`、玻璃面板、品牌蓝 `#4d6bfe` 只做点缀、主按钮用暖近黑 `#1a1615`。

## 快捷键

| 键 | 作用 |
| --- | --- |
| `Enter` | 发送（可在设置关闭） |
| `Shift + Enter` | 换行 |
| `Ctrl / ⌘ + Enter` | 发送 |
| `Esc` | 停止生成 / 关闭面板 |
| `Ctrl / ⌘ + K` | 聚焦输入框 |
| `Ctrl / ⌘ + Shift + N` | 新建会话 |

## 企业式多 Agent（核心能力）

顶栏点「单 Agent」切到**企业团队**模式，或直接点首页的「开启企业模式」。

**结构**

```
大领导  (1 个，对用户负责)
  └─ 小领导  (可多个，可再嵌套小领导)
       └─ 执行者  (干活的人)
检查者  (独立于指挥链，至少 1 名)
```

最多 4 层。每一层有自己的上下文、角色说明和可调用的工具，互相不污染。

**流程**

1. 你把目标发给大领导（可附材料）
2. 大领导用 `dispatch_task` 把子任务分派下去，下级**当场执行并回传结果**
3. **每一份产出都要过检查者**：6 条固定标准打分，不合格会把「必须改什么」作为下一轮输入打回重做（默认最多 2 次）
4. 重做次数用尽仍未通过 → 标记为未通过但照样上报，不会假装完成
5. 逐层汇总，最终交付卡上同时显示检查者的结论与分数

**检查者为什么是「完全公正」的**

- 评审用的 prompt 是代码里的常量，**不读组织的 prompt 字段**——领导改不了
- 检查者不调用任何工具，避免被工具结果带偏
- 不能删除最后一名检查者
- 分数低于 70 时，即使模型判 pass 也**强制降级为 reject**
- 模型输出解析失败一律按不通过处理，绝不放水

**成员之间能实时通信**

所有往来走一条消息总线：分派、交付、审核结论、任意成员互发（含广播）。收件箱带未读标记，成员下次工作时会自动看到新消息。消息可以带附件。

**把材料交给团队**

- 上传文件：`orgComposer` 左侧的文件夹按钮
- 工具结果：对话里任意工具卡片（搜索、抓取、代码、知识库）右上角的「交给团队」，会自动切到企业模式并把结果附上
- 分派时材料会逐层传递，下级能看到

**组织管理**

左侧「组织架构」里，每个节点悬停出现 `+`（加下级）、`⋯`（改名/改角色说明/换上级）、`×`（删除，连子树一起删）。大领导不可删除，检查者至少保留 1 名。

## 关于 A–O 规格

右上角 **⋯ → 功能规格对照** 打开规格面板，逐条列出 95 个编号项的实现状态（已实现 / 部分 / 未做）与具体实现方式，可直接对照验收。

未做的项都是纯前端客观做不到或收益过低的，例如：本地 shell（O1）、控制其它应用（O3）、万能 CORS 代理（O5）、隐藏 Key（O7）、WASM 转写（E3，需 COOP/COEP，`file://` 下不可用）、PWA 离线壳（M2，`file://` 无 Service Worker）。

## 安全边界（请认真看）

- 单文件页面**无法隐藏 API Key**（O7）。Key 存在本机 `localStorage`，只适合自己电脑使用；共用机器用完请在「关于 → 清空全部 API Key」抹掉。
- 页面不上报任何数据，所有出网请求都走你自己配置的端点。
- 所有 Agent 生成的代码先进沙箱 iframe，不写宿主全局变量。
- 修改本机文件必须由你点击「写入文件」才会落盘；网页无法自行遍历磁盘。
- 需要联网加载的第三方库（ECharts / JSZip / SheetJS / PptxGenJS / pdf-lib / pdf.js / Mermaid）从 CDN 按需拉取，多个源顺序回退；离线时这些功能不可用，但对话本身不受影响。

## 源码与构建

`index.html` 是构建产物，源码在 `src/`：

```
src/
  shell.html      # 页面骨架，含 /*__CSS__*/ 与 /*__JS__*/ 占位
  site.css        # 全部样式
  js/00-16*.js    # 按模块拆分：util / state / llm / tools / docs / media /
                  # agent / md / ui / app / spec / drawer / memory /
                  # localfiles / icons / docparse
  build.mjs       # 把上面的文件合并成单文件
```

重新构建：

```bash
cd src && node build.mjs        # 输出到 ../aaim-agent.html
cp ../aaim-agent.html ../index.html
```

不需要 `npm install`：构建脚本只用 Node 内置的 `fs` / `path`。

## 自检

`src/` 里带了基于无头 Edge + CDP 的端到端测试脚本，覆盖：工具链闭环、文档生成后用解析器读回校验、沙箱隔离（`parent.document` 必须抛 SecurityError）、Markdown XSS 转义、上下文裁剪、预算护栏、本机文件写入权限模型、移动端侧栏六种关闭方式、主题切换、控制台无异常。

```bash
cd src
node selftest2.mjs   # 核心功能 25 项
node t9.mjs          # 办公文档解析闭环
node navtest.mjs     # 移动端侧栏
```

## 已知限制

- 图表首次渲染需等 ECharts 加载（约 5 秒），期间显示占位。
- 生成的产物卡片在刷新后 blob 已释放，历史记录能看到卡片但下载会失败（要持久化需改存 IndexedDB）。
- 旧版 `.doc` / `.ppt` / `.wps` 浏览器无法解析，需先另存为新格式。
- 扫描版 PDF 没有文字层，提取不到内容（需 OCR，未内置）。

## License

MIT
