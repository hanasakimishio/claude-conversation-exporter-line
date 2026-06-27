# Claude Conversation Exporter — LINE bubble integration

Chrome 扩展：把 Claude.ai 的对话一键导出成本地文件，并集成 **LINE 聊天气泡风格** 的 HTML 视图与若干高级配置。

> 本仓库 = 上游扩展（API 直连抓取与浏览管道）+ 作者自研 splitter（LINE 渲染与配置层）的合并版本。
>
> - **上游扩展**：[socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter) — 提供 claude.ai API 抓取、批量浏览、ZIP 打包、模型识别等
> - **集成层**：作者自研的 Claude Chat Splitter 工具 — 提供 LINE 风格 HTML 渲染、思考链处理、冗余过滤、自定义称呼、4 种格式统一管道

---

## 作者原创设计部分

以下能力 **由本仓库作者独立设计与实现**，并非衍生自上游扩展。
它们原本存在于作者自研的独立工具 Claude Chat Splitter 中（输入：用户已下载的 Claude 对话 JSON / ZIP；输出：4 种格式文件），本仓库将其能力移植到上游扩展的抓取管道之上。

| 能力 | 说明 |
|---|---|
| **LINE 风格 HTML 渲染** | 宽气泡（max-width 92%）、容器 1000px、日期分割条（含日文星期）、消息时间戳；双击 `.html` 浏览器直接读 |
| **Claude 思考链处理** | 识别 `content[].type='thinking'` 块，渲染为可折叠 `<details>`；Markdown 同样折叠；Plain Text 用「【思考】」标记 |
| **冗余消息过滤** | `filterMessages` —— 相邻同 sender 自动只保留最后一条，自动折叠重生成/重试稿，可一键关闭 |
| **自定义双方称呼** | `humanName / assistantName`，应用到 Markdown / Plain Text 的发送者标签 |
| **4 种格式统一管道** | `convertToLineHTML / convertToMarkdown / convertToText / JSON`，统一 `normalizeOpts` 入参，新增格式只改一处 |
| **共享 utils.js 重构** | popup / browse / content 三处复用同一份转换逻辑（上游原版是三处复制） |

上游原版保留的能力：JSON / Markdown / Plain Text 三种基础格式、批量打包 ZIP、模型识别、对话浏览搜索、Org ID 配置、模型徽章着色等。

---

## 两种用法（仓库内两个工具同梱）

本仓库同时提供两种使用路径，按你手头有的数据来选：

### 用法 A：Chrome 扩展（实时抓 claude.ai）
适合：登录着 Claude.ai、想直接从网页一键导出。
入口：装扩展 → popup 或 Browse 页 → 选格式 → 导出。
依赖：你的 claude.ai 登录态 + Organization ID。

### 用法 B：独立 splitter（[`claude-chat-splitter.html`](./claude-chat-splitter.html)）
适合：**已经从 Claude 官方途径导出了 `conversations.json`** —— 例如：
- `https://claude.ai/settings/data-privacy-controls` → Export data → 邮件收到的 ZIP
- 朋友/合作方发给你的 conversation 备份文件
- Chrome 扩展批量导出的 JSON 文件

打开方式：双击仓库根目录里的 `claude-chat-splitter.html`（浏览器直接打开，无需任何安装）。
能做的事：上传一个 / 多个 / ZIP 文件 → 自动拆分为独立对话 → 列表筛选 + 全文搜索 + 重命名 → 选 4 种格式之一 → 单条导出或批量打包 ZIP。

**关键特性**：splitter 完全本地运行（无任何网络请求、不调用任何 API、不需要 Cookie），把官方导出的一坨 JSON 转成可直接收藏的 LINE 气泡 HTML / Markdown / Plain Text。这正是本仓库 LINE 渲染层 + 高级配置最初被设计实现的原生载体。

---

## 安装（Chrome 开发者模式加载未打包扩展）

1. `git clone https://github.com/hanasakimishio/claude-conversation-exporter-line.git`
   或直接下载 ZIP 解压到本地任意目录
2. Chrome 地址栏访问 `chrome://extensions/`
3. 右上角开启「开发者模式」
4. 点「加载已解压的扩展程序」，选 clone 出来的根目录（含 `manifest.json` 那一层）
5. 工具栏出现扩展图标即装好

### 首次使用前的配置

1. 右键扩展图标 → 选项
2. 打开 https://claude.ai/settings/account 复制 Organization ID（UUID 格式）
3. 粘贴到选项页 → Save → Test Connection 验证

---

## 使用

### 导出单条对话
在 claude.ai 任意对话页 → 点扩展图标 → 选格式与配置 → 「Export Current Conversation」

### 浏览与批量导出
点「Browse All Conversations」 → 列表内搜索 / 按模型筛选 → 勾选目标行 → 「Export Selected」（或「Export All」全量打包 ZIP）

### 高级选项
- **包含思考链**：导出 Claude extended thinking 内容
- **包含冗余消息**：保留同 sender 的连续重生成稿（默认折叠）
- **我 / 对方**：自定义 Markdown / Plain Text 中的发送者名

---

## 4 种导出格式

| 格式 | 扩展名 | 适用场景 |
|---|---|---|
| LINE (HTML) | `.html` | 气泡聊天视图，浏览器直接读、截图友好（默认） |
| Markdown | `.md` | 带元数据头 + 思考链折叠块，Obsidian / 博客友好 |
| Plain Text | `.txt` | `[发送者] HH:MM` 行首标签，最轻量 |
| JSON | `.json` | 完整 API 原始响应，含全部分支与元信息 |

---

## 隐私

- 全程本地处理，仅用浏览器 Cookie 直连 `claude.ai` API
- 不上传任何第三方服务器
- 没有 API key 成本
- 源码全部开源可审查

---

## 致谢

- **上游扩展作者**：[socketteer](https://github.com/socketteer) — 与 Claude Opus 4.1 协同开发，提供 claude.ai API 直连与浏览管道
- **上游仓库**：https://github.com/socketteer/Claude-Conversation-Exporter
- **ZIP 库**：[JSZip](https://stuk.github.io/jszip/)

LINE 风格渲染与高级配置层的设计与实现由本仓库作者独立完成，并非衍生自上游。

---

## License 与法律状态

> ⚠️ **上游仓库未声明 license**（README 占位写「[Add your chosen license here]」，无 LICENSE 文件） —— 按 GitHub 默认 = all rights reserved by socketteer。

本仓库仅供 **个人使用与学习交流**，不主张任何分发权利。

### 如原作者有异议

**若 [@socketteer](https://github.com/socketteer) 对本仓库的存在有任何异议**（issue / 邮件均可），本仓库将立即响应：

1. 本仓库下架（或转 private）
2. 改为 **仅发布独立的 Claude Chat Splitter 工具**

该独立工具即本仓库内的 [`claude-chat-splitter.html`](./claude-chat-splitter.html) —— **完全不包含上游扩展的任何代码**，仅处理用户已经下载到本地的 Claude 对话 JSON / ZIP 文件，零代码侵权风险，并保留全部原创设计的 LINE 渲染与配置能力。

### 推荐的更稳做法

将 LINE 渲染层与配置层以 PR 形式提交回上游，由 [@socketteer](https://github.com/socketteer) 决定是否合入 —— 本仓库作者愿意配合任何合规化要求。

---

## Disclaimer

Not officially affiliated with Anthropic, Claude.ai, or the upstream extension author.
Community integration released for personal use and learning purposes only.
