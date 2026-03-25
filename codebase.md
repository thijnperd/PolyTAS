# PolyTAS Desktop — Codebase Reference

## Overview

The desktop build is an Electron application that wraps the PolyTAS editor UI and embeds the PolyTrack game in the same window. It provides two replay modes: a **script-based in-page replay** that injects synthetic key events directly into the game's JavaScript runtime, and an **OS-level replay** that drives the system keyboard via `@nut-tree-fork/nut-js` so inputs look physical to the game engine.

---

## File Structure

```
desktop/
├── main/
│   ├── main.js          — Electron main process: window, BrowserView, IPC, nut-js
│   ├── preload.js       — Context bridge exposing PolyTASDesktop API to renderer
│   └── game-preload.js  — Injected into the game BrowserView; patches rAF and key capture
├── renderer/
│   ├── index.html       — Editor shell
│   ├── polytas.js       — Editor UI logic (segments, recording, timeline, replay)
│   └── styles.css       — Editor styles
└── package.json
```

---

## Process Architecture

Electron separates code into a **main process** (Node.js) and one or more **renderer processes** (browser contexts). PolyTAS uses three distinct browser contexts:

| Context | File | Sandbox |
|---|---|---|
| Main process | `main/main.js` | Full Node.js |
| Editor renderer | `renderer/index.html` + `polytas.js` | Sandboxed, context-isolated |
| Game BrowserView | external URL | Sandboxed, context-isolated off |

The editor renderer cannot call Node APIs directly. It communicates with the main process exclusively through the context bridge defined in `preload.js`. The game view gets its own preload (`game-preload.js`) which has access to `ipcRenderer` so it can relay events back and forth.

---

## Game Integration

### BrowserView

The game runs inside a `BrowserView` — a Chromium view that the main process attaches to the main `BrowserWindow`. It sits at a pixel-aligned bounding rect that the editor renderer calculates and sends over IPC whenever the window resizes.

```js
// main.js — creating the game view
gameView = new BrowserView({
  webPreferences: {
    preload: path.join(__dirname, 'game-preload.js'),
    contextIsolation: false,  // game-preload needs direct ipcRenderer access
    sandbox: true,
    backgroundThrottling: false,
  },
});
mainWindow.setBrowserView(gameView);
```

`backgroundThrottling` is disabled on both the main window and the game view because Electron throttles `requestAnimationFrame` and timer callbacks in background tabs — that would silently break frame-accurate timing.

The bounds are kept in sync by the renderer sending `polytas:set-game-bounds` messages whenever the game viewport element's layout changes, using a `ResizeObserver` and a 50 ms debounce timer.

### game-preload.js

This script is injected into the game BrowserView before any game code runs. It installs a thin shim on `window.requestAnimationFrame` and a pair of `keydown`/`keyup` listeners on `window`, then opens a port back to the main process via `ipcRenderer`.

Everything it does has to survive next to whatever the game itself does to the DOM — which is why it guards against double-installation with `window.__polytasCaptureInstalled`.

---

## Key Capture (Recording)

When the user clicks **CONNECT GAME** in the editor, the renderer sends an `ATTACH_GAME` IPC message. The main process forwards a `SET_CAPTURE` message into the game view, which tells the game-preload to enable its key listeners.

Two parallel capture paths exist:

**Path 1 — game view key capture (`game-preload.js`):**

```js
window.addEventListener('keydown', e => {
  if (!captureEnabled) return;
  ipcRenderer.send('polytas:from-game', { type: 'KEY_DOWN', key: e.key, code: e.code, ... });
}, true);
window.addEventListener('keyup', e => sendKey('KEY_UP', e), true);
```

The listener is registered with `capture: true` (third argument) so it fires before the game can swallow the event. The event data is serialised and sent to the main process, which relays it to the editor renderer as a `polytas:game-event` IPC message.

**Path 2 — `before-input-event` on the game view (`main.js`):**

```js
gameView.webContents.on('before-input-event', (_event, input) => {
  if (input.type !== 'keyDown' && input.type !== 'keyUp') return;
  sendToRenderer({ type: input.type === 'keyDown' ? 'KEY_DOWN' : 'KEY_UP', key: input.key, ... });
});
```

This fires at the Chromium level before the event even enters the renderer. It acts as a fallback for key events that happen when the game view is focused but the preload's listener might not yet have run.

In the editor renderer, `handleKeyDown` and `handleKeyUp` receive those events and update `recordHeldKeys` (a bitmask). A drift-compensating `setTimeout` loop samples `recordHeldKeys` once per frame at `1000 / fps` ms intervals, accumulating the raw bitmask into `recordedFrames[]`. When recording stops, `rleToSegments` compresses consecutive identical bitmasks into segments.

---

## Key Replay

There are two fundamentally different replay strategies, chosen depending on whether the user runs the native OS replay or the in-page script replay.

### In-page Replay (via game-preload)

When the editor sends a `PREVIEW` or `REPLAY_INJECT` message, `game-preload.js` decodes the RLE payload into a `Uint8Array`, stores it in `replayInputs`, and sets `replayActive = true`. The rAF shim then fires on every animation frame:

```js
window.requestAnimationFrame = function (cb) {
  return _origRAF(function (ts) {
    gameFrame++;

    if (replayActive && replayFrame < replayInputs.length) {
      _applyBitmask(replayInputs[replayFrame]);
      replayFrame++;
    }

    cb(ts);  // original game callback runs after inputs are applied
  });
};
```

`_applyBitmask` diffs the currently held bitmask against the new one, dispatches `keydown`/`keyup` `KeyboardEvent`s to `document` for every changed bit, and updates `_curBits`. Both Arrow keys and WASD equivalents are dispatched simultaneously for each direction so the game accepts whichever mapping it uses.

