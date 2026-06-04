/**
 * Hermes Agent — Memory editor (three-column: tabs | editor | preview)
 *
 * Data contract:
 *   GET  /api/hermes/memory            → { memory, user, soul, mtimes }
 *   POST /api/hermes/memory            → { section, content }
 *
 * ClawPanel calls Rust/Web commands so the page works on Tauri and Web modes.
 *
 * All three files live in `~/.hermes/memories/` and are plain Markdown.
 *
 * Draft autosave: 3 s debounce → localStorage under `hm-mem-draft:{key}`.
 */
import { t } from '../../../lib/i18n.js'
import { api } from '../../../lib/tauri-api.js'
import { toast } from '../../../components/toast.js'
import { showContentModal, showConfirm } from '../../../components/modal.js'
import { humanizeError } from '../../../lib/humanize-error.js'
import { renderMarkdown } from '../lib/markdown-renderer.js'

function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ---- icons ----
const ICONS = {
  memory: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>',
  user:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  soul:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 2a10 10 0 100 20 10 10 0 000-20z"/><path d="M12 6v6l4 2"/></svg>',
  edit:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  save:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>',
  trash:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>',
}

// ---- draft autosave constants ----
const DRAFT_STORAGE_PREFIX = 'hm-mem-draft:'
const AUTOSAVE_DELAY = 3000

