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
 *
 * Usage:
 *   import { createModelCombobox } from './model-combobox.js'
 *   const combo = createModelCombobox(container, {
 *     placeholder: 'Select model…',
 *     initialValue: 'gpt-4',
 *     onSelect(value) { console.log('selected:', value) },
 *     onInput(value) { console.log('input:', value) },
 *   })
 *   combo.setModels(['gpt-4', 'gpt-4o', 'claude-3.5-sonnet'])
 *   combo.setValue('claude-3.5-sonnet')
 *   // Later: combo.destroy()
 */

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
 *   setModels: (models: string[]) => void,
 *   getValue: () => string,
 *   setValue: (value: string) => void,
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

  /** @type {string[]} */
  let models = []
  let activeIndex = -1
  let open = false

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
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }

  /**
   * Fuzzy-filter models and render the dropdown.
   * @param {string} query
   */
  function renderDropdown(query) {
    const q = query.toLowerCase().trim()
    /** @type {string[]} */
    let filtered
    if (!q) {
      filtered = models.slice()
    } else {
      filtered = models.filter(m => m.toLowerCase().includes(q))
    }

    dropdown.innerHTML = ''

    if (!filtered.length) {
      dropdown.style.display = 'none'
      open = false
      return
    }

    for (let idx = 0; idx < filtered.length; idx++) {
      const m = filtered[idx]
      const option = document.createElement('div')
      option.className = 'hm-combo__option'
      if (idx === activeIndex) {
        option.classList.add('hm-combo__option--active')
      }
      // Highlight matching substring.
      if (q) {
        const lower = m.toLowerCase()
        const pos = lower.indexOf(q)
        if (pos !== -1) {
          option.innerHTML =
            esc(m.slice(0, pos)) +
            '<strong>' + esc(m.slice(pos, pos + q.length)) + '</strong>' +
            esc(m.slice(pos + q.length))
        } else {
          option.textContent = m
        }
      } else {
        option.textContent = m
      }
      option.dataset.value = m
      option.addEventListener('mousedown', (e) => {
        e.preventDefault() // prevent blur on input before click commits
        selectOption(m)
      })
      dropdown.appendChild(option)
    }

    dropdown.style.display = 'block'
    open = true
    if (activeIndex >= filtered.length) {
      activeIndex = Math.max(0, filtered.length - 1)
    }
  }

  /** @param {string} value */
  function selectOption(value) {
    input.value = value
    dropdown.style.display = 'none'
    open = false
    activeIndex = -1
    if (onSelect) onSelect(value)
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
    if (!models.length) return
    activeIndex = -1
    renderDropdown(input.value)
  })

  input.addEventListener('input', () => {
    activeIndex = -1
    renderDropdown(input.value)
    if (onInput) onInput(input.value)
  })

  input.addEventListener('keydown', (e) => {
    if (!open || !models.length) return

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
        selectOption(opt.dataset.value || opt.textContent || '')
      }
    } else if (e.key === 'Escape') {
      dropdown.style.display = 'none'
      open = false
      activeIndex = -1
    }
  })

  // Close dropdown on blur (with a small delay so mousedown on option fires first).
  input.addEventListener('blur', () => {
    setTimeout(() => {
      dropdown.style.display = 'none'
      open = false
      activeIndex = -1
    }, 150)
  })

  // ---- public API ----

  return {
    /**
     * Set the model data source.
     * @param {string[]} newModels
     */
    setModels(newModels) {
      models = Array.isArray(newModels) ? newModels.slice() : []
      activeIndex = -1
      if (open) {
        renderDropdown(input.value)
      }
    },

    /** @returns {string} */
    getValue() {
      return input.value
    },

    /** @param {string} val */
    setValue(val) {
      input.value = val
    },

    /** Remove the combobox from the DOM and clean up. */
    destroy() {
      if (root.parentNode) {
        root.parentNode.removeChild(root)
      }
    },
  }
}
