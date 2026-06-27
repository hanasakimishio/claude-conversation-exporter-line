// State management
let allConversations = [];
let filteredConversations = [];
let orgId = null;
let currentSort = 'updated_desc';
const selectedIds = new Set();

// Full-text search state.
// Index lives in localStorage keyed by conversation uuid; staleness detected via updated_at.
const FULLTEXT_LS_KEY = 'cce_fulltext_v1';
let fullTextEnabled = false;        // user-toggled — even if false, cache may still be loaded
let fullTextIndexing = false;       // background fetch in progress
let fullTextCancelFlag = false;     // set by Cancel button mid-batch
const fullTextCache = new Map();    // uuid -> { updated_at, text (lowercased) }
let lastSearchSnippets = new Map(); // uuid -> snippet HTML, refreshed each filter pass

// Preview modal state. conv is the fully-fetched API object (with chat_messages);
// every config change re-renders against this same object so it's instant once loaded.
const previewState = {
  uuid: null,
  name: '',
  conv: null,
  format: 'line',
  includeMetadata: true,
  includeThinking: false,
  includeRetries: false,
  humanName: '我',
  assistantName: 'Claude'
};

// Model name mappings
const MODEL_DISPLAY_NAMES = {
  'claude-3-sonnet-20240229': 'Claude 3 Sonnet',
  'claude-3-opus-20240229': 'Claude 3 Opus',
  'claude-3-haiku-20240307': 'Claude 3 Haiku',
  'claude-3-5-sonnet-20240620': 'Claude 3.5 Sonnet',
  'claude-3-5-haiku-20241022': 'Claude 3.5 Haiku',
  'claude-3-5-sonnet-20241022': 'Claude 3.6 Sonnet',
  'claude-3-7-sonnet-20250219': 'Claude 3.7 Sonnet',
  'claude-sonnet-4-20250514': 'Claude Sonnet 4',
  'claude-opus-4-20250514': 'Claude Opus 4',
  'claude-opus-4-1-20250805': 'Claude Opus 4.1',
  'claude-sonnet-4-5-20250929': 'Claude Sonnet 4.5',
  'claude-haiku-4-5-20251001': 'Claude Haiku 4.5',
  'claude-opus-4-5-20251101': 'Claude Opus 4.5',
  'claude-sonnet-4-6': 'Claude Sonnet 4.6',
  'claude-opus-4-6': 'Claude Opus 4.6'
};

// Default model timeline for null models
// Each entry represents when that model became the default
const DEFAULT_MODEL_TIMELINE = [
  { date: new Date('2024-01-01'), model: 'claude-3-sonnet-20240229' }, // Before June 20, 2024
  { date: new Date('2024-06-20'), model: 'claude-3-5-sonnet-20240620' }, // Starting June 20, 2024
  { date: new Date('2024-10-22'), model: 'claude-3-5-sonnet-20241022' }, // Starting October 22, 2024
  { date: new Date('2025-02-24'), model: 'claude-3-7-sonnet-20250219' }, // Starting February 24, 2025
  { date: new Date('2025-05-22'), model: 'claude-sonnet-4-20250514' }, // Starting May 22, 2025
  { date: new Date('2025-09-29'), model: 'claude-sonnet-4-5-20250929' }, // Starting September 29, 2025
  { date: new Date('2026-02-17'), model: 'claude-sonnet-4-6' } // Starting February 17, 2026
];

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  loadFullTextCache();
  await loadOrgId();
  await loadConversations();
  setupEventListeners();
  // If the user previously had full-text enabled, restore that state and run an
  // incremental refresh (only fetch conversations whose updated_at moved).
  if (fullTextCache.size > 0) {
    fullTextEnabled = true;
    document.getElementById('fulltextToggle').checked = true;
    updateFullTextStatus();
    // Fire-and-forget incremental refresh; don't block initial render.
    enableFullText({ rebuild: false, silent: true });
  } else {
    updateFullTextStatus();
  }
});