/** Format epoch-seconds → relative/short local time (serif-friendly). */
function fmtMtime(epoch) {
  if (!epoch) return ''
  const now = Date.now() / 1000
  const diff = now - epoch
  if (diff < 60) return t('engine.memoryJustNow')
  if (diff < 3600) return t('engine.memoryMinAgo').replace('{n}', Math.floor(diff / 60))
  if (diff < 86400) return t('engine.memoryHrAgo').replace('{n}', Math.floor(diff / 3600))
  const d = new Date(epoch * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Rough word + char count. CJK counted per character. */
function contentStats(text) {
  const t = text || ''
  const chars = t.length
  // Split on whitespace OR CJK character boundary
  const words = (t.match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+/g) || []).length
  return { chars, words }
}

export function render() {
  const el = document.createElement('div')
  el.className = 'hermes-memory-page'
  el.dataset.engine = 'hermes'

  // --- State ---
  const SECTIONS = [
    { key: 'memory', titleKey: 'engine.memoryNotes',   icon: ICONS.memory, descKey: 'engine.memoryNotesDesc'   },
    { key: 'user',   titleKey: 'engine.memoryProfile', icon: ICONS.user,   descKey: 'engine.memoryProfileDesc' },
    { key: 'soul',   titleKey: 'engine.memorySoul',    icon: ICONS.soul,   descKey: 'engine.memorySoulDesc'    },
  ]
  const data = { memory: '', user: '', soul: '' }
  const mtimes = { memory: null, user: null, soul: null }
  const lastSaved = { memory: '', user: '', soul: '' }
  let activeTab = 'memory'
  let editorDirty = false
  let loading = true
  let saving = false
  let loadError = null
  let autosaveTimer = null

  // ---- draft helpers ----

  /** Build localStorage key for a section draft. */
  function getDraftKey(key) {
    return DRAFT_STORAGE_PREFIX + key
  }

  /** Check whether a draft exists for the given section key. */
  function hasDraft(key) {
    return localStorage.getItem(getDraftKey(key)) !== null
  }

  /** Read a draft (returns null if none). */
  function getDraft(key) {
    return localStorage.getItem(getDraftKey(key))
  }

  /** Silently persist current content as a draft. */
  function autosaveDraft(key, value) {
    try {
      localStorage.setItem(getDraftKey(key), value)
    } catch { /* quota exceeded — silently ignore */ }
  }

  /** Remove a draft from localStorage and reset the timer. */
  function clearDraft(key) {
    localStorage.removeItem(getDraftKey(key))
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null }
    updateClearDraftButton()
  }

  // ---- UI update helpers ----

  function updateClearDraftButton() {
    const btn = el.querySelector('#hm-mem-clear-draft-btn')
    if (btn) {
      btn.classList.toggle('hm-hidden', !hasDraft(activeTab))
    }
  }

  function showDiscardButton() {
    const btn = el.querySelector('#hm-mem-discard')
    if (btn) btn.style.display = ''
  }

  function hideDiscardButton() {
    const btn = el.querySelector('#hm-mem-discard')
    if (btn) btn.style.display = 'none'
  }

  // ---- data loading ----

  async function loadAll() {
    loading = true
    loadError = null
    draw()
    try {
      const res = await api.hermesMemoryReadAll()
      data.memory = res?.memory || ''
      data.user = res?.user || ''
      data.soul = res?.soul || ''
      mtimes.memory = res?.memory_mtime ?? null
      mtimes.user = res?.user_mtime ?? null
      mtimes.soul = res?.soul_mtime ?? null
      // Initialize lastSaved snapshots after first load
      lastSaved.memory = data.memory
      lastSaved.user = data.user
      lastSaved.soul = data.soul
      editorDirty = false
    } catch (e) {
      loadError = String(e?.message || e).replace(/^Error:\s*/, '')
    }
    loading = false
    draw()
  }

  // ---- tab switching ----

  function switchTab(key) {
    if (key === activeTab) return
    if (editorDirty) {
      showConfirm({
        message: t('engine.memoryUnsaved'),
        confirmText: t('common.confirm') || 'OK',
        variant: 'danger',
      }).then((ok) => {
        if (!ok) return
        doSwitch(key)
      })
    } else {
      doSwitch(key)
    }
  }

  function doSwitch(key) {
    activeTab = key
    editorDirty = false
    if (hasDraft(key)) {
      promptDraftRestore(key)
    } else {
      refreshEditor()
    }
  }

  /** Prompt user to restore or discard a found draft, then refresh. */
  async function promptDraftRestore(key) {
    const label = key.toUpperCase() + '.md'
    const ok = await showConfirm({
      message: (t('memory.memoryDraftRecovered') || '检测到未保存的草稿，是否恢复？').replace('{file}', label),
      confirmText: t('common.confirm') || '恢复',
      variant: 'info',
    })
    if (ok) {
      // Restore draft
      const draftContent = getDraft(key) || ''
      data[key] = draftContent
      editorDirty = true
    } else {
      // Discard draft
      clearDraft(key)
      data[key] = lastSaved[key]
    }
    refreshEditor()
  }

  // ---- editor refresh ----

  function refreshEditor() {
    const ta = el.querySelector('#hm-mem-textarea')
    if (ta) {
      ta.value = data[activeTab] || ''
    }
    updatePreview(data[activeTab] || '')
    updateStats(data[activeTab] || '')
    if (editorDirty) {
      showDiscardButton()
    } else {
      hideDiscardButton()
    }
    updateClearDraftButton()
    updateTabActiveState()
    updateEditorHeader()
  }

  function updateTabActiveState() {
    el.querySelectorAll('.hm-mem-tab').forEach(btn => {
      btn.classList.toggle('hm-mem-tab--active', btn.dataset.tab === activeTab)
    })
  }

  function updateEditorHeader() {
    const titleEl = el.querySelector('.hm-mem-editor-title')
    const mtimeEl = el.querySelector('#hm-mem-mtime')
    if (titleEl) {
      titleEl.textContent = `${activeTab.toUpperCase()}.md`
    }
    if (mtimeEl) {
      const mt = mtimes[activeTab]
      mtimeEl.textContent = mt ? fmtMtime(mt) : ''
    }
  }

  function updatePreview(val) {
    const previewEl = el.querySelector('#hm-mem-preview')
    if (previewEl) {
      previewEl.innerHTML = renderMarkdown(val)
    }
  }

  function updateStats(val) {
    const statsEl = el.querySelector('#hm-mem-stats')
    if (statsEl) {
      const stats = contentStats(val)
      statsEl.innerHTML = `
        <span>${stats.words} ${t('engine.memoryWords')}</span>
        <span class="hm-mem-sep">·</span>
        <span>${stats.chars} ${t('engine.memoryChars')}</span>
      `
    }
  }

  // ---- discard / save ----

  function discardCurrent() {
    clearDraft(activeTab)
    data[activeTab] = lastSaved[activeTab]
    const ta = el.querySelector('#hm-mem-textarea')
    if (ta) {
      ta.value = data[activeTab]
    }
    editorDirty = false
    updatePreview(data[activeTab])
    updateStats(data[activeTab])
    hideDiscardButton()
    updateClearDraftButton()
  }

  async function saveCurrent() {
    if (saving) return
    saving = true
    const saveBtn = el.querySelector('#hm-mem-save')
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = t('engine.memorySaving') }
    try {
      await api.hermesMemoryWrite(activeTab, data[activeTab])
      lastSaved[activeTab] = data[activeTab]
      mtimes[activeTab] = Math.floor(Date.now() / 1000)
      editorDirty = false
      clearDraft(activeTab)
      toast(t('engine.memorySaved'), 'success')
    } catch (e) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('engine.memorySave') }
      toast(humanizeError(e, t('engine.memorySaveFailed')), 'error')
    }
    saving = false
    refreshEditor()
  }

  // ---- rendering ----

  function renderSkeleton() {
    return `
      <div class="hm-panel"><div class="hm-panel-body">
        <div class="hm-skel" style="width:40%;height:14px;margin-bottom:12px"></div>
        <div class="hm-skel" style="width:100%;height:120px"></div>
      </div></div>
    `
  }

  function renderWorkspace() {
    const content = data[activeTab] || ''
    const { chars, words } = contentStats(content)
    const mtime = mtimes[activeTab]
    const hasLocalDraft = hasDraft(activeTab)

    return `
      <div class="hm-mem-workspace">
        <nav class="hm-mem-tabs">
          ${SECTIONS.map(s => `
            <button class="hm-mem-tab ${s.key === activeTab ? 'hm-mem-tab--active' : ''}" data-tab="${s.key}">
              <span class="hm-mem-tab-icon">${s.icon}</span>
              <span class="hm-mem-tab-label">${s.key.toUpperCase()}.md</span>
            </button>
          `).join('')}
        </nav>

        <div class="hm-mem-editor-pane">
          <div class="hm-mem-editor-header">
            <span class="hm-mem-editor-title">${activeTab.toUpperCase()}.md</span>
            <span class="hm-mem-mtime" id="hm-mem-mtime">${mtime ? escHtml(fmtMtime(mtime)) : ''}</span>
          </div>
          <textarea id="hm-mem-textarea" class="hm-mem-editor-textarea" spellcheck="false" placeholder="${t('engine.memoryPlaceholder')}">${escHtml(content)}</textarea>
          <div class="hm-mem-editor-footer">
            <span class="hm-mem-stats" id="hm-mem-stats">
              <span>${words} ${t('engine.memoryWords')}</span>
              <span class="hm-mem-sep">·</span>
              <span>${chars} ${t('engine.memoryChars')}</span>
            </span>
            <button type="button" id="hm-mem-clear-draft-btn"
              class="hm-btn hm-btn--ghost hm-btn--sm ${hasLocalDraft ? '' : 'hm-hidden'}"
              title="${t('memory.memoryDraftDiscard') || 'Clear draft'}">
              ${ICONS.trash}
            </button>
            <span class="hm-spacer"></span>
            <button class="hm-btn hm-btn--ghost hm-btn--sm" id="hm-mem-discard" style="display:${editorDirty ? '' : 'none'}">${t('memory.memoryDraftDiscard') || t('engine.memoryCancel')}</button>
            <button class="hm-btn hm-btn--cta hm-btn--sm" id="hm-mem-save">${t('engine.memorySave')}</button>
          </div>
        </div>

        <div class="hm-mem-preview-pane">
          <div class="hm-mem-preview-header">
            <span>${t('memory.memoryPreviewLabel') || 'Preview'}</span>
          </div>
          <div class="hm-mem-preview-body markdown-body" id="hm-mem-preview">${renderMarkdown(content)}</div>
        </div>
      </div>
    `
  }

  function draw() {
    el.innerHTML = `
      <div class="hm-hero">
        <div class="hm-hero-title">
          <div class="hm-hero-eyebrow">
            <span class="hm-dot hm-dot--run"></span>
            ${t('engine.memoryEyebrow')}
          </div>
          <h1 class="hm-hero-h1">${t('engine.hermesMemoryTitle')}</h1>
          <div class="hm-hero-sub">~/.hermes/memories/ · 3 files</div>
        </div>
        <div class="hm-hero-actions">
          <button class="hm-btn hm-btn--ghost hm-btn--sm hm-mem-refresh" ${loading ? 'disabled' : ''}>
            ${ICONS.refresh} ${t('engine.logsRefresh')}
          </button>
        </div>
      </div>

      ${loadError ? `
        <div class="hm-panel">
          <div class="hm-panel-body hm-panel-body--tight">
            <div style="color:var(--hm-error);font-family:var(--hm-font-mono);font-size:12.5px">
              ${escHtml(loadError)}
            </div>
          </div>
        </div>
      ` : ''}

      ${loading ? renderSkeleton() : renderWorkspace()}
    `
    bind()
  }

  function bind() {
    el.querySelector('.hm-mem-refresh')?.addEventListener('click', () => loadAll())

    el.querySelectorAll('.hm-mem-tab').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab))
    })

    const ta = el.querySelector('#hm-mem-textarea')
    if (ta) {
      ta.addEventListener('input', () => {
        const val = ta.value
        data[activeTab] = val
        editorDirty = true
        updatePreview(val)
        updateStats(val)
        showDiscardButton()

        // Autosave draft with 3 s debounce
        clearTimeout(autosaveTimer)
        autosaveTimer = setTimeout(() => {
          autosaveDraft(activeTab, val)
          updateClearDraftButton()
        }, AUTOSAVE_DELAY)
      })
      ta.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
          e.preventDefault()
          saveCurrent()
        }
      })
    }

    const saveBtn = el.querySelector('#hm-mem-save')
    saveBtn?.addEventListener('click', () => saveCurrent())

    const discardBtn = el.querySelector('#hm-mem-discard')
    discardBtn?.addEventListener('click', () => discardCurrent())

    const clearDraftBtn = el.querySelector('#hm-mem-clear-draft-btn')
    clearDraftBtn?.addEventListener('click', () => {
      clearDraft(activeTab)
    })
  }

  loadAll()
  return el
}
