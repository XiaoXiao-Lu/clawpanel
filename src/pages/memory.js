/**
 * 记忆文件管理页面
 */
import { api } from '../lib/tauri-api.js'
import { toast } from '../components/toast.js'
import { humanizeError } from '../lib/humanize-error.js'
import { showModal } from '../components/modal.js'
import { t } from '../lib/i18n.js'
import { renderMarkdown } from '../engines/hermes/lib/markdown-renderer.js'
import { escapeHtml } from '../lib/utils.js'

function CATEGORIES() {
  return [
    { key: 'memory', label: t('memory.catMemory'), desc: t('memory.catMemoryDesc') },
    { key: 'archive', label: t('memory.catArchive'), desc: t('memory.catArchiveDesc') },
    { key: 'core', label: t('memory.catCore'), desc: t('memory.catCoreDesc') },
  ]
}

export async function render() {
  const page = document.createElement('div')
  page.className = 'page'

  page.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">${t('memory.title')}</h1>
      <div class="page-actions" style="display:flex;align-items:center;gap:var(--space-sm)">
        <label style="font-size:var(--font-size-sm);color:var(--text-tertiary)">${t('memory.agentLabel')}</label>
        <select class="form-input" id="agent-select" style="width:auto;min-width:140px"><option value="main">main</option></select>
      </div>
    </div>
    <div class="tab-bar">
      ${CATEGORIES().map((c, i) => `<div class="tab${i === 0 ? ' active' : ''}" data-tab="${c.key}">${c.label}</div>`).join('')}
    </div>
    <div class="form-hint" id="category-desc" style="margin-bottom:var(--space-md)">${CATEGORIES()[0].desc}</div>
    <div class="memory-layout">
      <div class="memory-sidebar">
        <div class="sidebar-toolbar">
          <button class="btn btn-sm btn-secondary" id="btn-new-file">+ ${t('memory.newFile')}</button>
          <button class="btn btn-sm btn-danger" id="btn-del-file" disabled>${t('memory.deleteFile')}</button>
        </div>
        <div id="file-tree"><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div></div>
      </div>
      <div class="memory-editor">
        <div class="editor-toolbar">
          <div class="toolbar-left">
            <span id="current-file">${t('memory.selectFile')}</span>
            <span id="file-stats"></span>
          </div>
          <div class="toolbar-right">
            <button class="btn btn-sm btn-secondary" id="btn-download" disabled title="${t('memory.download')}">${t('memory.download')}</button>
            <button class="btn btn-sm btn-secondary" id="btn-export-zip" title="${t('memory.exportZip')}">${t('memory.exportZip')}</button>
            <button class="btn btn-sm btn-primary" id="btn-save-file" disabled>${t('memory.save')}</button>
          </div>
        </div>
        <div class="memory-editor-split">
          <textarea class="editor-area" id="file-editor" placeholder="${t('memory.editorPlaceholder')}" disabled spellcheck="false"></textarea>
          <div class="memory-preview" id="md-preview"><div class="empty-state empty-compact" style="padding:60px 20px"><div class="empty-icon">📄</div><div class="empty-desc">${t('memory.editorPlaceholder')}</div></div></div>
        </div>
      </div>
    </div>
  `

  const state = { category: 'memory', currentPath: null, agentId: 'main', lastSavedContent: '', draftTimer: null }

  // 先用默认选项填充下拉框，立即显示页面
  const agentSelect = page.querySelector('#agent-select')
  agentSelect.innerHTML = '<option value="main">main</option>'

  // 异步加载 agent 列表并更新下拉框
  api.listAgents().then(agents => {
    if (!agentSelect) return
    const options = agents.map(a => {
      const label = a.identityName ? a.identityName.split(',')[0].trim() : a.id
      return `<option value="${a.id}">${a.id}${a.id !== label ? ' — ' + label : ''}</option>`
    }).join('')
    agentSelect.innerHTML = options
  }).catch(() => {})

  // Agent 切换
  page.querySelector('#agent-select').onchange = (e) => {
    state.agentId = e.target.value
    state.currentPath = null
    state.lastSavedContent = ''
    resetEditor(page)
    // 显示加载动画
    const tree = page.querySelector('#file-tree')
    tree.innerHTML = '<div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div>'
    loadFiles(page, state)
  }

  // Tab 切换
  page.querySelectorAll('.tab').forEach(tab => {
    tab.setAttribute('role', 'tab')
    tab.setAttribute('tabindex', '0')
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.currentTarget.click()
      }
    })
    tab.onclick = () => {
      page.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      state.category = tab.dataset.tab
      state.currentPath = null
      state.lastSavedContent = ''
      const cat = CATEGORIES().find(c => c.key === state.category)
      page.querySelector('#category-desc').textContent = cat?.desc || ''
      resetEditor(page)
      // 显示加载动画
      const tree = page.querySelector('#file-tree')
      tree.innerHTML = '<div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div><div class="loading-placeholder" style="height:48px;margin:6px 8px;border-radius:var(--radius-md);background:var(--surface-sunken)"></div>'
      loadFiles(page, state)
    }
  })

  // 保存
  page.querySelector('#btn-save-file').onclick = () => saveFile(page, state)

  // 实时预览
  page.querySelector('#file-editor').addEventListener('input', () => {
    updatePreview(page, state)
    updateStats(page)
    scheduleDraftSave(state, page)
  })

  // Ctrl+S 快捷键
  page.querySelector('#file-editor').addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      saveFile(page, state)
    }
  })

  // 新建文件
  page.querySelector('#btn-new-file').onclick = () => {
    showModal({
      title: t('memory.newFileTitle'),
      fields: [{ name: 'filename', label: t('memory.newFileLabel'), placeholder: t('memory.newFilePlaceholder'), hint: t('memory.newFileHint') }],
      onConfirm: async ({ filename }) => {
        if (!filename) return
        try {
          await api.writeMemoryFile(filename, `# ${filename}\n\n`, state.category, state.agentId)
          toast(t('memory.created', { name: filename }), 'success')
          loadFiles(page, state)
        } catch (e) {
          toast(humanizeError(e, t('memory.createFailed')), 'error')
        }
      },
    })
  }

  // 删除文件
  page.querySelector('#btn-del-file').onclick = async () => {
    if (!state.currentPath) return
    const name = state.currentPath.split('/').pop()
    const { showConfirm } = await import('../components/modal.js')
    const yes = await showConfirm({
      title: t('memory.deleteConfirmTitle', { name }),
      message: t('memory.confirmDelete', { name }),
      impact: [
        t('memory.deleteImpactPermanent'),
        t('memory.deleteImpactAgent'),
      ],
      confirmText: t('memory.deleteConfirmBtn'),
      cancelText: t('memory.deleteCancelBtn'),
    })
    if (!yes) return
    try {
      await api.deleteMemoryFile(state.currentPath, state.agentId)
      toast(t('memory.deleted', { name }), 'success')
      state.currentPath = null
      resetEditor(page)
      loadFiles(page, state)
    } catch (e) {
      toast(humanizeError(e, t('memory.deleteFailed')), 'error')
    }
  }

  // 单个下载
  page.querySelector('#btn-download').onclick = () => downloadCurrentFile(page, state)

  // 打包下载
  page.querySelector('#btn-export-zip').onclick = () => exportZip(state)

  loadFiles(page, state)
  return page
}

