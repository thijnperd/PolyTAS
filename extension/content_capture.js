/**
 * content_capture.js — injected into the Polytrack game tab.
 *
 * Responsibilities:
 *  1. Intercept requestAnimationFrame to emit GAME_TICK on every game frame.
 *  2. Capture keydown/keyup events and forward them to the service worker.
 *  3. Handle REPLAY_INJECT messages to drive frame-accurate replay from
 *     within the game tab (avoids isTrusted issues with console paste).
 *  4. Handle FAST_FORWARD to reach a savestate frame at max speed.
 *  5. Report game state (position/velocity) when asked.
 */

if (!window.__polytasCaptureInstalled) {
  window.__polytasCaptureInstalled = true;

  // ── State ──────────────────────────────────────────────────────────────────
  let captureEnabled   = true;
  let gameFrame        = 0;
  let replayActive     = false;
  let replayInputs     = null;  // Uint8Array
  let replayFrame      = 0;
  let replayStopped    = false;
  let fastFwdTarget    = -1;
  const _origRAF       = window.requestAnimationFrame.bind(window);

  // ── rAF intercept ──────────────────────────────────────────────────────────
  window.requestAnimationFrame = function (cb) {
    return _origRAF(function (ts) {
      gameFrame++;

      // Emit tick for recording
      chrome.runtime.sendMessage({ type: 'GAME_TICK', frame: gameFrame, ts });

      // Drive replay if active
      if (replayActive && !replayStopped) {
        if (replayFrame < replayInputs.length) {
          _applyBitmask(replayInputs[replayFrame]);
          replayFrame++;
        } else {
          _applyBitmask(0); // release all
          replayActive = false;
          chrome.runtime.sendMessage({ type: 'REPLAY_DONE', frame: gameFrame });
          _restoreRAF();
        }
      }

      // Fast-forward mode: call cb without yielding to browser paint
      if (fastFwdTarget > 0 && gameFrame < fastFwdTarget) {
        cb(ts);
        // Recurse synchronously to skip rendering
        window.requestAnimationFrame(function (ts2) {});
        return;
      }
      if (gameFrame === fastFwdTarget) {
        fastFwdTarget = -1;
        chrome.runtime.sendMessage({ type: 'FAST_FORWARD_DONE', frame: gameFrame });
      }

      cb(ts);
    });
  };

  // ── Key capture ────────────────────────────────────────────────────────────
  function sendKey(type, e) {
    if (!captureEnabled) return;
    chrome.runtime.sendMessage({
      type,
      key:      e.key,
      code:     e.code,
      ctrlKey:  e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey:   e.altKey,
      metaKey:  e.metaKey,
      repeat:   e.repeat,
    });
  }

  window.addEventListener('keydown', e => sendKey('KEY_DOWN', e), true);
  window.addEventListener('keyup',   e => sendKey('KEY_UP',   e), true);

  // ── Message handler ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
    if (!msg?.type) return;

    switch (msg.type) {
      case 'SET_CAPTURE':
        captureEnabled = !!msg.enabled;
        break;

      case 'REPLAY_INJECT': {
        // msg.rle: [[value,count],...], msg.totalFrames
        const arr = _decodedRLE(msg.rle, msg.totalFrames);
        replayInputs  = arr;
        replayFrame   = msg.startFrame || 0;
        replayStopped = false;
        replayActive  = true;
        // Restart game
        _dispatchKey('r', 'keydown');
        setTimeout(() => _dispatchKey('r', 'keyup'), 120);
        break;
      }

      case 'REPLAY_STOP':
        _applyBitmask(0);
        replayStopped = true;
        replayActive  = false;
        break;

      case 'FAST_FORWARD':
        fastFwdTarget = msg.targetFrame;
        if (msg.inputs) {
          replayInputs = _decodedRLE(msg.inputs, msg.targetFrame + 1);
          replayFrame  = 0;
          replayActive = true;
        }
        break;

      case 'GET_GAME_STATE':
        respond({ frame: gameFrame, state: _readGameState() });
        return true; // async response

      case 'RESET_FRAME_COUNTER':
        gameFrame = 0;
        break;
    }
  });

  window.addEventListener('beforeunload', () => {
    chrome.runtime.sendMessage({ type: 'GAME_UNLOADED' });
  });

  // ── Helpers ────────────────────────────────────────────────────────────────

  const KM  = { up: ['ArrowUp', 'w'], down: ['ArrowDown', 's'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'] };
  const BIT = { up: 1, down: 2, left: 4, right: 8 };
  let _curBits = 0;

  function _applyBitmask(nb) {
    const ch = _curBits ^ nb;
    if (!ch) return;
    for (const [name, bit] of Object.entries(BIT)) {
      if (ch & bit) {
        const type = (nb & bit) ? 'keydown' : 'keyup';
        KM[name].forEach(k => _dispatchKey(k, type));
      }
    }
    _curBits = nb;
  }

  function _dispatchKey(key, type) {
    const targets = [document, window, document.activeElement].filter(Boolean);
    for (const target of targets) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key, code: key, bubbles: true, cancelable: true,
      }));
    }
  }

  function _decodedRLE(rle, totalFrames) {
    const arr = new Uint8Array(totalFrames);
    let f = 0;
    for (const [v, c] of rle) {
      arr.fill(v, f, Math.min(f + c, totalFrames));
      f += c;
      if (f >= totalFrames) break;
    }
    return arr;
  }

  function _restoreRAF() {
    // No-op: we keep our patched rAF active for continued tick reporting
  }

  /** Attempt to read game state. Returns null if game state is not inspectable. */
  function _readGameState() {
    try {
      // These property names are guesses — inspect the game bundle to confirm
      const g = window.__gameState || window.gameState || window.game;
      if (!g) return null;
      return {
        pos: g.vehicle?.position ?? g.position ?? null,
        vel: g.vehicle?.velocity ?? g.velocity ?? null,
      };
    } catch { return null; }
  }
}