```js
const KM = {
  up:    [{ key: 'ArrowUp', code: 'ArrowUp' }, { key: 'w', code: 'KeyW' }],
  // ...
};

function _dispatchKey(key, code, type) {
  document.dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true, cancelable: true }));
}
```

Before the first replay frame, `_restartGame` dispatches a synthetic `r`/`KeyR` keydown+keyup to reset the run. Because this replay lives inside the game's own JS thread and fires synchronously before the game's rAF callback, timing is exact to the frame — no OS scheduler jitter.

### OS-level Replay (via nut-js)

For the **RUN REPLAY** button, the renderer calls `window.PolyTASDesktop.startOsReplay(payload)`, which goes over IPC to `main.js`. This path exists because injecting keys via the game preload can interfere with live-preview restarts, and it provides a mode that behaves identically to a human playing.

`ensureNut()` dynamically imports `@nut-tree-fork/nut-js` the first time it's needed (lazy import because nut-js has native binaries and takes a moment to load). It sets `keyboard.config.autoDelayMs = 0` to eliminate nut's built-in inter-key delay.

The replay is driven by a drift-compensating `setTimeout` scheduler — the same technique used in recording:

```js
function scheduleOsReplayTick(frameDuration, replayStartTime) {
  const expectedTime = replayStartTime + osReplayFrame * frameDuration;
  const delay = Math.max(0, expectedTime - Date.now());

  osReplayTimer = setTimeout(() => {
    const nb = osReplayInputs[osReplayFrame];
    osReplayTickInFlight = applyBitmaskOs(nb);
    osReplayTickInFlight.then(() => {
      osReplayFrame++;
      if (osReplayFrame < osReplayInputs.length) {
        scheduleOsReplayTick(frameDuration, replayStartTime);
      } else {
        stopOsReplay();
      }
    });
  }, delay);
}
```

`applyBitmaskOs` translates bitmask changes into `nutKeyboard.pressKey` / `nutKeyboard.releaseKey` calls. All changed keys for a single frame are fired in parallel via `Promise.all` to avoid compounding latency across multiple simultaneous key changes:

```js
async function applyBitmaskOs(nb) {
  const changed = osReplayBits ^ nb;
  const ops = [];
  for (const item of BIT_KEYS) {
    if (!(changed & item.bit)) continue;
    const key = nutKey[KEY_MAP[item.name]];
    ops.push(nb & item.bit ? nutKeyboard.pressKey(key) : nutKeyboard.releaseKey(key));
  }
  await Promise.all(ops);
  osReplayBits = nb;
}
```

Before the first frame, `beginOsReplay` taps the `R` key (physical press via nut-js) and waits 700 ms for the game to reset, then records `replayStartTime = Date.now()` as the anchor for all subsequent drift compensation.

Stopping is careful about race conditions: `stopOsReplay` waits for any in-flight tick promise (`osReplayTickInFlight`) to resolve before calling `releaseAllOsKeys`, preventing the stuck-key scenario where a `pressKey` is mid-await when the release happens.

---

## IPC Channel Reference

| Channel | Direction | Description |
|---|---|---|
| `polytas:editor-message` | renderer → main | Editor commands (`ATTACH_GAME`, `PREVIEW`, `REPLAY_STOP`, etc.) |
| `polytas:game-event` | main → renderer | Key events and status updates from the game view |
| `polytas:from-game` | game-preload → main | Key events, `GAME_TICK`, `REPLAY_DONE`, etc. |
| `polytas:to-game` | main → game-preload | Replay commands forwarded from the editor |
| `polytas:set-game-bounds` | renderer → main | Pixel-aligned bounds for the BrowserView |
| `polytas:get-game-url` (invoke) | renderer ↔ main | Read stored game URL |
| `polytas:set-game-url` (invoke) | renderer ↔ main | Persist and load a new game URL |
| `polytas:run-script` (invoke) | renderer ↔ main | Execute arbitrary JS in the game view |
| `polytas:os-replay-start` (invoke) | renderer ↔ main | Start nut-js OS replay with RLE payload |
| `polytas:os-replay-stop` (invoke) | renderer ↔ main | Stop OS replay and release all keys |
| `polytas:copy-text` (invoke) | renderer ↔ main | Write text to system clipboard |

---

## Key/Bitmask Mapping

All three contexts (main process, game-preload, and renderer) share the same bitmask convention:

| Bit | Direction |
|---|---|
| 1 | Up |
| 2 | Down |
| 4 | Left |
| 8 | Right |

In `main.js` the mapping from logical name to nut-js `Key` enum is:

```js
const KEY_MAP = { up: 'Up', down: 'Down', left: 'Left', right: 'Right' };
```

In `game-preload.js` each direction maps to both Arrow and WASD variants so whichever the game listens to gets hit.

---

## Config Persistence

The game URL is saved to `config.json` in Electron's `userData` directory (`app.getPath('userData')`). On startup `loadConfig()` reads it; `saveConfig()` writes it whenever the user sets a new URL. The file is not committed to the repo.

---

## Live Preview

When the user edits segments, `scheduleLivePreview(frame)` debounces 160 ms and then sends a `PREVIEW` message to the game view containing the full RLE-encoded frame array and a `targetFrame`. The game-preload handles this identically to a full replay but the frame counter is used to fast-forward to `targetFrame` while still applying all input history — giving the user a real-time preview of the game state at any point in the TAS without manually scrubbing. Live preview is suppressed while an OS replay is active to avoid conflicting `_restartGame` calls.
