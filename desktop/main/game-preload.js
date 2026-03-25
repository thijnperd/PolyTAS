const { ipcRenderer } = require('electron');

if (!window.__polytasCaptureInstalled) {
  window.__polytasCaptureInstalled = true;

  let captureEnabled = true;
  let gameFrame = 0;
  let replayActive = false;
  let replayInputs = null; // Uint8Array
  let replayFrame = 0;
  let replayStopped = false;
  let replayMode = null;
  let fastFwdTarget = -1;
  let waitingForStart = false;
  let replayLastReportedFrame = -1;
  let replayDriver = 'game';
  let replayFallbackCheckTimer = null;
  let replayFallbackTimer = null;
  let replayFrameDurationMs = 1000 / 60;
  const _origRAF = window.requestAnimationFrame.bind(window);

  window.requestAnimationFrame = function (cb) {
    return _origRAF(function (ts) {
      gameFrame++;

      ipcRenderer.send('polytas:from-game', { type: 'GAME_TICK', frame: gameFrame, ts });

      if (replayActive && !replayStopped && replayDriver !== 'fallback') {
        _advanceReplayFrame();
      }

      if (fastFwdTarget > 0 && gameFrame < fastFwdTarget) {
        cb(ts);
        window.requestAnimationFrame(function () {});
        return;
      }
      if (gameFrame === fastFwdTarget) {
        fastFwdTarget = -1;
        ipcRenderer.send('polytas:from-game', {
          type: 'FAST_FORWARD_DONE',
          frame: gameFrame,
          mode: 'preview',
        });
      }

      cb(ts);
    });
  };

  function sendKey(type, e) {
    if (!captureEnabled || !e?.isTrusted) return;
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

  // Start keys: Space or Enter trigger a waiting replay intentionally.
  const START_KEYS = new Set(['Space', 'Enter', ' ']);

  window.addEventListener('keydown', e => {
    if (waitingForStart && START_KEYS.has(e.key || e.code)) {
      waitingForStart = false;
      replayActive = true;
      _emitReplayStatus('restarting', replayFrame);
      _scheduleReplayFallbackCheck();
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
        _applyBitmask(0);
        replayInputs = arr;
        replayFrame = msg.startFrame || 0;
        replayStopped = false;
        replayMode = 'replay';
        replayLastReportedFrame = -1;
        replayDriver = 'game';
        replayFrameDurationMs = 1000 / Math.max(1, msg.fps || 60);
        fastFwdTarget = -1;
        waitingForStart = !!msg.waitForSpace;
        replayActive = !waitingForStart;
        _emitReplayStatus(waitingForStart ? 'waiting' : 'restarting', replayFrame);
        _scheduleReplayFallbackCheck();
        if (!waitingForStart) _restartGame();
        break;
      }

      case 'PREVIEW': {
        const arr = _decodedRLE(msg.rle, msg.totalFrames);
        _applyBitmask(0);
        replayInputs = arr;
        replayFrame = 0;
        replayStopped = false;
        replayMode = 'preview';
        replayLastReportedFrame = -1;
        replayDriver = 'game';
        replayFrameDurationMs = 1000 / Math.max(1, msg.fps || 60);
        waitingForStart = false;
        replayActive = true;
        fastFwdTarget = typeof msg.targetFrame === 'number' ? msg.targetFrame : -1;
        _restartGame();
        break;
      }

      case 'REPLAY_STOP':
        _applyBitmask(0);
        replayStopped = true;
        replayActive = false;
        replayInputs = null;
        replayFrame = 0;
        if (replayMode === 'replay') _emitReplayStatus('stopped', 0);
        replayMode = null;
        replayLastReportedFrame = -1;
        replayDriver = 'game';
        _clearReplayFallbackCheck();
        fastFwdTarget = -1;
        waitingForStart = false;
        break;

      case 'FAST_FORWARD':
        fastFwdTarget = msg.targetFrame;
        if (msg.inputs) {
          replayInputs = _decodedRLE(msg.inputs, msg.targetFrame + 1);
          replayFrame = 0;
          replayMode = 'preview';
          replayLastReportedFrame = -1;
          replayDriver = 'game';
          replayFrameDurationMs = 1000 / Math.max(1, msg.fps || 60);
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

  // Map logical key name -> [key string, code string] pairs for KeyboardEvent.
  // 'key' is the printable/logical value; 'code' is the physical key identifier.
  const KM = {
    up:    [{ key: 'ArrowUp',    code: 'ArrowUp'    }, { key: 'w', code: 'KeyW' }],
    down:  [{ key: 'ArrowDown',  code: 'ArrowDown'  }, { key: 's', code: 'KeyS' }],
    left:  [{ key: 'ArrowLeft',  code: 'ArrowLeft'  }, { key: 'a', code: 'KeyA' }],
    right: [{ key: 'ArrowRight', code: 'ArrowRight' }, { key: 'd', code: 'KeyD' }],
  };
  const BIT = { up: 1, down: 2, left: 4, right: 8 };
  let _curBits = 0;

  function _applyBitmask(nb) {
    const ch = _curBits ^ nb;
    if (!ch) return;
    for (const [name, bit] of Object.entries(BIT)) {
      if (ch & bit) {
        const type = (nb & bit) ? 'keydown' : 'keyup';
        KM[name].forEach(k => _dispatchKey(k.key, k.code, type));
      }
    }
    _curBits = nb;
  }

  function _dispatchKey(key, code, type) {
    const active = document.activeElement;
    const target = active && active !== document.body && active !== document.documentElement
      ? active
      : document;
    target.dispatchEvent(new KeyboardEvent(type, {
      key,
      code,
      bubbles: true,
      cancelable: true,
    }));
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
    _dispatchKey('r', 'KeyR', 'keydown');
    setTimeout(() => _dispatchKey('r', 'KeyR', 'keyup'), 120);
  }

  function _emitReplayStatus(state, frame) {
    if (replayMode !== 'replay') return;
    ipcRenderer.send('polytas:from-game', {
      type: 'REPLAY_STATUS',
      mode: replayMode,
      state,
      frame,
      totalFrames: replayInputs ? replayInputs.length : 0,
      gameFrame,
    });
  }

  function _maybeReportReplayProgress() {
    if (replayMode !== 'replay') return;
    if (replayFrame === replayLastReportedFrame) return;
    if (replayFrame !== 1 && replayFrame !== replayInputs.length && replayFrame % 30 !== 0) return;
    replayLastReportedFrame = replayFrame;
    _emitReplayStatus('running', replayFrame);
  }

  function _advanceReplayFrame() {
    if (!replayActive || replayStopped || !replayInputs) return;
    if (replayFrame < replayInputs.length) {
      _applyBitmask(replayInputs[replayFrame]);
      replayFrame++;
      _maybeReportReplayProgress();
      return;
    }
    _applyBitmask(0);
    replayActive = false;
    _clearReplayFallbackCheck();
    ipcRenderer.send('polytas:from-game', {
      type: 'REPLAY_DONE',
      frame: gameFrame,
      mode: replayMode || 'replay',
    });
    replayMode = null;
    replayDriver = 'game';
  }

  function _clearReplayFallbackCheck() {
    if (replayFallbackCheckTimer) clearTimeout(replayFallbackCheckTimer);
    replayFallbackCheckTimer = null;
    if (replayFallbackTimer) clearTimeout(replayFallbackTimer);
    replayFallbackTimer = null;
  }

  function _scheduleReplayFallbackCheck() {
    _clearReplayFallbackCheck();
    if (replayMode !== 'replay') return;
    replayFallbackCheckTimer = setTimeout(() => {
      replayFallbackCheckTimer = null;
      if (replayMode !== 'replay' || !replayActive || replayStopped) return;
      if (replayFrame > 0) return;
      replayDriver = 'fallback';
      _emitReplayStatus('fallback', replayFrame);
      _scheduleReplayFallbackLoop();
    }, 1000);
  }

  function _scheduleReplayFallbackLoop() {
    if (replayDriver !== 'fallback' || !replayActive || replayStopped) return;
    if (replayFallbackTimer) clearTimeout(replayFallbackTimer);
    replayFallbackTimer = setTimeout(() => {
      replayFallbackTimer = null;
      if (replayDriver !== 'fallback' || !replayActive || replayStopped) return;
      _advanceReplayFrame();
      _scheduleReplayFallbackLoop();
    }, Math.max(4, replayFrameDurationMs));
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
