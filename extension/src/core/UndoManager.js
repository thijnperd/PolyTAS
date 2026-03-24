/**
 * UndoManager — command-pattern undo/redo stack.
 * Every mutation that should be undoable is wrapped in a Command:
 *   { label: string, apply: () => void, undo: () => void }
 * The manager calls apply() immediately and pushes to the undo stack.
 */
export class UndoManager {
  constructor({ maxDepth = 200 } = {}) {
    this._undoStack = [];
    this._redoStack = [];
    this._maxDepth  = maxDepth;
    this.onChange   = null; // callback(canUndo, canRedo)
  }

  /** Execute a command immediately and push to undo stack. */
  execute(cmd) {
    cmd.apply();
    this._undoStack.push(cmd);
    if (this._undoStack.length > this._maxDepth) {
      this._undoStack.shift();
    }
    this._redoStack = [];
    this._notify();
  }

  /** Undo the most recent command. */
  undo() {
    const cmd = this._undoStack.pop();
    if (!cmd) return null;
    cmd.undo();
    this._redoStack.push(cmd);
    this._notify();
    return cmd.label;
  }

  /** Redo the most recently undone command. */
  redo() {
    const cmd = this._redoStack.pop();
    if (!cmd) return null;
    cmd.apply();
    this._undoStack.push(cmd);
    this._notify();
    return cmd.label;
  }

  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }
  undoLabel() { return this._undoStack.length ? this._undoStack[this._undoStack.length - 1].label : null; }
  redoLabel() { return this._redoStack.length ? this._redoStack[this._redoStack.length - 1].label : null; }

  /** Clear all history (e.g. after loading a new file). */
  clear() {
    this._undoStack = [];
    this._redoStack = [];
    this._notify();
  }

  _notify() {
    if (this.onChange) this.onChange(this.canUndo(), this.canRedo());
  }
}