// Infer model for conversations with null model based on date
function inferModel(conversation) {
  if (conversation.model) {
    return conversation.model;
  }
  
  // Use created_at date to determine which default model was active
  const conversationDate = new Date(conversation.created_at);
  
  // Find the appropriate model based on the conversation date
  // Start from the end and work backwards to find the right period
  for (let i = DEFAULT_MODEL_TIMELINE.length - 1; i >= 0; i--) {
    if (conversationDate >= DEFAULT_MODEL_TIMELINE[i].date) {
      return DEFAULT_MODEL_TIMELINE[i].model;
    }
  }
  
  // If date is before all known dates, use the first model
  return DEFAULT_MODEL_TIMELINE[0].model;
}

// Load organization ID from storage
async function loadOrgId() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['organizationId'], (result) => {
      orgId = result.organizationId;
      if (!orgId) {
        showError('Organization ID not configured. Please configure it in the extension options.');
      }
      resolve();
    });
  });
}

// Load all conversations
async function loadConversations() {
  if (!orgId) return;
  
  try {
    const response = await fetch(`https://claude.ai/api/organizations/${orgId}/chat_conversations`, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json',
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to load conversations: ${response.status}`);
    }
    
    allConversations = await response.json();
    console.log(`Loaded ${allConversations.length} conversations`);
    
    // Infer models for conversations with null model
    allConversations = allConversations.map(conv => ({
      ...conv,
      model: inferModel(conv)
    }));
    
    // Extract unique models for filter
    const models = [...new Set(allConversations.map(c => c.model))].filter(m => m).sort();
    populateModelFilter(models);
    
    // Apply initial sort and display
    applyFiltersAndSort();
    
  } catch (error) {
    console.error('Error loading conversations:', error);
    showError(`Failed to load conversations: ${error.message}`);
  }
}

// Populate model filter dropdown
function populateModelFilter(models) {
  const modelFilter = document.getElementById('modelFilter');
  modelFilter.innerHTML = '<option value="">All Models</option>';
  
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = formatModelName(model);
    modelFilter.appendChild(option);
  });
}

// Format model name for display
function formatModelName(model) {
  return MODEL_DISPLAY_NAMES[model] || model;
}

// Get model badge class
function getModelBadgeClass(model) {
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('opus')) return 'opus';
  if (model.includes('haiku')) return 'haiku';
  return '';
}

// Apply filters and sorting
function applyFiltersAndSort() {
  const searchTerm = document.getElementById('searchInput').value.toLowerCase().trim();
  const modelFilter = document.getElementById('modelFilter').value;

  lastSearchSnippets = new Map();

  filteredConversations = allConversations.filter(conv => {
    let matchesSearch = !searchTerm;
    if (searchTerm) {
      if (fullTextEnabled) {
        const r = searchInContent(conv, searchTerm);
        matchesSearch = r.match;
        if (r.snippet) lastSearchSnippets.set(conv.uuid, r.snippet);
      } else {
        matchesSearch =
          (conv.name || '').toLowerCase().includes(searchTerm) ||
          (conv.summary && conv.summary.toLowerCase().includes(searchTerm));
      }
    }

    const matchesModel = !modelFilter || conv.model === modelFilter;
    return matchesSearch && matchesModel;
  });

  sortConversations();
  displayConversations();
  updateStats();
}

// Sort conversations based on current sort setting
function sortConversations() {
  const [field, direction] = currentSort.split('_');
  
  filteredConversations.sort((a, b) => {
    let aVal, bVal;
    
    switch (field) {
      case 'name':
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
        break;
      case 'created':
        aVal = new Date(a.created_at);
        bVal = new Date(b.created_at);
        break;
      case 'updated':
        aVal = new Date(a.updated_at);
        bVal = new Date(b.updated_at);
        break;
      default:
        return 0;
    }
    
    if (direction === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
}

// Display conversations in table
function displayConversations() {
  const tableContent = document.getElementById('tableContent');
  
  if (filteredConversations.length === 0) {
    tableContent.innerHTML = '<div class="no-results">No conversations found</div>';
    updateSelectionUI();
    return;
  }

  let html = `
    <table>
      <thead>
        <tr>
          <th class="col-select"><input type="checkbox" class="select-all" id="selectAllVisible"></th>
          <th class="sortable" data-sort="name">Name</th>
          <th class="sortable" data-sort="updated">Last Updated</th>
          <th class="sortable" data-sort="created">Created</th>
          <th>Model</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
  `;
  
  filteredConversations.forEach(conv => {
    const updatedDate = new Date(conv.updated_at).toLocaleDateString();
    const createdDate = new Date(conv.created_at).toLocaleDateString();
    const modelBadgeClass = getModelBadgeClass(conv.model);
    
    const isChecked = selectedIds.has(conv.uuid) ? 'checked' : '';
    const snippet = lastSearchSnippets.get(conv.uuid);
    html += `
      <tr data-id="${conv.uuid}">
        <td class="col-select">
          <input type="checkbox" class="row-select" data-id="${conv.uuid}" ${isChecked}>
        </td>
        <td>
          <div class="conversation-name">
            <a href="https://claude.ai/chat/${conv.uuid}" target="_blank" title="${conv.name}">
              ${conv.name}
            </a>
          </div>
          ${snippet ? `<div class="conv-snippet">${snippet}</div>` : ''}
        </td>
        <td class="date">${updatedDate}</td>
        <td class="date">${createdDate}</td>
        <td>
          <span class="model-badge ${modelBadgeClass}">
            ${formatModelName(conv.model)}
          </span>
        </td>
        <td>
          <div class="actions">
            <button class="btn-small btn-preview" data-id="${conv.uuid}" data-name="${conv.name}">
              Preview
            </button>
            <button class="btn-small btn-export" data-id="${conv.uuid}" data-name="${conv.name}">
              Export
            </button>
            <button class="btn-small btn-view" data-id="${conv.uuid}">
              View
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  
  html += `
      </tbody>
    </table>
  `;
  
  tableContent.innerHTML = html;
  
  // Add preview button listeners
  document.querySelectorAll('.btn-preview').forEach(btn => {
    btn.addEventListener('click', (e) => {
      openPreview(e.target.dataset.id, e.target.dataset.name);
    });
  });

  // Add export button listeners
  document.querySelectorAll('.btn-export').forEach(btn => {
    btn.addEventListener('click', (e) => {
      exportConversation(e.target.dataset.id, e.target.dataset.name);
    });
  });
  
  // Add view button listeners
  document.querySelectorAll('.btn-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const conversationId = e.target.dataset.id;
      window.open(`https://claude.ai/chat/${conversationId}`, '_blank');
    });
  });

  // Row checkboxes
  document.querySelectorAll('.row-select').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = e.target.dataset.id;
      if (e.target.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      updateSelectionUI();
    });
  });

  // Header "select all visible" checkbox
  const selectAll = document.getElementById('selectAllVisible');
  selectAll.addEventListener('change', (e) => {
    const check = e.target.checked;
    filteredConversations.forEach(conv => {
      if (check) selectedIds.add(conv.uuid);
      else selectedIds.delete(conv.uuid);
    });
    document.querySelectorAll('.row-select').forEach(cb => { cb.checked = check; });
    updateSelectionUI();
  });

  updateSelectionUI();

  // Enable export all button
  document.getElementById('exportAllBtn').disabled = false;
}

