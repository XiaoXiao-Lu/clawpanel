/**
 * Hermes Model Combobox — custom autocomplete dropdown for model selection.
 *
 * Creates a searchable input with keyboard-navigable dropdown. Falls back to
 * a plain text input when the model list is empty.
 *
 * CSS classes used (scoped under Hermes):
 *   .hm-combo                — root wrapper
 *   .hm-combo__input         — the <input> element
 *   .hm-combo__dropdown      — suggestion list container
 *   .hm-combo__option        — individual suggestion item
 *   .hm-combo__option--active — keyboard-highlighted option
 *   .hm-combo__group-header  — non-clickable provider group headers
 */

/**
 * @typedef {Object} ComboboxItem
 * @property {string} value - The actual value, e.g. "openai/gpt-4o"
 * @property {string} label - The display label, e.g. "gpt-4o"
 * @property {string} [group] - Group name, e.g. "openai"
 * @property {string[]} [pinyin] - Pinyin alias list, e.g. ["openai", "gpt4o"]
 */
import { escapeHtml as esc } from '../../../../lib/utils.js'

/**
 * Create a model combobox inside the given container.
 *
 * @param {HTMLElement} container
 * @param {{
 *   placeholder?: string,
 *   initialValue?: string,
 *   onSelect?: (value: string) => void,
 *   onInput?: (value: string) => void,
 * }} [options]
 * @returns {{
 *   setModels: (models: (string | ComboboxItem)[]) => void,
 *   getValue: () => string,
 *   setValue: (value: string) => void,
 *   setDisabled: (disabled: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createModelCombobox(container, options = {}) {
  const {
    placeholder = '',
    initialValue = '',
    onSelect,
    onInput,
  } = options

  /** @type {ComboboxItem[]} */
  let models = []
  let activeIndex = -1
  let open = false
  let currentValue = initialValue
  let blurTimer = null

  // ---- DOM construction ----

  const root = document.createElement('div')
  root.className = 'hm-combo'

  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'hm-combo__input'
  input.placeholder = placeholder
  input.value = initialValue
  input.autocomplete = 'off'

  const dropdown = document.createElement('div')
  dropdown.className = 'hm-combo__dropdown'
  dropdown.style.display = 'none'

  root.appendChild(input)
  root.appendChild(dropdown)
  container.appendChild(root)

  // ---- helpers ----

  /** Escape HTML for safe innerHTML rendering. */

  /**
   * Fuzzy-filter models and render the dropdown.
   * @param {string} query
   */
  function renderDropdown(query) {
    const q = query.toLowerCase().trim()
    /** @type {ComboboxItem[]} */
    let filtered
    if (!q) {
      filtered = models.slice()
    } else {
      filtered = models.filter(item => {
        const valMatch = item.value.toLowerCase().includes(q)
        const labelMatch = item.label.toLowerCase().includes(q)
        let pinyinMatch = false
        if (Array.isArray(item.pinyin)) {
          pinyinMatch = item.pinyin.some(p => typeof p === 'string' && p.toLowerCase().includes(q))
        }
        return valMatch || labelMatch || pinyinMatch
      })
    }

    dropdown.innerHTML = ''

    if (!filtered.length) {
      dropdown.style.display = 'none'
      open = false
      return
    }

    let lastGroup = null
    let optionIdx = 0
    for (let idx = 0; idx < filtered.length; idx++) {
      const item = filtered[idx]
      if (item.group !== undefined && item.group !== lastGroup) {
        const header = document.createElement('div')
        header.className = 'hm-combo__group-header'
        header.textContent = item.group
        dropdown.appendChild(header)
        lastGroup = item.group
      } else if (item.group === undefined) {
        lastGroup = null
      }

      const option = document.createElement('div')
      option.className = 'hm-combo__option'
      if (optionIdx === activeIndex) {
        option.classList.add('hm-combo__option--active')
      }

      const textToDisplay = item.label || item.value
      // Highlight matching substring.
      if (q) {
        const lower = textToDisplay.toLowerCase()
        const pos = lower.indexOf(q)
        if (pos !== -1) {
          option.innerHTML =
            esc(textToDisplay.slice(0, pos)) +
            '<strong>' + esc(textToDisplay.slice(pos, pos + q.length)) + '</strong>' +
            esc(textToDisplay.slice(pos + q.length))
        } else {
          option.textContent = textToDisplay
        }
      } else {
        option.textContent = textToDisplay
      }
      option.dataset.value = item.value
      option.addEventListener('mousedown', (e) => {
        e.preventDefault() // prevent blur on input before click commits
        selectOption(item)
      })
      dropdown.appendChild(option)
      optionIdx++
    }

    dropdown.style.display = 'block'
    open = true
    if (activeIndex >= optionIdx) {
      activeIndex = Math.max(0, optionIdx - 1)
    }
  }

  /** @param {ComboboxItem} item */
  function selectOption(item) {
    input.value = item.label
    currentValue = item.value
    dropdown.style.display = 'none'
    open = false
    activeIndex = -1
    if (onSelect) onSelect(item.value)
  }

  /** Scroll the active option into view. */
  function scrollToActive() {
    const active = dropdown.querySelector('.hm-combo__option--active')
    if (active) {
      active.scrollIntoView({ block: 'nearest' })
    }
  }

  /** Update active option visual. */
  function updateActiveClass() {
    const prev = dropdown.querySelector('.hm-combo__option--active')
    if (prev) prev.classList.remove('hm-combo__option--active')
    const options = dropdown.querySelectorAll('.hm-combo__option')
    if (activeIndex >= 0 && activeIndex < options.length) {
      options[activeIndex].classList.add('hm-combo__option--active')
      scrollToActive()
    }
  }

  // ---- event listeners ----

  input.addEventListener('focus', () => {
    if (!models.length || input.disabled) return
    activeIndex = -1
    renderDropdown(input.value)
  })

  input.addEventListener('input', () => {
    if (input.disabled) return
    activeIndex = -1
    currentValue = input.value
    renderDropdown(input.value)
    if (onInput) onInput(input.value)
  })

  input.addEventListener('keydown', (e) => {
    if (!open || !models.length || input.disabled) return

    const options = dropdown.querySelectorAll('.hm-combo__option')

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      activeIndex = Math.min(activeIndex + 1, options.length - 1)
      updateActiveClass()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      activeIndex = Math.max(activeIndex - 1, 0)
      updateActiveClass()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && activeIndex < options.length) {
        const opt = options[activeIndex]
        const val = opt.dataset.value
        const found = models.find(m => m.value === val)
        if (found) {
          selectOption(found)
        } else {
          selectOption({ value: val, label: val })
        }
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none'
      open = false
      activeIndex = -1
    }
  })

  // Close dropdown on blur (with a small delay so mousedown on option fires first).
  input.addEventListener('blur', () => {
    blurTimer = setTimeout(() => {
      dropdown.style.display = 'none'
      open = false
      activeIndex = -1
    }, 150)
  })

  // Close dropdown on outside click
  function outsideClickHandler(e) {
    if (!root.contains(e.target)) {
      dropdown.style.display = 'none'
      open = false
      activeIndex = -1
    }
  }
  document.addEventListener('click', outsideClickHandler)

  // ---- public API ----

  return {
    /**
     * Set the model data source.
     * @param {(string | ComboboxItem)[]} newModels
     */
    setModels(newModels) {
      models = Array.isArray(newModels) ? newModels.map(m => {
        if (typeof m === 'string') {
          return { value: m, label: m }
        }
        return {
          value: m.value || '',
          label: m.label || m.value || '',
          group: m.group,
          pinyin: m.pinyin
        }
      }) : []
      activeIndex = -1

      if (currentValue) {
        const found = models.find(m => m.value === currentValue)
        if (found) {
          input.value = found.label
        }
      }

      if (open) {
        renderDropdown(input.value)
      }
    },

    /** @returns {string} */
    getValue() {
      return currentValue
    },

    /** @param {string} val */
    setValue(val) {
      currentValue = val
      const found = models.find(m => m.value === val)
      if (found) {
        input.value = found.label
      } else {
        input.value = val
      }
    },

    /** @param {boolean} disabled */
    setDisabled(disabled) {
      input.disabled = !!disabled
      if (disabled && open) {
        dropdown.style.display = 'none'
        open = false
        activeIndex = -1
      }
    },

    /** Remove the combobox from the DOM and clean up. */
    destroy() {
      if (blurTimer) {
        clearTimeout(blurTimer)
      }
      document.removeEventListener('click', outsideClickHandler)
      if (root.parentNode) {
        root.parentNode.removeChild(root)
      }
    },
  }
}
