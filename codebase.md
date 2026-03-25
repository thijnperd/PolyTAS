# PolyTAS Desktop - Codebase Reference

## Overview

PolyTAS Desktop is an Electron app that embeds the PolyTrack game and drives replay by injecting keyboard events from inside the game view. Replay is frame-locked to game updates when possible, with an automatic timer fallback when the game-frame hook does not advance.

The current UI replay path is script/injected replay (`REPLAY_INJECT`), not OS keyboard automation.

---

## File Structure

```
desktop/
├── main/
│   ├── main.js          - Electron main process: window, BrowserView, IPC bridge
│   ├── preload.js       - Context bridge exposing PolyTASDesktop API to renderer
│   └── game-preload.js  - Injected into game BrowserView; capture + replay runtime
├── renderer/
│   ├── index.html       - Editor shell + game panel UI
│   ├── polytas.js       - Editor logic, recording, replay commands, status handling
│   └── styles.css       - Editor styles
└── package.json
```

Legacy extension code is kept under `extension/` for reference and older workflows.

---

## Process Architecture

PolyTAS Desktop uses three runtime contexts:

| Context | File | Purpose |
|---|---|---|
| Main process | `desktop/main/main.js` | Creates window + BrowserView, routes IPC |
| Editor renderer | `desktop/renderer/index.html` + `polytas.js` | UI, timeline/editor, replay commands |
| Game BrowserView | external game URL + `game-preload.js` | Key capture, replay injection, frame hooks |

The renderer does not call Node APIs directly. It only talks through `window.PolyTASDesktop` from `desktop/main/preload.js`.

---

## Replay Model

### Input representation

Replay data is a per-frame bitmask stream:

- `up=1`
- `down=2`
- `left=4`
- `right=8`

The editor builds a `Uint8Array(totalFrames)` from segments, then RLE-compresses it (`[[value,count], ...]`) before sending to the game preload.

### Script replay (`REPLAY_INJECT`)

1. Renderer sends `REPLAY_INJECT` with `rle`, `totalFrames`, and `fps`.
2. `game-preload.js` decodes RLE into `replayInputs`.
3. Replay starts by issuing synthetic `r` key restart.
4. On each step, preload diffs current and next bitmask and dispatches only changed key transitions (`keydown`/`keyup`).
5. On completion or stop, preload releases all keys by applying bitmask `0`.

### Primary stepping and fallback

`game-preload.js` first tries to step replay from the patched `window.requestAnimationFrame` path. If replay frame `0` still has not advanced after 1 second, it emits replay status `fallback` and switches to timer stepping at the requested TAS FPS.

This avoids the "stuck on restarting" failure mode when the game does not progress through the expected frame hook.

---

## Replay Status in UI

Renderer listens for `REPLAY_STATUS` and `REPLAY_DONE` from game preload and updates the Game Preview status line.

Typical states:

- `Replay command sent. Waiting for game frames...`
- `Replay restarting the run...`
- `No game-frame hook detected. Using timer-based replay fallback...`
- `Replay advancing: fX/Y (...)`
- `Replay complete.`
- `Replay stopped.`

Status UI nodes:

- `#gameStatus` (general game state)
- `#replayStatus` (replay-specific state)

---

## Recording and Capture

### Capture channels

There are two key event paths from the game view:

1. `game-preload.js` capture listeners (`keydown`/`keyup`, capture phase).
2. Main process `before-input-event` fallback from BrowserView webContents.

### Synthetic-event guard

Replay-generated events are synthetic. Capture now filters with `event.isTrusted` before forwarding key events. This prevents replay from feeding back into recording and causing rerecord loops.

---

## Key Dispatch Strategy

Replay dispatch target is:

1. focused element (`document.activeElement`) when present and meaningful
2. otherwise `document`

This increases compatibility with games that read key events from focused elements instead of only global document listeners.

---

## IPC Channels

| Channel | Direction | Description |
|---|---|---|
| `polytas:editor-message` | renderer -> main | Commands such as `ATTACH_GAME`, `PREVIEW`, `REPLAY_INJECT`, `REPLAY_STOP` |
| `polytas:game-event` | main -> renderer | Relayed game/capture/replay events |
| `polytas:from-game` | game-preload -> main | `KEY_DOWN`, `KEY_UP`, `GAME_TICK`, `REPLAY_STATUS`, `REPLAY_DONE`, etc. |
| `polytas:to-game` | main -> game-preload | Replay/control messages forwarded from renderer |
| `polytas:set-game-bounds` | renderer -> main | BrowserView bounds updates |
| `polytas:get-game-url` | renderer <-> main (invoke) | Read saved game URL |
| `polytas:set-game-url` | renderer <-> main (invoke) | Save + load game URL |
| `polytas:run-script` | renderer <-> main (invoke) | Execute JavaScript in game view |
| `polytas:copy-text` | renderer <-> main (invoke) | Clipboard copy helper |

---

## Data Model

Segments in renderer:

```js
{ id, start, end, keys, recorded? }
```

- `start` inclusive
- `end` exclusive
- `keys` is array of `up|down|left|right`
- overlapping segments are OR-merged into frame bitmasks

---

## Live Preview

Live preview is debounced (`160ms`) and sends `PREVIEW` with full RLE plus target frame. The preload replays from frame `0` and fast-forwards toward the target so state is derived from full input history.

Live preview is blocked while recording or replay is active to avoid conflicting restarts.

---

## Config Persistence

Game URL is stored in:

- `path.join(app.getPath('userData'), 'config.json')`

Loaded at startup and saved when the URL is updated in the UI.

---

## Debugging Checklist (Replay)

If replay appears stuck:

1. Confirm `#replayStatus` changes beyond `restarting`.
2. If status enters fallback and frame counter advances, injection loop is alive and game input consumption is the next suspect.
3. If status never enters fallback or running, verify preload injection happened in the active game view.
4. Confirm recording is stopped before replay.
5. Confirm game tab/view has focus and is not paused/background-throttled.
