# PolyTAS Desktop

Electron desktop app for PolyTAS with an embedded game view and frame-locked replay injection.

## Run (dev)
```bash
cd desktop
npm install
npm run dev
```

## Notes
- Set the game URL in the right-side Game Preview panel.
- Use RUN REPLAY to inject frame-by-frame inputs into the embedded game.
- Watch the replay status line in the Game Preview panel for `Replay restarting the run...`.
- During active replay it should show `Replay advancing: fX/Y (...)`.
- On success it should end at `Replay complete.`.
- If the game frame hook does not advance, replay auto-switches to a timer-based fallback and continues.
