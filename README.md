# Claude Conversation Exporter — LINE bubble fork

Chrome 扩展：把 Claude.ai 的对话一键导出成本地文件，并新增 **LINE 聊天气泡风格** 的 HTML 视图（fork 新增）。

> Fork of [socketteer/Claude-Conversation-Exporter](https://github.com/socketteer/Claude-Conversation-Exporter).
> 原版能力完全保留（JSON / Markdown / Plain Text 导出、批量打包 ZIP、模型识别、浏览搜索等）；本 fork 在原作基础上新增了 LINE 风格的气泡 HTML 视图与若干配置项。

---

## Fork 新增能力

| 能力 | 说明 |
|---|---|
| LINE 风格 HTML 导出 | 宽气泡（max-width 92%）、容器 1000px、日期分割条、消息时间戳；双击 `.html` 浏览器直接读 |
| Claude 思考链支持 | 自动识别 extended thinking 块，渲染为可折叠 `<details>`（默认关闭，可勾选开启） |
| 冗余消息过滤 | 默认折叠相邻同 sender 的重生成/重试稿，可一键关掉 |
| 自定义双方称呼 | popup / browse 内可改「我 / 对方」显示名，应用到 Markdown / Plain Text |
| LINE 设为新默认 | 格式下拉将 LINE (HTML) 设为首项与默认选项 |
| 共享 utils.js 重构 | popup / browse / content 三处共用同一份转换逻辑（`convertToLineHTML` / `convertToMarkdown` / `convertToText`），新增格式只改一处 |

详细文件改动见 commit history。

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

### 高级选项（fork 新增）
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

- **原作者**：[socketteer](https://github.com/socketteer) — Claude Opus 4.1 协同开发
- **原仓库**：https://github.com/socketteer/Claude-Conversation-Exporter
- **ZIP 库**：[JSZip](https://stuk.github.io/jszip/)

本 fork 在原作基础上新增 LINE 风格 HTML 视图与配置项，向原作者致敬。如果你觉得这个扩展有用，**请也去给原仓库点 Star**。

---

## License 与法律状态

> ⚠️ **重要：原仓库未声明 license。** README 占位写「[Add your chosen license here]」，无 LICENSE 文件 —— 按 GitHub 默认，原作品 = all rights reserved by socketteer。
>
> 本 fork 仅供 **个人使用与学习交流**，不主张任何分发权利。
>
> 如原作者 [@socketteer](https://github.com/socketteer) 对此 fork 的存在有任何异议，请直接在本仓库提 issue，本 fork 将立即响应（下架 / 转 private / 改为 PR）。
>
> 推荐的更优做法：将 LINE 强化以 PR 形式回馈给原仓库，由原作者决定是否合入。

---

## Disclaimer

Not officially affiliated with Anthropic, Claude.ai, or the original author.
Community fork released for personal use and learning purposes only.