// Update statistics
function updateStats() {
  const stats = document.getElementById('stats');
  stats.textContent = `Showing ${filteredConversations.length} of ${allConversations.length} conversations`;
}

// Sync header "select all" indeterminate state + "Export Selected" button label/enabled state.
function updateSelectionUI() {
  const selectAll = document.getElementById('selectAllVisible');
  const exportSelectedBtn = document.getElementById('exportSelectedBtn');

  let visibleSelected = 0;
  for (const conv of filteredConversations) {
    if (selectedIds.has(conv.uuid)) visibleSelected++;
  }

  if (selectAll) {
    if (visibleSelected === 0) {
      selectAll.checked = false;
      selectAll.indeterminate = false;
    } else if (visibleSelected === filteredConversations.length) {
      selectAll.checked = true;
      selectAll.indeterminate = false;
    } else {
      selectAll.checked = false;
      selectAll.indeterminate = true;
    }
  }

  const totalSelected = selectedIds.size;
  exportSelectedBtn.textContent = `Export Selected (${totalSelected})`;
  exportSelectedBtn.disabled = totalSelected === 0;
}

// Collect export options from the header settings panel.
function gatherExportOpts() {
  return {
    humanName: (document.getElementById('humanName').value || '我').trim(),
    assistantName: (document.getElementById('assistantName').value || 'Claude').trim(),
    includeMetadata: document.getElementById('includeMetadata').checked,
    includeThinking: document.getElementById('includeThinking').checked,
    includeRetries: document.getElementById('includeRetries').checked
  };
}