async function loadFiles(page, state) {
  const tree = page.querySelector('#file-tree')

  try {
    const files = await api.listMemoryFiles(state.category, state.agentId)
    if (!files || !files.length) {
      tree.innerHTML = `
        <div class="empty-state empty-compact">
          <div class="empty-icon">🧠</div>
          <div class="empty-desc">${t('memory.noFiles')}</div>
          <div class="empty-cta"><button class="btn btn-primary btn-sm" data-empty-cta="new-file">${t('memory.newFile')}</button></div>
        </div>
      `
      tree.querySelector('[data-empty-cta="new-file"]')?.addEventListener('click', () => {
        page.querySelector('#btn-new-file')?.click()
      })
      return
    }
    renderFileTree(page, state, files)
  } catch (e) {
    tree.innerHTML = `<div style="color:var(--error);padding:12px">${t('memory.loadFailed')}: ${escapeHtml(e)}</div>`
    toast(humanizeError(e, t('memory.loadListFailed')), 'error')
  }
}

function renderFileTree(page, state, files) {
  const tree = page.querySelector('#file-tree')

  // 完整的文件描述映射 + 色彩分类
  const FILE_INFO = {
    'MEMORY.md':    { desc: '当前工作上下文与进度记录', type: 'core' },
    'USER.md':      { desc: '用户偏好、习惯与个人信息', type: 'identity' },
    'SOUL.md':      { desc: 'Agent 人格定义与行为准则', type: 'identity' },
    'IDENTITY.md':  { desc: 'Agent 身份定义与签名信息', type: 'identity' },
    'AGENTS.md':    { desc: '多 Agent 协作规则与配置', type: 'config' },
    'CLAUDE.md':    { desc: 'Claude 模型交互基础配置', type: 'config' },
    'TOOLS.md':     { desc: '工具调用规则与权限配置', type: 'config' },
    'RULES.md':     { desc: '行为规则、约束与边界定义', type: 'config' },
    'PROJECT.md':   { desc: '项目背景、结构与上下文', type: 'context' },
    'CONTEXT.md':   { desc: '运行上下文与环境配置信息', type: 'context' },
    'WORKSPACE.md': { desc: '工作区路径与目录配置', type: 'context' },
    'NOTES.md':     { desc: '临时笔记、想法与备忘', type: 'notes' },
    'TODO.md':      { desc: '待办事项与任务清单', type: 'notes' },
    'HISTORY.md':   { desc: '对话历史摘要与回顾', type: 'notes' },
    'PROMPTS.md':   { desc: '自定义提示词模板库', type: 'prompts' },
    'STYLE.md':     { desc: '回复风格与表达偏好的指南', type: 'prompts' },
    'PREFERENCES.md': { desc: '全局偏好与默认设置', type: 'config' },
    'README.md':    { desc: '项目说明与快速入门', type: 'doc' },
    'CHANGELOG.md': { desc: '版本变更记录与更新日志', type: 'doc' },
    'BOOTSTRAP.md': { desc: '系统引导、环境初始化与自检配置', type: 'core' },
    'HEARTBEAT.md': { desc: '心跳检测与健康度监控配置', type: 'core' },
  }

  // 类型图标和颜色
  const TYPE_STYLE = {
    identity: { icon: '👤', color: 'var(--warning, #f59e0b)' },
    core:     { icon: '🧠', color: 'var(--brand-400, #3b82f6)' },
    config:   { icon: '⚙️', color: 'var(--brand, #8b5cf6)' },
    context:  { icon: '📋', color: 'var(--info, #14b8a6)' },
    notes:    { icon: '📝', color: 'var(--text-secondary, #6b7280)' },
    prompts:  { icon: '💬', color: 'var(--brand, #ec4899)' },
    doc:      { icon: '📄', color: 'var(--success, #22c55e)' },
  }

  tree.innerHTML = files.map(f => {
    const name = f.split('/').pop()
    const active = state.currentPath === f ? ' active' : ''
    // 获取小写或大写扩展名的匹配，如果未找到，则作为未知文件展示
    const key = name.toUpperCase()
    const info = FILE_INFO[name] || FILE_INFO[key] || { desc: '', type: 'doc' }
    const style = TYPE_STYLE[info.type] || TYPE_STYLE.doc
    return `<div class="file-item${active}" data-path="${f}" style="--file-color:${style.color};--file-color-bg:color-mix(in srgb,${style.color} 12%,transparent)">
      <div class="file-item-icon">${style.icon}</div>
      <div class="file-item-main">
        <span class="file-item-name">${name}</span>
        ${info.desc ? `<span class="file-item-desc">${info.desc}</span>` : ''}
      </div>
    </div>`
  }).join('')

  tree.querySelectorAll('.file-item').forEach(item => {
    item.setAttribute('role', 'button')
    item.setAttribute('tabindex', '0')
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.currentTarget.click()
      }
    })
    item.onclick = async () => {
      state.currentPath = item.dataset.path
      tree.querySelectorAll('.file-item').forEach(i => i.classList.remove('active'))
      item.classList.add('active')
      await loadFileContent(page, state)
      restoreDraft(page, state)
    }
  })
}

