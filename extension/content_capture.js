if (window.__polytasCaptureInstalled) {
  // Avoid duplicate listeners if re-injected.
} else {
  window.__polytasCaptureInstalled = true;
  let captureEnabled = true;

  chrome.runtime.onMessage.addListener(msg => {
    if (msg && msg.type === 'SET_CAPTURE') {
      captureEnabled = !!msg.enabled;
    }
  });

  function sendKey(type, e) {
    chrome.runtime.sendMessage({
      type,
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat
    });
  }

  window.addEventListener('keydown', e => {
    if (!captureEnabled) return;
    sendKey('KEY_DOWN', e);
  }, true);

  window.addEventListener('keyup', e => {
    if (!captureEnabled) return;
    sendKey('KEY_UP', e);
  }, true);
}
