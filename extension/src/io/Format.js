/**
 * Format — v3 JSON import/export for PolyTAS runs.
 *
 * v3 format:
 * {
 *   polytas: 3,
 *   meta:    { track, author, date, gameVersion, attempt, note },
 *   config:  { fps, totalFrames, keyMap },
 *   inputs:  { encoding: "rle-bitmask", data: [[value,count],...] },
 *   savestates: [...],
 *   branches:   [...],
 *   verification: { inputHash, finalPosition, finalVelocity }
 * }
 */
import { InputStore } from '../core/InputStore.js';

export class Format {
  /**
   * Serialize full app state to v3 JSON object.
   * @param {InputStore} store
   * @param {SavestateManager} savestateManager
   * @param {object} config  — { fps, totalFrames, meta }
   */
  static serialize(store, savestateManager, config = {}) {
    const arr = store.getFrameArray();
    const rle = InputStore.rleEncode(arr);

    const obj = {
      polytas: 3,
      meta: {
        track:       config.meta?.track       || '',
        author:      config.meta?.author      || '',
        date:        new Date().toISOString(),
        gameVersion: config.meta?.gameVersion || '',
        attempt:     config.meta?.attempt     || 1,
        note:        config.meta?.note        || '',
        finalFrame:  store.getSegments().length
          ? Math.max(...store.getSegments().map(s => s.end))
          : 0,
      },
      config: {
        fps:         config.fps         || 60,
        totalFrames: config.totalFrames || store.totalFrames,
        keyMap:      { up: 1, down: 2, left: 4, right: 8 },
      },
      inputs: {
        encoding: 'rle-bitmask',
        data:     rle,
      },
    };

    if (savestateManager) {
      const ssData = savestateManager.toJSON();
      obj.savestates = ssData.states;
      obj.branches   = ssData.branches;
      obj.activeBranchId = ssData.activeBranchId;
    }

    return obj;
  }

  /**
   * Deserialize a v3 (or v2/v1) JSON object back into store state.
   * Returns { segments, fps, totalFrames, meta, savestates, branches, activeBranchId }
   */
  static deserialize(obj) {
    const version = obj.polytas || obj.version || 1;

    // ── v3 ──
    if (version === 3) {
      const rle     = obj.inputs?.data || [];
      const tf      = obj.config?.totalFrames || 3600;
      const arr     = InputStore.rleDecode(rle, tf);
      const { segs } = InputStore.frameArrayToSegments(arr);
      return {
        segments:      segs,
        fps:           obj.config?.fps || 60,
        totalFrames:   tf,
        meta:          obj.meta || {},
        savestates:    obj.savestates || [],
        branches:      obj.branches   || [],
        activeBranchId: obj.activeBranchId || 'main',
      };
    }

    // ── v2 / v1 (legacy segment-array format) ──
    const segs = (obj.segments || []).map((s, i) => ({
      id:       i + 1,
      start:    s.start,
      end:      s.end,
      keys:     s.keys || [],
      recorded: !!s.recorded,
    }));
    return {
      segments:   segs,
      fps:        obj.fps        || 60,
      totalFrames: obj.totalFrames || 3600,
      meta:       {},
      savestates: [],
      branches:   [],
      activeBranchId: 'main',
    };
  }

  /** Compute a short fingerprint of the RLE data for verification. */
  static async hashInputs(rle) {
    const str  = JSON.stringify(rle);
    const buf  = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    const hex  = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return 'sha256:' + hex.slice(0, 16);
  }
}