async function loadFileContent(page, state) {
  const editor = page.querySelector('#file-editor')
  const label = page.querySelector('#current-file')
  const btnSave = page.querySelector('#btn-save-file')
  const btnDel = page.querySelector('#btn-del-file')
  const btnDl = page.querySelector('#btn-download')

  editor.disabled = true
  editor.value = t('memory.loading')
  label.textContent = state.currentPath

  try {
    const content = await api.readMemoryFile(state.currentPath, state.agentId)
    editor.value = content || ''
    state.lastSavedContent = content || ''
    editor.disabled = false
    btnSave.disabled = false
    btnDel.disabled = false
    btnDl.disabled = false
    updatePreview(page, state)
    updateStats(page)
  } catch (e) {
    editor.value = t('memory.readFailed') + ': ' + e
    toast(humanizeError(e, t('memory.readFileFailed')), 'error')
  }
}

function resetEditor(page) {
  const editor = page.querySelector('#file-editor')
  editor.value = ''
  editor.disabled = true
  page.querySelector('#current-file').textContent = t('memory.selectFile')
  page.querySelector('#file-stats').textContent = ''
  page.querySelector('#btn-save-file').disabled = true
  page.querySelector('#btn-del-file').disabled = true
  page.querySelector('#btn-download').disabled = true
  const preview = page.querySelector('#md-preview')
  if (preview) {
    preview.innerHTML = `<div class="empty-state empty-compact" style="padding:60px 20px"><div class="empty-icon">📄</div><div class="empty-desc">${t('memory.editorPlaceholder')}</div></div>`
  }
}