// Strip filename-illegal characters.
function safeFileName(name, fallback) {
  return String(name || fallback || 'untitled').replace(/[<>:"/\\|?*]/g, '_').slice(0, 120);
}

// Convert a fetched conversation into {content, ext, mime} per chosen format.
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

// Export single conversation
async function exportConversation(conversationId, conversationName) {
  const format = document.getElementById('exportFormat').value;
  const opts = gatherExportOpts();

  try {
    showToast(`Exporting ${conversationName}...`);

    const response = await fetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true`,
      {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch conversation: ${response.status}`);
    }

    const data = await response.json();
    data.model = inferModel(data);

    const { content, ext, mime } = renderForFormat(data, format, opts);
    const filename = `claude-${safeFileName(conversationName, conversationId)}.${ext}`;

    downloadFile(content, filename, mime);
    showToast(`Exported: ${conversationName}`);

  } catch (error) {
    console.error('Export error:', error);
    showToast(`Failed to export: ${error.message}`, true);
  }
}

// Shared ZIP-and-download helper used by both Export All and Export Selected.
async function buildAndDownloadZip(conversations, zipBaseName, triggerButton) {
  const format = document.getElementById('exportFormat').value;
  const opts = gatherExportOpts();

  const originalLabel = triggerButton.textContent;
  triggerButton.disabled = true;
  triggerButton.textContent = 'Preparing...';

  // Show progress modal
  const progressModal = document.getElementById('progressModal');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressStats = document.getElementById('progressStats');
  progressModal.style.display = 'block';

  let cancelExport = false;
  const cancelButton = document.getElementById('cancelExport');
  cancelButton.onclick = () => {
    cancelExport = true;
    progressText.textContent = 'Cancelling...';
  };

  try {
    // Create a new ZIP file
    const zip = new JSZip();
    const total = conversations.length;
    let completed = 0;
    let failed = 0;
    const failedConversations = [];

    progressText.textContent = `Exporting ${total} conversations...`;

    // Process conversations in batches to avoid overwhelming the API
    const batchSize = 3; // Process 3 at a time
    for (let i = 0; i < total; i += batchSize) {
      if (cancelExport) break;

      const batch = conversations.slice(i, Math.min(i + batchSize, total));
      const promises = batch.map(async (conv) => {
        try {
          const response = await fetch(
            `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`,
            {
              credentials: 'include',
              headers: {
                'Accept': 'application/json',
              }
            }
          );

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }

          const data = await response.json();

          // Infer model if null
          data.model = inferModel(data);

          const safeName = safeFileName(conv.name, conv.uuid);
          const { content, ext } = renderForFormat(data, format, opts);
          const filename = `${safeName}.${ext}`;

          // Add file to ZIP
          zip.file(filename, content);
          completed++;

        } catch (error) {
          console.error(`Failed to export ${conv.name}:`, error);
          failed++;
          failedConversations.push(conv.name);
        }
      });

      // Wait for batch to complete
      await Promise.all(promises);

      // Update progress
      const progress = Math.round((completed + failed) / total * 100);
      progressBar.style.width = `${progress}%`;
      progressStats.textContent = `${completed} succeeded, ${failed} failed out of ${total}`;

      // Small delay between batches
      if (i + batchSize < total && !cancelExport) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    if (cancelExport) {
      progressModal.style.display = 'none';
      showToast('Export cancelled', true);
      return;
    }

    // Add a summary file
    const summary = {
      export_date: new Date().toISOString(),
      total_conversations: total,
      successful_exports: completed,
      failed_exports: failed,
      failed_conversations: failedConversations,
      format: format,
      options: opts
    };
    zip.file('export_summary.json', JSON.stringify(summary, null, 2));

    // Generate and download the ZIP file
    progressText.textContent = 'Creating ZIP file...';
    const blob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6 // Medium compression
      }
    }, (metadata) => {
      // Update progress during ZIP creation
      const zipProgress = Math.round(metadata.percent);
      progressBar.style.width = `${zipProgress}%`;
    });

    // Download the ZIP file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${zipBaseName}-${new Date().toISOString().split('T')[0]}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    progressModal.style.display = 'none';

    if (failed > 0) {
      showToast(`Exported ${completed} of ${total} conversations (${failed} failed). Check export_summary.json in the ZIP for details.`);
    } else {
      showToast(`Successfully exported all ${completed} conversations!`);
    }

  } catch (error) {
    console.error('Export error:', error);
    progressModal.style.display = 'none';
    showToast(`Export failed: ${error.message}`, true);
  } finally {
    triggerButton.disabled = false;
    triggerButton.textContent = originalLabel;
  }
}

