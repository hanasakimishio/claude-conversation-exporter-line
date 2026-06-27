// Shared utility functions for Claude Exporter

// Helper function to reconstruct the current branch from the message tree
function getCurrentBranch(data) {
  if (!data.chat_messages || !data.current_leaf_message_uuid) {
    return data.chat_messages || [];
  }

  const messageMap = new Map();
  data.chat_messages.forEach(msg => {
    messageMap.set(msg.uuid, msg);
  });

  const branch = [];
  let currentUuid = data.current_leaf_message_uuid;

  while (currentUuid && messageMap.has(currentUuid)) {
    const message = messageMap.get(currentUuid);
    branch.unshift(message);
    currentUuid = message.parent_message_uuid;

    if (!messageMap.has(currentUuid)) {
      break;
    }
  }

  return branch;
}

// Strip duplicated same-sender messages (keep only the last one in a same-sender run).
// Useful for collapsing retried / regenerated branches when caller chose the wrong branch.
function filterMessages(messages, includeRetries) {
  if (includeRetries) return messages;
  const filtered = [];
  for (let i = 0; i < messages.length; i++) {
    const current = messages[i];
    const next = messages[i + 1];
    if (next && current.sender === next.sender) continue;
    filtered.push(current);
  }
  return filtered;
}

// Pull text / thinking blocks out of an API message. Falls back to msg.text for old format.
function extractContentBlocks(msg, includeThinking) {
  const content = msg.content || [];
  const blocks = [];

  if (!Array.isArray(content) || content.length === 0) {
    if (msg.text) blocks.push({ type: 'text', text: msg.text });
    return blocks;
  }

  for (const block of content) {
    if (block.type === 'thinking' && block.thinking && includeThinking) {
      blocks.push({ type: 'thinking', text: block.thinking });
    } else if (block.type === 'text' && block.text) {
      blocks.push({ type: 'text', text: block.text });
    }
  }

  return blocks;
}

function getDateStr(dateObj) {
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${dateObj.getFullYear()}年${dateObj.getMonth() + 1}月${dateObj.getDate()}日(${weekdays[dateObj.getDay()]})`;
}

function escapeHtml(text) {
  if (text == null) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeOpts(opts) {
  opts = opts || {};
  return {
    humanName: opts.humanName || 'Human',
    assistantName: opts.assistantName || 'Claude',
    includeThinking: !!opts.includeThinking,
    includeRetries: !!opts.includeRetries,
    includeMetadata: opts.includeMetadata !== false
  };
}

// Convert to LINE-style HTML — wide bubbles, fewer lines, larger reading area.
function convertToLineHTML(data, opts) {
  const o = normalizeOpts(opts);
  const title = data.name || 'Untitled Conversation';
  let messages = getCurrentBranch(data);
  messages = filterMessages(messages, o.includeRetries);

  let messagesHtml = '';
  let lastDateStr = '';

  for (const msg of messages) {
    if (msg.created_at) {
      const msgDate = new Date(msg.created_at);
      const currentDateStr = getDateStr(msgDate);
      if (currentDateStr !== lastDateStr) {
        messagesHtml += `<div class="date-header"><span>${currentDateStr}</span></div>`;
        lastDateStr = currentDateStr;
      }
    }

    const isHuman = msg.sender === 'human';
    const bubbleClass = isHuman ? 'human' : 'assistant';
    const blocks = extractContentBlocks(msg, o.includeThinking);
    const time = msg.created_at
      ? new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '';

    for (const block of blocks) {
      if (block.type === 'thinking') {
        messagesHtml += `
          <div class="thinking-row">
            <details class="thinking">
              <summary>💭 思考过程</summary>
              <div class="thinking-text">${escapeHtml(block.text).replace(/\n/g, '<br>')}</div>
            </details>
          </div>`;
      } else {
        messagesHtml += `<div class="message ${bubbleClass}">`;
        if (time) messagesHtml += `<div class="time">${time}</div>`;
        messagesHtml += `<div class="bubble ${bubbleClass}">${escapeHtml(block.text).replace(/\n/g, '<br>')}</div>`;
        messagesHtml += `</div>`;
      }
    }
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif;
      background: #f0f0f0;
      padding: 1rem;
      line-height: 1.6;
      min-height: 100vh;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    .date-header { text-align: center; margin: 1rem 0; }
    .date-header span {
      background: rgba(0,0,0,0.15);
      color: #555;
      font-size: 0.72rem;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
    }
    .message {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .message.human { flex-direction: row-reverse; }
    .bubble {
      max-width: 92%;
      padding: 0.7rem 1rem;
      border-radius: 18px;
      font-size: 1rem;
      line-height: 1.55;
      word-break: break-word;
    }
    .bubble.human {
      background: #6bcf5e;
      color: white;
      border-bottom-right-radius: 4px;
    }
    .bubble.assistant {
      background: #e5e5ea;
      color: #1a1a1a;
      border-bottom-left-radius: 4px;
    }
    .time {
      font-size: 0.65rem;
      color: #888;
      flex-shrink: 0;
      padding-bottom: 0.2rem;
    }
    .thinking-row { margin-bottom: 0.5rem; }
    .thinking summary {
      display: inline-block;
      padding: 0.4rem 0.8rem;
      border-radius: 18px;
      border-bottom-left-radius: 4px;
      font-size: 0.82rem;
      background: #e0e0e0;
      color: #666;
      cursor: pointer;
    }
    .thinking summary:hover { background: #d5d5d5; }
    .thinking-text {
      margin-top: 0.5rem;
      padding: 0.7rem 1rem;
      border-radius: 18px;
      border-bottom-left-radius: 4px;
      font-size: 0.88rem;
      background: #e8e8e8;
      color: #444;
      line-height: 1.6;
      max-width: 92%;
    }
  </style>
</head>
<body>
  <div class="container">
    ${messagesHtml}
  </div>
</body>
</html>`;
}

