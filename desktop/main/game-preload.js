const { ipcRenderer } = require('electron');

if (!window.__polytasCaptureInstalled) {
  window.__polytasCaptureInstalled = true;

  let captureEnabled = true;
  let gameFrame = 0;
  let replayActive = false;
  let replayInputs = null; // Uint8Array
  let replayFrame = 0;
  let replayStopped = false;
  let fastFwdTarget = -1;
  let waitingForStart = false;
  const _origRAF = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function (cb) {
    return _origRAF(function (ts) {
      gameFrame++;

      ipcRenderer.send('polytas:from-game', { type: 'GAME_TICK', frame: gameFrame, ts });

      if (replayActive && !replayStopped) {
        if (replayFrame < replayInputs.length) {
          _applyBitmask(replayInputs[replayFrame]);
          replayFrame++;
        } else {
          _applyBitmask(0);
          replayActive = false;
          ipcRenderer.send('polytas:from-game', { type: 'REPLAY_DONE', frame: gameFrame });
        }
      }

      if (fastFwdTarget > 0 && gameFrame < fastFwdTarget) {
        cb(ts);
        window.requestAnimationFrame(function () {});
        return;
      }
      if (gameFrame === fastFwdTarget) {
        fastFwdTarget = -1;
        ipcRenderer.send('polytas:from-game', { type: 'FAST_FORWARD_DONE', frame: gameFrame });
      }

      cb(ts);
    });
  };

  function sendKey(type, e) {
    if (!captureEnabled) return;
    ipcRenderer.send('polytas:from-game', {
      type,
      key: e.key,
      code: e.code,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
    });
  }

  window.addEventListener('keydown', e => {
    if (waitingForStart) {
      waitingForStart = false;
      replayActive = true;
      _restartGame();
    }
    sendKey('KEY_DOWN', e);
  }, true);
  window.addEventListener('keyup', e => sendKey('KEY_UP', e), true);

  ipcRenderer.on('polytas:to-game', (_event, msg) => {
    if (!msg || !msg.type) return;

    switch (msg.type) {
      case 'SET_CAPTURE':
        captureEnabled = !!msg.enabled;
        break;

      case 'REPLAY_INJECT': {
        const arr = _decodedRLE(msg.rle, msg.totalFrames);
        replayInputs = arr;
        replayFrame = msg.startFrame || 0;
        replayStopped = false;
        waitingForStart = !!msg.waitForSpace;
        replayActive = !waitingForStart;
        if (!waitingForStart) _restartGame();
        break;
      }

      case 'PREVIEW': {
        const arr = _decodedRLE(msg.rle, msg.totalFrames);
        replayInputs = arr;
        replayFrame = 0;
        replayStopped = false;
        replayActive = true;
        fastFwdTarget = typeof msg.targetFrame === 'number' ? msg.targetFrame : -1;
        _restartGame();
        break;
      }

      case 'REPLAY_STOP':
        _applyBitmask(0);
        replayStopped = true;
        replayActive = false;
        waitingForStart = false;
        break;

      case 'FAST_FORWARD':
        fastFwdTarget = msg.targetFrame;
        if (msg.inputs) {
          replayInputs = _decodedRLE(msg.inputs, msg.targetFrame + 1);
          replayFrame = 0;
          replayActive = true;
        }
        break;

      case 'GET_GAME_STATE':
        ipcRenderer.send('polytas:from-game', { type: 'GAME_STATE', frame: gameFrame, state: _readGameState() });
        break;

      case 'RESET_FRAME_COUNTER':
        gameFrame = 0;
        break;
    }
  });

  window.addEventListener('beforeunload', () => {
    ipcRenderer.send('polytas:from-game', { type: 'GAME_UNLOADED' });
  });

  const KM = { up: ['ArrowUp', 'w'], down: ['ArrowDown', 's'], left: ['ArrowLeft', 'a'], right: ['ArrowRight', 'd'] };
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
        key,
        code: key,
        bubbles: true,
        cancelable: true,
      }));
    }
  }

  function _decodedRLE(rle, totalFrames) {
    const arr = new Uint8Array(totalFrames || 0);
    let f = 0;
    (rle || []).forEach(([v, c]) => {
      arr.fill(v, f, Math.min(f + c, arr.length));
      f += c;
    });
    return arr;
  }

  function _restartGame() {
    gameFrame = 0;
    _dispatchKey('r', 'keydown');
    setTimeout(() => _dispatchKey('r', 'keyup'), 120);
  }

  function _readGameState() {
    try {
      const g = window.__gameState || window.gameState || window.game;
      if (!g) return null;
      return {
        pos: g.vehicle?.position ?? g.position ?? null,
        vel: g.vehicle?.velocity ?? g.velocity ?? null,
      };
    } catch {
      return null;
    }
  }
}