// Export all filtered conversations
function exportAllFiltered() {
  const btn = document.getElementById('exportAllBtn');
  return buildAndDownloadZip(filteredConversations, 'claude-conversations', btn);
}

// Export only the user-selected conversations (preserves hidden-but-selected items).
function exportSelected() {
  const visibleSelected = filteredConversations.filter(c => selectedIds.has(c.uuid));
  const visibleIds = new Set(visibleSelected.map(c => c.uuid));
  const hiddenSelected = allConversations.filter(
    c => selectedIds.has(c.uuid) && !visibleIds.has(c.uuid)
  );
  const btn = document.getElementById('exportSelectedBtn');
  return buildAndDownloadZip(
    [...visibleSelected, ...hiddenSelected],
    'claude-conversations-selected',
    btn
  );
}

// Conversion functions are now imported from utils.js
// Functions available: getCurrentBranch, convertToMarkdown, convertToText, downloadFile

// Show error message
function showError(message) {
  const tableContent = document.getElementById('tableContent');
  tableContent.innerHTML = `<div class="error">${message}</div>`;
}

// Show toast notification
function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.style.background = isError ? '#d32f2f' : '#333';
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

// ---------- Full-text search ----------

function loadFullTextCache() {
  try {
    const raw = localStorage.getItem(FULLTEXT_LS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    for (const [uuid, val] of Object.entries(data)) {
      if (val && typeof val.text === 'string') fullTextCache.set(uuid, val);
    }
  } catch (e) {
    console.warn('[fulltext] failed to load cache', e);
  }
}

function saveFullTextCache() {
  try {
    const obj = {};
    for (const [k, v] of fullTextCache) obj[k] = v;
    localStorage.setItem(FULLTEXT_LS_KEY, JSON.stringify(obj));
  } catch (e) {
    // Most likely localStorage quota exceeded — fail loudly so user knows.
    console.warn('[fulltext] failed to save cache (quota exceeded?)', e);
    showToast('全文索引保存失败（localStorage 满了？）', true);
  }
}

// Flatten a fully-fetched conversation into one lowercased blob for substring search.
function buildSearchText(fullConv) {
  const parts = [];
  parts.push(fullConv.name || fullConv.title || '');
  if (fullConv.summary) parts.push(fullConv.summary);
  for (const msg of (fullConv.chat_messages || [])) {
    if (msg.text) parts.push(msg.text);
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) parts.push(block.text);
        if (block.thinking) parts.push(block.thinking);
      }
    }
  }
  return parts.join('\n').toLowerCase();
}

