const statusEl = document.getElementById('status');
const openPipBtn = document.getElementById('openPip');
const openTabBtn = document.getElementById('openTab');

function setStatus(msg) {
  statusEl.textContent = msg || '';
}

function getAppUrl(path) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

async function openPip() {
  if (!('documentPictureInPicture' in window)) {
    setStatus('Picture-in-Picture is not available in this Chrome build.');
    return;
  }
  try {
    const pipWindow = await documentPictureInPicture.requestWindow({ width: 380, height: 900 });
    pipWindow.document.body.style.margin = '0';
    const iframe = pipWindow.document.createElement('iframe');
    iframe.src = getAppUrl('polytas.html?pip=1');
    iframe.style.cssText = 'border:0;width:100%;height:100%;';
    pipWindow.document.body.appendChild(iframe);
    setStatus('PiP window opened. You can close this tab.');
  } catch (err) {
    setStatus('Failed to open PiP window: ' + err.message);
  }
}

function openTab() {
  const url = getAppUrl('polytas.html');
  if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
    chrome.tabs.create({ url });
  } else {
    window.open(url, '_blank');
  }
}

openPipBtn.addEventListener('click', openPip);
openTabBtn.addEventListener('click', openTab);
