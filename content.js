// content.js — runs on claude.ai pages. Depends on utils.js being injected first
// (see manifest.json content_scripts.js order).

// Default model timeline for null models
const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' },
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' },
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' },
  { date: new Date('2025-02-29'), model: 'claude-3-7-sonnet-20250219' },
  { date: new Date('2025-05-14'), model: 'claude-sonnet-4-20250514' },
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' }
];

function inferModel(conversation) {
  if (conversation.model) return conversation.model;

  const conversationDate = new Date(conversation.created_at);
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// Fetch conversation data
async function fetchConversation(orgId, conversationId) {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversation: ${response.status}`);
  }

  return await response.json();
}

// Fetch all conversations (index, not full chat history)
async function fetchAllConversations(orgId) {
  const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations`;

  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Accept': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch conversations: ${response.status}`);
  }

  return await response.json();
}

// Build {opts} from a message request — mirrors browse.js gatherExportOpts.
function optsFromRequest(req) {
  return {
    humanName: (req.humanName || '我').trim() || '我',
    assistantName: (req.assistantName || 'Claude').trim() || 'Claude',
    includeMetadata: req.includeMetadata !== false,
    includeThinking: !!req.includeThinking,
    includeRetries: !!req.includeRetries
  };
}

function safeFileName(name, fallback) {
  return String(name || fallback || 'untitled').replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
}

function renderForFormat(data, format, opts) {
  switch (format) {
    case 'line':
      return { content: convertToLineHTML(data, opts), ext: 'html', mime: 'text/html' };
    case 'markdown':
      return { content: convertToMarkdown(data, opts), ext: 'md', mime: 'text/markdown' };
    case 'text':
      return { content: convertToText(data, opts), ext: 'txt', mime: 'text/plain' };
    default:
      return { content: JSON.stringify(data, null, 2), ext: 'json', mime: 'application/json' };
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'exportConversation') {
    console.log('Export conversation request received:', request);

    fetchConversation(request.orgId, request.conversationId)
      .then(data => {
        data.model = inferModel(data);

        const opts = optsFromRequest(request);
        const { content, ext, mime } = renderForFormat(data, request.format, opts);
        const filename = `claude-conversation-${safeFileName(data.name, request.conversationId)}.${ext}`;

        console.log('Downloading file:', filename);
        downloadFile(content, filename, mime);
        sendResponse({ success: true });
      })
      .catch(error => {
        console.error('Export conversation error:', error);
        sendResponse({ success: false, error: error.message, details: error.stack });
      });

    return true;
  }

  if (request.action === 'exportAllConversations') {
    console.log('Export all conversations request received:', request);

    fetchAllConversations(request.orgId)
      .then(async conversations => {
        console.log(`Fetched ${conversations.length} conversations`);

        if (request.format === 'json') {
          // For JSON, export as a single file with all conversation metadata (index only,
          // not full message trees — matching previous behavior).
          const filename = `claude-all-conversations-${new Date().toISOString().split('T')[0]}.json`;
          console.log('Downloading all conversations as JSON:', filename);
          downloadFile(JSON.stringify(conversations, null, 2), filename);
          sendResponse({ success: true, count: conversations.length });
          return;
        }

        const opts = optsFromRequest(request);
        let count = 0;
        const errors = [];

        for (const conv of conversations) {
          try {
            console.log(`Fetching full conversation ${count + 1}/${conversations.length}: ${conv.uuid}`);
            const fullConv = await fetchConversation(request.orgId, conv.uuid);
            fullConv.model = inferModel(fullConv);

            const { content, ext, mime } = renderForFormat(fullConv, request.format, opts);
            const filename = `claude-${safeFileName(conv.name, conv.uuid)}.${ext}`;

            downloadFile(content, filename, mime);
            count++;

            // Small delay so we don't hammer the API
            await new Promise(resolve => setTimeout(resolve, 500));
          } catch (error) {
            console.error(`Failed to export conversation ${conv.uuid}:`, error);
            errors.push(`${conv.name || conv.uuid}: ${error.message}`);
          }
        }

        if (errors.length > 0) {
          console.warn('Some conversations failed to export:', errors);
          sendResponse({
            success: true,
            count,
            warnings: `Exported ${count}/${conversations.length} conversations. Some failed: ${errors.join('; ')}`
          });
        } else {
          sendResponse({ success: true, count });
        }
      })
      .catch(error => {
        console.error('Export all conversations error:', error);
        sendResponse({ success: false, error: error.message, details: error.stack });
      });

    return true;
  }
});