function updateFullTextStatus(messageOverride, clsOverride) {
  const statusEl = document.getElementById('fulltextStatus');
  const rebuildBtn = document.getElementById('fulltextRebuild');
  const cancelBtn = document.getElementById('fulltextCancel');
  const toggle = document.getElementById('fulltextToggle');
  if (!statusEl) return;

  let text, cls;
  if (messageOverride != null) {
    text = messageOverride;
    cls = clsOverride || '';
  } else if (fullTextIndexing) {
    text = '索引中…';
    cls = 'indexing';
  } else if (!fullTextEnabled) {
    text = '未启用 · 仅搜索标题';
    cls = '';
  } else {
    text = `已启用 · 覆盖 ${fullTextCache.size} 个对话`;
    cls = 'ready';
  }

  statusEl.textContent = text;
  statusEl.className = 'fulltext-status' + (cls ? ' ' + cls : '');

  if (fullTextIndexing) {
    if (rebuildBtn) rebuildBtn.hidden = true;
    if (cancelBtn) cancelBtn.hidden = false;
  } else {
    if (rebuildBtn) rebuildBtn.hidden = !fullTextEnabled;
    if (cancelBtn) cancelBtn.hidden = true;
  }
  if (toggle) {
    toggle.checked = fullTextEnabled;
    toggle.disabled = fullTextIndexing;
  }
}

