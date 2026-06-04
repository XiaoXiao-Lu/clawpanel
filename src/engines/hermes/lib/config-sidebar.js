/**
 * Hermes Config Sidebar — navigation + search for the configuration page.
 *
 * Three exported functions:
 *   - renderSidebar(groups)       → HTML string for the sidebar nav
 *   - initSidebarScrollSpy(groups, contentContainer) → cleanup function
 *   - initSearchFilter(searchInput, contentContainer) → cleanup function
 *
 * Usage:
 *   import { renderSidebar, initSidebarScrollSpy, initSearchFilter }
 *     from './config-sidebar.js'
 *   sidebarEl.innerHTML = renderSidebar(CONFIG_GROUPS)
 *   const cleanupSpy = initSidebarScrollSpy(CONFIG_GROUPS, contentEl)
 *   const cleanupSearch = initSearchFilter(searchInput, contentEl)
 */

// ---------- renderSidebar ----------

/**
 * Render the sidebar navigation HTML.
 *
 * Each group becomes an <a> link pointing to #cfg-group-{id}. Clicking
 * scrolls the corresponding .hm-config-group section into view.
 *
 * @param {Array<{ id: string, titleKey: string, icon: string, panels: Array }>} groups
 * @returns {string} HTML string
 */
export function renderSidebar(groups) {
  if (!groups || !groups.length) return ''

  const links = groups.map(g => {
    const icon = g.icon || ''
    // titleKey is an i18n key like 'engine.configGroupCoreRuntime'. The caller
    // is responsible for resolving it via the i18n system before passing to
    // this function, OR we render the raw key and let CSS/data-attr handle it.
    // For now we use the key; the page should map _() before calling us.
    return (
      '<a class="hm-sidebar__link" href="#cfg-group-' + escAttr(g.id) + '"' +
      ' data-group="' + escAttr(g.id) + '"' +
      '>' +
      '<span class="hm-sidebar__icon">' + icon + '</span>' +
      '<span class="hm-sidebar__label" data-i18n="' + escAttr(g.titleKey) + '">' +
      escHtml(g.titleKey) +
      '</span>' +
      '</a>'
    )
  }).join('\n')

  return '<nav class="hm-sidebar__nav">' + links + '</nav>'
}

// ---------- initSidebarScrollSpy ----------

/**
 * Initialize IntersectionObserver-based scroll spy.
 *
 * As the user scrolls the content area, the corresponding sidebar link
 * gets the `.hm-sidebar__link--active` class.
 *
 * @param {Array<{ id: string }>} groups
 * @param {HTMLElement} contentContainer - the scrollable container with .hm-config-group sections
 * @returns {() => void} cleanup function
 */
export function initSidebarScrollSpy(groups, contentContainer) {
  if (!contentContainer) return () => {}

  const groupIds = new Set(groups.map(g => g.id))

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const section = /** @type {HTMLElement} */ (entry.target)
      const groupId = section.dataset.group || ''

      // Find the matching sidebar link.
      const link = document.querySelector(
        '.hm-sidebar__link[data-group="' + CSS.escape(groupId) + '"]'
      )

      if (!link) continue

      if (entry.isIntersecting) {
        // Remove active from all links, then add to the intersecting one.
        const allLinks = document.querySelectorAll('.hm-sidebar__link')
        for (const el of allLinks) {
          el.classList.remove('hm-sidebar__link--active')
        }
        link.classList.add('hm-sidebar__link--active')
      }
    }
  }, {
    root: contentContainer,
    rootMargin: '-80px 0px -30% 0px',
    threshold: 0,
  })

  // Observe all .hm-config-group sections inside the container.
  const sections = contentContainer.querySelectorAll('.hm-config-group')
  for (const section of sections) {
    const groupId = /** @type {HTMLElement} */ (section).dataset.group || ''
    if (groupIds.has(groupId)) {
      observer.observe(section)
    }
  }

  return () => observer.disconnect()
}

// ---------- initSearchFilter ----------

/**
 * Initialize search filtering on the config page.
 *
 * Listens for 'input' on the search field, then hides/shows .hm-panel
 * elements and their parent .hm-config-group sections based on matches.
 *
 * @param {HTMLInputElement} searchInput
 * @param {HTMLElement} contentContainer
 * @returns {() => void} cleanup function
 */
export function initSearchFilter(searchInput, contentContainer) {
  if (!searchInput || !contentContainer) return () => {}

  /** @param {string} query */
  function applyFilter(query) {
    const q = query.toLowerCase().trim()
    const panels = contentContainer.querySelectorAll('.hm-panel')
    /** @type {Map<HTMLElement, boolean>} tracks whether a group has any visible panel */
    const groupVisibility = new Map()

    // Remove any existing "no results" message.
    const existingMsg = contentContainer.querySelector('.hm-search-no-results')
    if (existingMsg) existingMsg.remove()

    if (!q) {
      // Show everything.
      for (const panel of panels) {
        /** @type {HTMLElement} */ (panel).style.display = ''
      }
      const groups = contentContainer.querySelectorAll('.hm-config-group')
      for (const group of groups) {
        /** @type {HTMLElement} */ (group).style.display = ''
      }
      return
    }

    let anyVisible = false

    for (const panel of panels) {
      const el = /** @type {HTMLElement} */ (panel)

      // Collect searchable text from the panel header and description.
      const titleEl = el.querySelector('.hm-panel-title')
      const title = titleEl ? (titleEl.textContent || '') : ''

      const descEl = el.querySelector('.hm-panel-desc, .hm-channel-panel-desc')
      const desc = descEl ? (descEl.textContent || '') : ''

      const text = (title + ' ' + desc).toLowerCase()
      const match = text.includes(q)

      el.style.display = match ? '' : 'none'
      if (match) anyVisible = true

      // Track group-level visibility.
      const group = el.closest('.hm-config-group')
      if (group) {
        const gEl = /** @type {HTMLElement} */ (group)
        if (!groupVisibility.has(gEl)) {
          groupVisibility.set(gEl, match)
        } else if (match) {
          groupVisibility.set(gEl, true)
        }
      }
    }

    // Show/hide groups based on whether any of their panels are visible.
    for (const [group, hasVisible] of groupVisibility) {
      group.style.display = hasVisible ? '' : 'none'
    }

    // Show "no results" message if nothing matches.
    if (!anyVisible) {
      const msg = document.createElement('div')
      msg.className = 'hm-search-no-results'
      msg.textContent = 'No matching configuration found'
      msg.setAttribute('data-i18n', 'engine.configNoResults')
      // Insert at the top of the content container.
      contentContainer.insertBefore(msg, contentContainer.firstChild)
    }
  }

  const handler = () => applyFilter(searchInput.value)
  searchInput.addEventListener('input', handler)

  return () => {
    searchInput.removeEventListener('input', handler)
  }
}

// ---------- internal helpers ----------

/** @param {string} s */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** @param {string} s */
function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
