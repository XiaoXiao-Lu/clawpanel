/**
 * Hermes Panel State Bus — centralized per-panel loading/saving/error state.
 *
 * All config panels register themselves on mount. The page queries the bus to
 * decide whether the "Save All" button should be disabled (any panel saving?),
 * show global loading spinners, or surface per-panel error banners.
 *
 * Usage:
 *   import { panelStateBus } from './panel-state-bus.js'
 *   panelStateBus.register('runtime', { loading: true })
 *   panelStateBus.setLoading('runtime', false)
 *   panelStateBus.setError('runtime', 'Network timeout')
 */

export class PanelStateBus {
  constructor() {
    /** @private @type {Map<string, { id: string, loading: boolean, saving: boolean, error: (string|null) }>} */
    this._states = new Map()
  }

  /**
   * Register a panel. Safe to call multiple times (subsequent calls update
   * only the provided fields).
   * @param {string} id
   * @param {{ loading?: boolean, saving?: boolean, error?: (string|null) }} [opts]
   */
  register(id, { loading = true, saving = false, error = null } = {}) {
    const existing = this._states.get(id)
    if (existing) {
      existing.loading = loading
      existing.saving = saving
      existing.error = error
    } else {
      this._states.set(id, { id, loading, saving, error })
    }
  }

  /**
   * @param {string} id
   * @param {boolean} value
   */
  setLoading(id, value) {
    if (this._states.has(id)) this._states.get(id).loading = value
  }

  /**
   * @param {string} id
   * @param {boolean} value
   */
  setSaving(id, value) {
    if (this._states.has(id)) this._states.get(id).saving = value
  }

  /**
   * @param {string} id
   * @param {(string|null)} error
   */
  setError(id, error) {
    if (this._states.has(id)) this._states.get(id).error = error
  }

  /**
   * Returns true if any registered panel is currently saving.
   * @returns {boolean}
   */
  isAnySaving() {
    for (const s of this._states.values()) {
      if (s.saving) return true
    }
    return false
  }

  /**
   * Returns true if any registered panel is currently loading.
   * @returns {boolean}
   */
  isAnyLoading() {
    for (const s of this._states.values()) {
      if (s.loading) return true
    }
    return false
  }

  /**
   * Returns true if the panel is busy (loading or saving).
   * @param {string} id
   * @returns {boolean}
   */
  isPanelBusy(id) {
    const s = this._states.get(id)
    return s ? (s.loading || s.saving) : false
  }

  /**
   * Get the full state object for a panel, or null if unregistered.
   * @param {string} id
   * @returns {{ id: string, loading: boolean, saving: boolean, error: (string|null) } | null}
   */
  getState(id) {
    return this._states.get(id) || null
  }

  /** Clear all registered panel states. */
  reset() {
    this._states.clear()
  }
}

/** Singleton instance shared across the Hermes config page. */
export const panelStateBus = new PanelStateBus()