// Fetch full content for all conversations that need it (new or stale).
// rebuild=true wipes the cache first; silent=true skips the completion toast.
async function enableFullText({ rebuild = false, silent = false } = {}) {
  if (fullTextIndexing) return;
  if (!orgId) { showToast('Organization ID 未配置', true); return; }

  fullTextEnabled = true;
  fullTextIndexing = true;
  fullTextCancelFlag = false;

  if (rebuild) fullTextCache.clear();

  updateFullTextStatus();

  const needFetch = allConversations.filter(conv => {
    const cached = fullTextCache.get(conv.uuid);
    if (!cached) return true;
    return cached.updated_at !== conv.updated_at;
  });

  // Also prune cache entries for conversations that no longer exist server-side.
  const liveIds = new Set(allConversations.map(c => c.uuid));
  for (const uuid of [...fullTextCache.keys()]) {
    if (!liveIds.has(uuid)) fullTextCache.delete(uuid);
  }

  if (needFetch.length === 0) {
    saveFullTextCache();
    fullTextIndexing = false;
    updateFullTextStatus();
    applyFiltersAndSort();
    return;
  }

  const total = needFetch.length;
  let done = 0;
  let failed = 0;
  const batchSize = 3;

  for (let i = 0; i < total; i += batchSize) {
    if (fullTextCancelFlag) break;
    const batch = needFetch.slice(i, i + batchSize);
    await Promise.all(batch.map(async conv => {
      try {
        const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conv.uuid}?tree=True&rendering_mode=messages&render_all_tools=true`;
        const r = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        fullTextCache.set(conv.uuid, {
          updated_at: conv.updated_at,
          text: buildSearchText(data)
        });
        done++;
      } catch (e) {
        failed++;
        console.warn(`[fulltext] fetch failed for ${conv.uuid}`, e);
      }
    }));
    updateFullTextStatus(
      `索引中… ${done + failed} / ${total}${failed > 0 ? `（失败 ${failed}）` : ''}`,
      'indexing'
    );
    // Persist incrementally so a closed tab doesn't lose progress.
    if ((i / batchSize) % 5 === 0) saveFullTextCache();
    if (i + batchSize < total && !fullTextCancelFlag) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  saveFullTextCache();
  fullTextIndexing = false;

  if (!silent) {
    if (fullTextCancelFlag) {
      showToast(`索引已取消（已索引 ${done} 个，剩 ${total - done - failed} 个）`);
    } else if (failed > 0) {
      showToast(`全文索引完成 · 成功 ${done} / 失败 ${failed}`);
    } else {
      showToast(`全文索引完成 · ${done} 个对话`);
    }
  }
  updateFullTextStatus();
  applyFiltersAndSort();
}

function cancelFullText() { fullTextCancelFlag = true; }

function disableFullText() {
  fullTextEnabled = false;
  updateFullTextStatus();
  applyFiltersAndSort();
}

// Look up a conversation in the cache and pull a snippet around the match.
// Returns { match: boolean, snippet: string|null } where snippet may contain <mark> tags.
function searchInContent(conv, query) {
  if (!query) return { match: true, snippet: null };

  const name = (conv.name || '').toLowerCase();
  const summary = (conv.summary || '').toLowerCase();
  if (name.includes(query) || summary.includes(query)) {
    return { match: true, snippet: null };
  }

  const cached = fullTextCache.get(conv.uuid);
  if (!cached || !cached.text.includes(query)) {
    return { match: false, snippet: null };
  }

  const idx = cached.text.indexOf(query);
  const start = Math.max(0, idx - 25);
  const end = Math.min(cached.text.length, idx + query.length + 40);
  let snippet = cached.text.slice(start, end);

  // Escape HTML first, then re-highlight the query.
  snippet = snippet.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escapedQuery = query
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  snippet = snippet.replace(new RegExp(escapedQuery, 'gi'), m => `<mark>${m}</mark>`);

  if (start > 0) snippet = '…' + snippet;
  if (end < cached.text.length) snippet = snippet + '…';
  return { match: true, snippet };
}

// ---------- /Full-text search ----------

// ---------- Preview modal ----------

// Open preview for a single conversation: seed config from current export settings,
// fetch full content, then render. Subsequent config tweaks just re-render — no re-fetch.
async function openPreview(uuid, name) {
  if (!orgId) { showToast('Organization ID 未配置', true); return; }

  // Seed previewState from the page's current export defaults so the first render
  // matches what "Export" on this row would produce.
  previewState.uuid = uuid;
  previewState.name = name || uuid;
  previewState.conv = null;
  previewState.format = document.getElementById('exportFormat').value;
  previewState.includeMetadata = document.getElementById('includeMetadata').checked;
  previewState.includeThinking = document.getElementById('includeThinking').checked;
  previewState.includeRetries = document.getElementById('includeRetries').checked;
  previewState.humanName = (document.getElementById('humanName').value || '我').trim() || '我';
  previewState.assistantName = (document.getElementById('assistantName').value || 'Claude').trim() || 'Claude';

  // Push state into the modal's own controls
  document.getElementById('previewFormat').value = previewState.format;
  document.getElementById('previewMetadata').checked = previewState.includeMetadata;
  document.getElementById('previewThinking').checked = previewState.includeThinking;
  document.getElementById('previewRetries').checked = previewState.includeRetries;
  document.getElementById('previewHumanName').value = previewState.humanName;
  document.getElementById('previewAssistantName').value = previewState.assistantName;

  document.getElementById('previewModalTitle').textContent = `预览 · ${name}`;
  document.getElementById('previewLoading').hidden = false;
  document.getElementById('previewLoading').textContent = '加载对话内容…';
  document.getElementById('previewError').hidden = true;
  document.getElementById('previewIframe').hidden = true;
  document.getElementById('previewText').hidden = true;
  document.getElementById('previewDownloadBtn').disabled = true;
  document.getElementById('previewModal').hidden = false;

  try {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages&render_all_tools=true`;
    const r = await fetch(url, { credentials: 'include', headers: { 'Accept': 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    data.model = inferModel(data);
    previewState.conv = data;
    document.getElementById('previewLoading').hidden = true;
    document.getElementById('previewDownloadBtn').disabled = false;
    renderPreviewContent();
  } catch (e) {
    document.getElementById('previewLoading').hidden = true;
    const errEl = document.getElementById('previewError');
    errEl.textContent = `加载失败：${e.message}`;
    errEl.hidden = false;
  }
}

// Re-render the right pane against current previewState. Cheap; runs on every config change.
function renderPreviewContent() {
  if (!previewState.conv) return;
  const opts = {
    humanName: previewState.humanName,
    assistantName: previewState.assistantName,
    includeMetadata: previewState.includeMetadata,
    includeThinking: previewState.includeThinking,
    includeRetries: previewState.includeRetries
  };
  const iframe = document.getElementById('previewIframe');
  const pre = document.getElementById('previewText');

  if (previewState.format === 'line') {
    iframe.srcdoc = convertToLineHTML(previewState.conv, opts);
    iframe.hidden = false;
    pre.hidden = true;
  } else {
    let txt;
    switch (previewState.format) {
      case 'markdown': txt = convertToMarkdown(previewState.conv, opts); break;
      case 'text': txt = convertToText(previewState.conv, opts); break;
      default: txt = JSON.stringify(previewState.conv, null, 2);
    }
    pre.textContent = txt;
    pre.hidden = false;
    iframe.hidden = true;
  }
}

function closePreview() {
  document.getElementById('previewModal').hidden = true;
  // Release the rendered HTML / text to free memory; the next open will rebuild.
  document.getElementById('previewIframe').srcdoc = '';
  document.getElementById('previewText').textContent = '';
  previewState.conv = null;
  previewState.uuid = null;
}

// Reuse the same converter path as Export — guarantees what user sees in preview matches the file.
function downloadFromPreview() {
  if (!previewState.conv) return;
  const opts = {
    humanName: previewState.humanName,
    assistantName: previewState.assistantName,
    includeMetadata: previewState.includeMetadata,
    includeThinking: previewState.includeThinking,
    includeRetries: previewState.includeRetries
  };
  const { content, ext, mime } = renderForFormat(previewState.conv, previewState.format, opts);
  const filename = `claude-${safeFileName(previewState.name, previewState.uuid)}.${ext}`;
  downloadFile(content, filename, mime);
  showToast(`已下载：${filename}`);
}

// ---------- /Preview modal ----------

// Setup event listeners
function setupEventListeners() {
  // Search input
  const searchInput = document.getElementById('searchInput');
  searchInput.addEventListener('input', (e) => {
    const searchBox = document.getElementById('searchBox');
    if (e.target.value) {
      searchBox.classList.add('has-text');
    } else {
      searchBox.classList.remove('has-text');
    }
    applyFiltersAndSort();
  });
  
  // Clear search
  document.getElementById('clearSearch').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    document.getElementById('searchBox').classList.remove('has-text');
    applyFiltersAndSort();
  });
  
  // Model filter
  document.getElementById('modelFilter').addEventListener('change', applyFiltersAndSort);
  
  // Sort dropdown
  document.getElementById('sortBy').addEventListener('change', (e) => {
    currentSort = e.target.value;
    applyFiltersAndSort();
  });
  
  // Export all button
  document.getElementById('exportAllBtn').addEventListener('click', exportAllFiltered);

  // Export selected button
  document.getElementById('exportSelectedBtn').addEventListener('click', exportSelected);

  // Full-text search toggle
  document.getElementById('fulltextToggle').addEventListener('change', (e) => {
    if (e.target.checked) {
      enableFullText({ rebuild: false });
    } else {
      disableFullText();
    }
  });
  document.getElementById('fulltextRebuild').addEventListener('click', () => {
    enableFullText({ rebuild: true });
  });
  document.getElementById('fulltextCancel').addEventListener('click', cancelFullText);

  // Preview modal — each control just mutates previewState and re-renders.
  document.getElementById('previewFormat').addEventListener('change', (e) => {
    previewState.format = e.target.value;
    renderPreviewContent();
  });
  document.getElementById('previewMetadata').addEventListener('change', (e) => {
    previewState.includeMetadata = e.target.checked;
    renderPreviewContent();
  });
  document.getElementById('previewThinking').addEventListener('change', (e) => {
    previewState.includeThinking = e.target.checked;
    renderPreviewContent();
  });
  document.getElementById('previewRetries').addEventListener('change', (e) => {
    previewState.includeRetries = e.target.checked;
    renderPreviewContent();
  });
  document.getElementById('previewHumanName').addEventListener('input', (e) => {
    previewState.humanName = (e.target.value || '我').trim() || '我';
    renderPreviewContent();
  });
  document.getElementById('previewAssistantName').addEventListener('input', (e) => {
    previewState.assistantName = (e.target.value || 'Claude').trim() || 'Claude';
    renderPreviewContent();
  });
  document.getElementById('previewModalClose').addEventListener('click', closePreview);
  document.getElementById('previewDownloadBtn').addEventListener('click', downloadFromPreview);
  // Click outside the modal panel (on the backdrop itself) closes it.
  document.getElementById('previewModal').addEventListener('click', (e) => {
    if (e.target.id === 'previewModal') closePreview();
  });
  // Esc closes the modal.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('previewModal').hidden) {
      closePreview();
    }
  });
}
