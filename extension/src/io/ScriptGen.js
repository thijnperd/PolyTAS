/**
 * ScriptGen — generates a self-contained IIFE replay script.
 *
 * The generated script patches window.requestAnimationFrame so it advances
 * inputs on actual game-frame ticks, not wall-clock time. This is the key
 * correctness fix over the old approach.
 */
import { InputStore } from '../core/InputStore.js';

export class ScriptGen {
  /**
   * @param {InputStore} store
   * @param {number} fps
   * @param {number} totalFrames
   */
  static generate(store, fps, totalFrames) {
    const arr  = store.getFrameArray();
    const rle  = InputStore.rleEncode(arr);
    const date = new Date().toISOString();
    const segs = store.getSegments();

    return `\
// PolyTAS Replay Script — ${date}
// ${segs.length} segments | ${totalFrames} frames @ ${fps} fps
// Paste into Polytrack console (F12 → Console). polyTASStop() to abort.
(function () {
  'use strict';

  // ── Input data (RLE bitmask) ──────────────────────────────────────────────
  const RLE = ${JSON.stringify(rle)};

  // Decode RLE to flat Uint8Array
  const inp = (function () {
    const a = new Uint8Array(${totalFrames});
    let f = 0;
    for (const [v, c] of RLE) { a.fill(v, f, Math.min(f + c, ${totalFrames})); f += c; }
    return a;
  })();

  // ── Key mapping ───────────────────────────────────────────────────────────
  const KM  = { up: ['ArrowUp', 'w'], down: ['ArrowDown', 's'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'] };
  const BIT = { up: 1, down: 2, left: 4, right: 8 };

  // Dispatch to document AND window to maximise compatibility
  function dk(k, t) {
    const ev = new KeyboardEvent(t, { key: k, code: k, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    window.dispatchEvent(ev);
  }

  // Update held keys by comparing new bitmask to current
  let cur = 0;
  function setKeys(nb) {
    const ch = cur ^ nb;
    if (!ch) return;
    for (const [name, bit] of Object.entries(BIT)) {
      if (ch & bit) KM[name].forEach(k => dk(k, (nb & bit) ? 'keydown' : 'keyup'));
    }
    cur = nb;
  }

  // ── rAF intercept — frame-accurate delivery ───────────────────────────────
  let frame    = 0;
  let stopped  = false;
  const _rAF   = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function (cb) {
    return _rAF(function (ts) {
      if (!stopped) {
        if (frame < inp.length) {
          setKeys(inp[frame]);
          frame++;
        } else {
          // Replay finished — release all keys and restore rAF
          setKeys(0);
          window.requestAnimationFrame = _rAF;
          stopped = true;
          console.log('%c[PolyTAS] Done! 🏁', 'color:#FFD60A;font-weight:bold');
        }
      }
      cb(ts);
    });
  };

  // ── Abort handle ─────────────────────────────────────────────────────────
  window.polyTASStop = function () {
    if (stopped) return;
    setKeys(0);
    window.requestAnimationFrame = _rAF;
    stopped = true;
    console.log('%c[PolyTAS] Stopped.', 'color:#ff3a5c');
  };

  // ── Restart game then begin replay ────────────────────────────────────────
  console.log('%c[PolyTAS] Restarting game…', 'color:#39ff85');
  dk('r', 'keydown');
  setTimeout(() => {
    dk('r', 'keyup');
    setTimeout(() => {
      console.log('%c[PolyTAS] Replaying ${totalFrames} frames @ ${fps} fps — polyTASStop() to abort', 'color:#3a9eff');
    }, 700);
  }, 120);

})();`;
  }
}
