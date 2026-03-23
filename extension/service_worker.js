let appPorts = new Set();
let attachedTabId = null;

function broadcast(msg) {
  appPorts.forEach(port => {
    try {
      port.postMessage(msg);
    } catch (err) {
      // Ignore failed ports
    }
  });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'polytas') return;
  appPorts.add(port);
  port.onDisconnect.addListener(() => appPorts.delete(port));
  port.onMessage.addListener(msg => {
    if (!msg || !msg.type) return;
    if (msg.type === 'ATTACH_GAME') attachToActiveTab(port);
  });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !msg.type) return;
  if (msg.type === 'KEY_DOWN' || msg.type === 'KEY_UP') {
    broadcast(msg);
  }
});

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('launcher.html') });
});

function attachToActiveTab(port) {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      port.postMessage({ type: 'ATTACH_STATUS', status: 'error', error: 'No active tab found.' });
      return;
    }

    chrome.scripting.executeScript(
      { target: { tabId: tab.id }, files: ['content_capture.js'] },
      () => {
        if (chrome.runtime.lastError) {
          port.postMessage({
            type: 'ATTACH_STATUS',
            status: 'error',
            error: chrome.runtime.lastError.message || 'Failed to attach.'
          });
          return;
        }
        attachedTabId = tab.id;
        const status = { type: 'ATTACH_STATUS', status: 'attached', tabId: attachedTabId };
        port.postMessage(status);
        broadcast(status);
      }
    );
  });
}