async function saveFile(page, state) {
  if (!state.currentPath) return
  const content = page.querySelector('#file-editor').value
  try {
    await api.writeMemoryFile(state.currentPath, content, state.category, state.agentId)
    state.lastSavedContent = content
    clearDraft(state)
    toast(t('memory.fileSaved'), 'success')
  } catch (e) {
    toast(humanizeError(e, t('memory.saveFailed')), 'error')
  }
}

// ===== Live Preview =====

function updatePreview(page, state) {
  const preview = page.querySelector('#md-preview')
  if (!preview) return
  const md = page.querySelector('#file-editor').value
  preview.innerHTML = renderMarkdown(md)
}

// ===== Stats =====

function updateStats(page) {
  const text = page.querySelector('#file-editor').value || ''
  const chars = text.length
  const words = (text.match(/[\u4e00-\u9fff]|[A-Za-z0-9_]+/g) || []).length
  const lines = text.split('\n').length
  const statsEl = page.querySelector('#file-stats')
  if (statsEl) {
    statsEl.textContent = `${lines} ${t('common.lines') || '行'} · ${words} ${t('common.words') || '词'} · ${chars} ${t('common.chars') || '字'}`
  }
}

// ===== Auto-save Draft =====

function getDraftKey(state) {
  return `clawpanel_mdraft_${state.agentId}_${state.category}_${state.currentPath || ''}`
}

function scheduleDraftSave(state, page) {
  clearTimeout(state.draftTimer)
  state.draftTimer = setTimeout(() => {
    if (!state.currentPath) return
    const content = page.querySelector('#file-editor')?.value
    if (content !== undefined && content !== state.lastSavedContent) {
      localStorage.setItem(getDraftKey(state), content)
    }
  }, 3000)
}

function clearDraft(state) {
  clearTimeout(state.draftTimer)
  localStorage.removeItem(getDraftKey(state))
}

function restoreDraft(page, state) {
  if (!state.currentPath) return
  const draft = localStorage.getItem(getDraftKey(state))
  if (draft && draft !== state.lastSavedContent) {
    page.querySelector('#file-editor').value = draft
    updatePreview(page, state)
    updateStats(page)
  }
}

// ===== 下载功能 =====

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

async function downloadCurrentFile(page, state) {
  if (!state.currentPath) return
  try {
    const content = page.querySelector('#file-editor').value
    const filename = state.currentPath.split('/').pop()
    triggerDownload(filename, content)
    toast(t('memory.downloaded', { name: filename }), 'success')
  } catch (e) {
    toast(humanizeError(e, t('memory.downloadFailed')), 'error')
  }
}

async function exportZip(state) {
  try {
    const zipPath = await api.exportMemoryZip(state.category, state.agentId)
    const label = CATEGORIES().find(c => c.key === state.category)?.label || state.category
    // 尝试用 Tauri shell open 打开文件所在目录
    try {
      const { open } = await import('@tauri-apps/plugin-shell')
      const dir = zipPath.substring(0, zipPath.lastIndexOf('/')) || zipPath
      await open(dir)
      toast(t('memory.exported', { label, path: zipPath }), 'success')
    } catch {
      // fallback：仅显示路径
      toast(t('memory.exported', { label, path: zipPath }), 'success')
    }
  } catch (e) {
    toast(humanizeError(e, t('memory.exportFailed')), 'error')
  }
}
