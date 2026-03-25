# PolyTAS

Tool-assisted speedrun editor for the PolyTrack browser game.

## Overview
PolyTAS is an Electron desktop app with an embedded game view, frame-by-frame input editing, and frame-locked replay injection.

## Features
- Editor UI with timeline, segment list, and frame grid.
- Record live inputs from the embedded game (Ctrl+Shift+.).
- Import and export runs as JSON (version 2).
- Replay inputs directly inside the embedded game view with injected script events.
- Live preview for splices and edits.
- Replay status line in the game panel (`idle`, `restarting`, `running`, `done`, `stopped`).

## Run (Desktop)
```bash
cd desktop
npm install
npm run dev
```

## Usage (Desktop)
1. Open the app.
2. Set the game URL in the Game Preview panel.
3. Click SET URL, then CONNECT GAME.
4. Edit segments or record (REC or Ctrl+Shift+.).
5. Use RUN REPLAY to start injected replay.
6. Live Preview updates automatically while you edit.

## Technical Notes
- The desktop app lives in `desktop/`.
- The editor renderer uses `desktop/renderer/index.html` and `desktop/renderer/polytas.js`.
- The embedded game view is driven by Electron `BrowserView` and a preload replay bridge.
- Inputs are stored as segments with `start` (inclusive) and `end` (exclusive) frame ranges and `up|down|left|right` keys.
- Frames are encoded as bitmasks (up=1, down=2, left=4, right=8) and RLE-compressed for replay.
- Replay is driven in `desktop/main/game-preload.js` by applying one frame of bitmask input per tick.
- Synthetic replay key events are filtered from capture with `event.isTrusted` to avoid replay-rerecord loops.

## Legacy
The `extension/` folder contains the original Chrome MV3 extension and is kept for reference.
