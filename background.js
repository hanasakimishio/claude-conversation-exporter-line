// Handle extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Claude Conversation Exporter installed');
});

// Inject content scripts into already-open Claude.ai tabs when extension is installed/updated.
// Order matters: utils.js defines the conversion helpers that content.js depends on.
chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
    tabs.forEach(tab => {
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['utils.js', 'content.js']
      }).catch(err => console.log('Could not inject into tab', tab.id, err));
    });
  });
});

// Handle messages from popup when content script might not be injected
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'ensureContentScript') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          files: ['utils.js', 'content.js']
        }, () => {
          sendResponse({ success: true });
        });
      }
    });
    return true;
  }
});