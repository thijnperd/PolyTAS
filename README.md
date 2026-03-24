# PolyTAS

Tool-assisted speedrun editor for the PolyTrack browser game.

## Overview
PolyTAS is a Chrome MV3 extension that provides an input editor for PolyTrack. It supports per-frame editing, live recording from the game tab, and replay script generation.

## Features
- Editor UI with timeline, segment list, and frame grid.
- Record live inputs from the game tab (Ctrl+Shift+.).
- Import and export runs as JSON (version 2).
- Generate a replay script for the browser console.
- Picture-in-Picture editor window overlay.

## Installation
1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and select `PolyTAS/extension`.
4. The PolyTAS icon will appear in the toolbar.

## Usage
1. Open PolyTrack in a tab.
2. Click the PolyTAS icon to open the launcher.
3. Choose Open PiP Window or Open in Tab.
4. In the editor, click ATTACH GAME with the PolyTrack tab active.
5. Use REC or Ctrl+Shift+. to record, or add segments manually.
6. Use COPY SCRIPT to copy a replay script and paste it into the PolyTrack console (F12 then Console).
7. Use IMPORT or EXPORT to save or load runs.

## Technical Notes
- The editor runs from `extension/polytas.html` and `extension/polytas.js`.
- The service worker `extension/service_worker.js` injects `extension/content_capture.js` into the active game tab to capture key events.
- Inputs are stored as segments with `start` (inclusive) and `end` (exclusive) frame ranges and `up|down|left|right` keys.
- Frames are encoded as bitmasks (up=1, down=2, left=4, right=8) and RLE-compressed for scripts.
- Picture-in-Picture uses the Document PiP API; if it is unavailable, open the editor in a normal tab.

## Contributing
- No CONTRIBUTING.md is present in this repo.
- Keep bitmask mappings and key names consistent across UI, content script, and script generation.
- If you change the data format, update both import/export and script generation.
- Test attach, record, edit, and replay flows manually in Chrome.

## Standalone Version
The `standalone/` folder contains the original single-page HTML editor. It is kept for reference and does not use a real PiP window.
