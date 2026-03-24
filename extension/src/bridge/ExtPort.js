/**
 * ExtPort — wrapper around chrome.runtime.connect for the polytas port.
 * Reconnects automatically if the service worker wakes up a new port.
 */
export class ExtPort {
  constructor() {
    this._port      = null;
    this._handlers  = {};  // type → handler fn
    this._available = false;
  }

  init() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) return false;
    this._available = true;
    this._connect();
    return true;
  }

  isAvailable() { return this._available; }

  on(type, fn) { this._handlers[type] = fn; }

  send(msg) {
    if (!this._port) return false;
    try { this._port.postMessage(msg); return true; }
    catch { return false; }
  }

  _connect() {
    if (!this._available) return;
    this._port = chrome.runtime.connect({ name: 'polytas' });
    this._port.onMessage.addListener(msg => {
      if (!msg?.type) return;
      const h = this._handlers[msg.type];
      if (h) h(msg);
    });
    this._port.onDisconnect.addListener(() => {
      this._port = null;
      // Reconnect after a short delay (service worker may have gone dormant)
      setTimeout(() => this._connect(), 1000);
    });
  }
}