// Convert to markdown format
function convertToMarkdown(data, opts) {
  // Back-compat: caller may pass a boolean (old includeMetadata signature) instead of opts.
  if (typeof opts === 'boolean') opts = { includeMetadata: opts };
  const o = normalizeOpts(opts);

  let markdown = `# ${data.name || 'Untitled Conversation'}\n\n`;

  if (o.includeMetadata) {
    if (data.created_at) markdown += `**Created:** ${new Date(data.created_at).toLocaleString()}\n`;
    if (data.updated_at) markdown += `**Updated:** ${new Date(data.updated_at).toLocaleString()}\n`;
    if (data.model) markdown += `**Model:** ${data.model}\n`;
    markdown += `\n---\n\n`;
  }

  let branchMessages = getCurrentBranch(data);
  branchMessages = filterMessages(branchMessages, o.includeRetries);

  for (const message of branchMessages) {
    const sender = message.sender === 'human' ? `**${o.humanName}**` : `**${o.assistantName}**`;
    markdown += `${sender}:\n\n`;

    const blocks = extractContentBlocks(message, o.includeThinking);
    for (const block of blocks) {
      if (block.type === 'thinking') {
        markdown += `<details>\n<summary>💭 思考过程</summary>\n\n${block.text}\n\n</details>\n\n`;
      } else {
        markdown += `${block.text}\n\n`;
      }
    }

    if (o.includeMetadata && message.created_at) {
      markdown += `*${new Date(message.created_at).toLocaleString()}*\n\n`;
    }

    markdown += '---\n\n';
  }

  return markdown;
}

// Convert to plain text
function convertToText(data, opts) {
  if (typeof opts === 'boolean') opts = { includeMetadata: opts };
  const o = normalizeOpts(opts);

  let text = '';

  if (o.includeMetadata) {
    text += `${data.name || 'Untitled Conversation'}\n`;
    if (data.created_at) text += `Created: ${new Date(data.created_at).toLocaleString()}\n`;
    if (data.updated_at) text += `Updated: ${new Date(data.updated_at).toLocaleString()}\n`;
    if (data.model) text += `Model: ${data.model}\n`;
    text += '\n---\n\n';
  }

  let branchMessages = getCurrentBranch(data);
  branchMessages = filterMessages(branchMessages, o.includeRetries);

  branchMessages.forEach((message) => {
    const senderLabel = message.sender === 'human' ? o.humanName : o.assistantName;
    const blocks = extractContentBlocks(message, o.includeThinking);
    const time = message.created_at
      ? new Date(message.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '';

    text += `[${senderLabel}]${time ? ' ' + time : ''}\n`;
    for (const block of blocks) {
      if (block.type === 'thinking') {
        text += `【思考】\n${block.text}\n`;
      } else {
        text += `${block.text}\n`;
      }
    }
    text += '\n';
  });

  return text.trim();
}

// Download file utility
function downloadFile(content, filename, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Functions are available globally in the browser context
// No need for module.exports in browser extensions
