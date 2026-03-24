/**
 * SavestateManager — savestate and branch management.
 *
 * Savestates are point-in-time snapshots of the input data at a given frame.
 * They are stored in memory and serialized into the v3 export format.
 *
 * Branches are alternate TAS timelines that diverge from a common ancestor
 * savestate. The active branch has its own InputStore snapshot.
 */
export class SavestateManager {
  constructor(store, undoManager) {
    this._store      = store;
    this._undo       = undoManager;
    this._states     = [];   // [{id, label, frame, snapshot, branchId, createdAt}]
    this._branches   = [];   // [{id, label, parentBranchId, parentFrame, snapshot}]
    this._activeBranchId = 'main';
    this.onChange    = null; // () => void
    this._idCounter  = 1;

    // create default main branch
    this._branches.push({
      id:             'main',
      label:          'Main line',
      parentBranchId: null,
      parentFrame:    0,
    });
  }

  // ── Savestates ────────────────────────────────────────────────────────────

  /** Create a savestate at the given frame number. */
  create(frame, label = '') {
    const id = 'ss-' + (this._idCounter++);
    const ss = {
      id,
      label:      label || `Frame ${frame}`,
      frame,
      snapshot:   this._store._snapshot(),
      branchId:   this._activeBranchId,
      createdAt:  new Date().toISOString(),
    };
    this._states.push(ss);
    this._notify();
    return ss;
  }

  /** Load a savestate: restore input snapshot and return ss object. */
  load(id) {
    const ss = this._states.find(s => s.id === id);
    if (!ss) return null;
    const prevSnap = this._store._snapshot();
    this._undo.execute({
      label: `Load savestate "${ss.label}"`,
      apply: () => this._store.restoreSnapshot(ss.snapshot),
      undo:  () => this._store.restoreSnapshot(prevSnap),
    });
    this._notify();
    return ss;
  }

  delete(id) {
    const idx = this._states.findIndex(s => s.id === id);
    if (idx === -1) return false;
    this._states.splice(idx, 1);
    this._notify();
    return true;
  }

  updateLabel(id, label) {
    const ss = this._states.find(s => s.id === id);
    if (!ss) return false;
    ss.label = label;
    this._notify();
    return true;
  }

  getSavestates() { return [...this._states]; }

  // ── Branches ──────────────────────────────────────────────────────────────

  createBranch(label, fromSavestateId = null) {
    const id     = 'branch-' + (this._idCounter++);
    let   parentFrame = 0;
    let   parentBranchId = this._activeBranchId;
    let   snapshot = this._store._snapshot();

    if (fromSavestateId) {
      const ss = this._states.find(s => s.id === fromSavestateId);
      if (ss) {
        parentFrame    = ss.frame;
        parentBranchId = ss.branchId;
        snapshot       = ss.snapshot;
      }
    }

    const branch = { id, label, parentBranchId, parentFrame, snapshot };
    this._branches.push(branch);
    this._notify();
    return branch;
  }

  switchBranch(id) {
    const branch = this._branches.find(b => b.id === id);
    if (!branch) return false;
    const prevSnap = this._store._snapshot();
    this._undo.execute({
      label: `Switch to branch "${branch.label}"`,
      apply: () => {
        this._activeBranchId = id;
        this._store.restoreSnapshot(branch.snapshot);
      },
      undo: () => {
        this._activeBranchId = this._activeBranchId; // best effort
        this._store.restoreSnapshot(prevSnap);
      },
    });
    this._notify();
    return true;
  }

  /** Save current store state into the active branch (call before switching). */
  commitActiveBranch() {
    const branch = this._branches.find(b => b.id === this._activeBranchId);
    if (branch) branch.snapshot = this._store._snapshot();
  }

  getBranches()      { return [...this._branches]; }
  getActiveBranchId() { return this._activeBranchId; }

  // ── Serialization ─────────────────────────────────────────────────────────

  toJSON() {
    return {
      states:         this._states,
      branches:       this._branches,
      activeBranchId: this._activeBranchId,
      idCounter:      this._idCounter,
    };
  }

  static fromJSON(obj, store, undoManager) {
    const sm               = new SavestateManager(store, undoManager);
    sm._states             = obj.states   || [];
    sm._branches           = obj.branches || [{ id: 'main', label: 'Main line', parentBranchId: null, parentFrame: 0 }];
    sm._activeBranchId     = obj.activeBranchId || 'main';
    sm._idCounter          = obj.idCounter || 1;
    return sm;
  }

  _notify() { if (this.onChange) this.onChange(); }
}
