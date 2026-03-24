# PolyTAS Extension - AI Agent Guide

## Purpose
PolyTAS is a Tool-Assisted Speedrun (TAS) editor for the PolyTrack browser game. The extension provides an editor UI to define per-frame inputs, record inputs from the game tab, and generate a replay script.

## Architecture Overview
- UI (editor): `polytas.html` + `polytas.js` implement the editor UI, recording, import/export, and script generation.
- Launcher: `launcher.html` + `launcher.js` provide a small page that opens the editor in a Document Picture-in-Picture window or a normal tab.
- Background: `service_worker.js` is the MV3 background worker that opens the launcher and injects the content script into the active tab.
- Content script: `content_capture.js` runs in the PolyTrack tab and forwards key events to the extension. It also contains replay and fast-forward helpers (not wired from the current UI).
- Modular sources: `src/` contains modular components (InputStore, Format, ScriptGen, Timeline, FrameGrid, ExtPort). As shipped, `polytas.html` loads only `polytas.js` and does not import `src/` modules.

## Key Files and Roles
- `polytas.html` - editor UI markup and styles.
- `polytas.js` - editor logic, recording, timeline rendering, frame grid, import/export (v2), script generation.
- `launcher.html` - launcher UI.
- `launcher.js` - opens PiP window or tab.
- `service_worker.js` - MV3 background, handles action click, injects `content_capture.js`, relays key events.
- `content_capture.js` - captures keydown/keyup in the game tab and forwards to the extension; patches requestAnimationFrame for tick and replay helpers.
- `src/bridge/ExtPort.js` - reconnecting wrapper for runtime port.
- `src/core/InputStore.js` - canonical segment storage with cached frame array and RLE helpers.
- `src/io/Format.js` - v3 JSON import/export schema (includes savestate and branch fields).
- `src/io/ScriptGen.js` - replay script generator (rAF-based delivery).
- `src/ui/Timeline.js` - zoomable timeline renderer.
- `src/ui/FrameGrid.js` - virtualized per-frame editor.

## TAS Data Model (Current UI)
- Segment: `{ id, start, end, keys, recorded? }`
- `start` is inclusive, `end` is exclusive (loops iterate `f < end`).
- `keys` is an array of `up|down|left|right`.
- Frame array: `Uint8Array(totalFrames)`, each frame is a bitmask.
- Bitmask mapping: `up=1`, `down=2`, `left=4`, `right=8`.
- Overlaps: when segments overlap, the frame array ORs key bits.

## Core Flows
- Attach to game: the UI sends `ATTACH_GAME` over a runtime port, the service worker injects `content_capture.js`, and key events are broadcast back to the UI.
- Recording: `polytas.js` samples held keys every `1000 / fps` ms, then run-length encodes frames into segments.
- Editing: segment editor creates ranges with key sets; frame grid toggles per-frame bits and merges adjacent segments.
- Replay script: `polytas.js` builds the frame array, RLE encodes it, and emits a self-contained IIFE that advances on requestAnimationFrame ticks.
- PiP: uses `documentPictureInPicture.requestWindow(...)` and loads `polytas.html?pip=1` in an iframe.

## Conventions, Assumptions, Constraints
- MV3 extension with `activeTab`, `scripting`, `tabs`.
- Key mapping supports Arrow keys and WASD.
- `totalFrames` and `fps` are user-configurable; defaults are 3600 and 60.
- Document PiP is required for the PiP window; availability depends on the Chrome build.
- `content_capture.js` includes handlers for `REPLAY_INJECT`, `FAST_FORWARD`, and `GET_GAME_STATE`. No caller is present in `polytas.js` or `service_worker.js` (unknown wiring).
- `src/io/Format.js` defines a v3 format with savestates and branches. No UI code in `polytas.js` reads or writes this format (unknown status).

## Safe Modification Checklist
- Keep the bitmask mapping consistent across `polytas.js`, `content_capture.js`, `src/core/InputStore.js`, `src/io/ScriptGen.js`, and `src/io/Format.js`.
- If you change segment shape or rules, update `polytas.js` import/export and script generation, plus any future use of `Format` or `ScriptGen`.
- If you add new message types, update `service_worker.js` routing and the UI or content handlers.
- If you refactor toward `src/` modules, ensure the entrypoints actually import them. Today the editor runs from `polytas.js` without a bundler.

## Unknowns
- Savestate manager, branch editor, and verification flow are referenced in `src/io/Format.js` but are not implemented in the extension UI as of current code.
