# ChatCraw UI Redesign Specification
## "Aether Interface" Design System

---

## 1. Design Philosophy

### Core Principles
1. **Layered Depth** — Multi-layer interface with glass morphism, subtle shadows, and depth hierarchy
2. **Fluid Motion** — Smooth micro-interactions with purposeful animation
3. **Information Density** — Clean data presentation without overwhelming the user
4. **Dark-First Excellence** — Optimized for dark mode with refined light mode
5. **Accessibility** — WCAG AA compliant, full keyboard navigation, screen reader support

### Visual Identity: "Aether"
- **Metaphor**: Floating interface elements in a cosmic void — ethereal yet grounded
- **Personality**: Professional, intelligent, trustworthy, modern
- **Mood**: Calm precision with moments of vibrant energy

---

## 2. Color System

### Primary Palette: "Cosmic Indigo"
```
--aether-void:        #090910    /* Deepest background */
--aether-base:        #0D0D18    /* Primary surface */
--aether-elevated:    #13131F    /* Elevated cards */
--aether-raised:      #18182A    /* Raised elements */
--aether-glass:       rgba(255, 255, 255, 0.03)   /* Glass effect */
--aether-glass-hover: rgba(255, 255, 255, 0.06)   /* Glass hover */
--aether-border:      rgba(255, 255, 255, 0.06)   /* Subtle borders */
--aether-border-soft: rgba(255, 255, 255, 0.04)   /* Softer borders */
```

### Accent Colors
```
--aether-primary:     #7C6FFF    /* Cosmic Indigo - primary actions */
--aether-primary-glow: rgba(124, 111, 255, 0.25)
--aether-secondary:   #10E3A0    /* Mint - success, active states */
--aether-accent:      #FF6B8A    /* Coral - notifications, alerts */
--aether-warning:     #FFB347    /* Amber - warnings */
--aether-info:        #4ECDC4    /* Teal - information */
```

### Text Hierarchy
```
--text-primary:       #F0F0F8    /* Primary text - high contrast */
--text-secondary:     #9090B0    /* Secondary text */
--text-tertiary:      #606080    /* Tertiary/muted text */
--text-inverse:       #0D0D18    /* Text on light backgrounds */
--text-disabled:      #404060    /* Disabled state */
```

### Semantic Colors
```
--status-online:      #10E3A0    /* System online, success */
--status-busy:        #FFB347    /* Processing, warning */
--status-error:       #FF6B8A    /* Errors, critical */
--status-idle:        #4ECDC4    /* Idle, info */

--success-surface:    rgba(16, 227, 160, 0.08)
--success-border:     rgba(16, 227, 160, 0.20)
--warning-surface:    rgba(255, 179, 71, 0.08)
--warning-border:     rgba(255, 179, 71, 0.20)
--error-surface:      rgba(255, 107, 138, 0.08)
--error-border:       rgba(255, 107, 138, 0.20)
--info-surface:       rgba(78, 205, 196, 0.08)
--info-border:        rgba(78, 205, 196, 0.20)
```

### Light Mode Overrides
```
--aether-void:        #F8F8FC
--aether-base:        #FFFFFF
--aether-elevated:    #FAFAFC
--aether-raised:      #F4F4F8
--aether-glass:       rgba(0, 0, 0, 0.02)
--aether-border:      rgba(0, 0, 0, 0.08)

--text-primary:       #1A1A2E
--text-secondary:     #5C5C7A
--text-tertiary:      #9090A8

--aether-primary:     #5B4EE8
```

---

## 3. Typography

### Font Stack
```css
--font-display:   'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
--font-sans:      'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
--font-mono:      'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
```

### Type Scale
```
--text-xxs:       10px / 1.4    /* Badges, timestamps */
--text-xs:        11px / 1.5    /* Captions, hints */
--text-sm:        13px / 1.5    /* Secondary content */
--text-base:      14px / 1.6    /* Body text */
--text-lg:        16px / 1.5    /* Subheadings */
--text-xl:        20px / 1.4    /* Section titles */
--text-2xl:       24px / 1.3    /* Page titles */
--text-3xl:       30px / 1.2    /* Hero headings */
--text-stat:      36px / 1.1    /* Statistics display */
```

### Type Weights
```
--weight-normal:   400
--weight-medium:   500
--weight-semibold: 600
--weight-bold:     700
```

---

## 4. Spacing System

### Base Unit: 4px
```
--space-0:    2px     /* Micro spacing */
--space-1:    4px     /* Tight spacing */
--space-2:    8px     /* Small spacing */
--space-3:    12px    /* Default small */
--space-4:    16px    /* Default medium */
--space-5:    20px    /* Default large */
--space-6:    24px    /* Section spacing */
--space-8:    32px    /* Large section */
--space-10:   40px    /* Extra large */
--space-12:   48px    /* Section gap */
--space-16:   64px    /* Major sections */
```

### Radius System
```
--radius-sm:   4px     /* Small elements */
--radius-md:   8px     /* Buttons, inputs */
--radius-lg:   12px    /* Cards */
--radius-xl:   16px    /* Modals, panels */
--radius-2xl:  20px    /* Large containers */
--radius-full: 9999px  /* Pills, avatars */
```

---

## 5. Shadows & Effects

### Elevation System
```
--shadow-sm:    0 1px 2px rgba(0, 0, 0, 0.3)
--shadow-md:    0 4px 12px rgba(0, 0, 0, 0.35)
--shadow-lg:    0 8px 28px rgba(0, 0, 0, 0.4)
--shadow-xl:    0 16px 48px rgba(0, 0, 0, 0.5)

--shadow-glow:      0 0 0 1px var(--aether-primary-glow)
--shadow-glow-md:   0 0 20px -4px var(--aether-primary-glow)
--shadow-glow-lg:   0 0 40px -8px var(--aether-primary-glow)
```

### Glass Effect
```css
.glass {
  background: var(--aether-glass);
  backdrop-filter: blur(12px);
  border: 1px solid var(--aether-border);
}
```

---

## 6. Layout System

### Sidebar (240px → 64px collapsed)
```
#sidebar {
  width: var(--sidebar-width);
  background: linear-gradient(180deg, var(--aether-elevated) 0%, var(--aether-base) 100%);
  border-right: 1px solid var(--aether-border);
}
```

### Main Content Area
```
#main-col {
  background: var(--aether-base);
}

#content {
  background: 
    radial-gradient(ellipse 80% 50% at 50% -20%, rgba(124, 111, 255, 0.03) 0%, transparent 50%),
    var(--aether-base);
}
```

### Page Structure
```
.page {
  padding: var(--space-8) clamp(var(--space-6), 3vw, var(--space-12));
  max-width: 1400px;
}

.page-header {
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-4);
}
```

### Grid System
```
.grid-auto:     grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
.grid-2:        grid-template-columns: repeat(2, 1fr);
.grid-3:        grid-template-columns: repeat(3, 1fr);
.grid-4:        grid-template-columns: repeat(4, 1fr);
.grid-dashboard: grid-template-columns: repeat(12, 1fr);
```

---

## 7. Component Specifications

### 7.1 Buttons

#### Primary Button
```css
.btn-primary {
  background: linear-gradient(135deg, var(--aether-primary) 0%, #9585FF 100%);
  border: 1px solid transparent;
  color: white;
  box-shadow: 0 2px 8px rgba(124, 111, 255, 0.3);
  transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(124, 111, 255, 0.4);
}
.btn-primary:active {
  transform: translateY(0) scale(0.98);
}
```

#### Secondary Button
```css
.btn-secondary {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border);
  color: var(--text-secondary);
  transition: all 150ms ease;
}
.btn-secondary:hover {
  background: var(--aether-raised);
  border-color: var(--aether-primary);
  color: var(--text-primary);
}
```

#### Ghost Button
```css
.btn-ghost {
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
}
.btn-ghost:hover {
  background: var(--aether-glass);
  color: var(--text-primary);
}
```

#### Danger Button
```css
.btn-danger {
  background: var(--error-surface);
  border: 1px solid var(--error-border);
  color: var(--status-error);
}
.btn-danger:hover {
  background: rgba(255, 107, 138, 0.15);
}
```

#### Button States
- **Loading**: Spinner replaces icon, 70% opacity
- **Disabled**: 35% opacity, cursor not-allowed
- **Focus**: 2px solid ring with 2px offset, glow effect

### 7.2 Cards

#### Base Card
```css
.card {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border-soft);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
  transition: all 250ms cubic-bezier(0.22, 1, 0.36, 1);
}
.card:hover {
  border-color: var(--aether-border);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
```

#### Interactive Card (Clickable)
```css
.card-interactive {
  cursor: pointer;
}
.card-interactive:focus-visible {
  outline: 2px solid var(--aether-primary);
  outline-offset: 2px;
  box-shadow: var(--shadow-glow-md);
}
```

#### Stat Card
```css
.stat-card {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border-soft);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--aether-primary), var(--aether-secondary));
  opacity: 0;
  transition: opacity 250ms ease;
}
.stat-card:hover::before {
  opacity: 1;
}
```

### 7.3 Forms

#### Input Field
```css
.input, .form-input {
  width: 100%;
  min-height: 42px;
  padding: 10px 14px;
  background: var(--aether-void);
  border: 1px solid var(--aether-border);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  font-size: var(--text-base);
  transition: all 150ms ease;
}
.input:hover {
  border-color: rgba(124, 111, 255, 0.3);
}
.input:focus {
  border-color: var(--aether-primary);
  box-shadow: 0 0 0 3px var(--aether-primary-glow);
  background: var(--aether-base);
}
```

#### Form Label
```css
.form-label {
  display: block;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: var(--space-2);
  transition: color 150ms ease;
}
.form-group:focus-within .form-label {
  color: var(--aether-primary);
}
```

#### Form Hint/Error
```css
.form-hint {
  font-size: var(--text-xs);
  color: var(--text-tertiary);
  margin-top: var(--space-1);
}
.form-error {
  font-size: var(--text-xs);
  color: var(--status-error);
  margin-top: var(--space-1);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
```

### 7.4 Tabs
```css
.tab-bar {
  display: flex;
  gap: var(--space-0);
  border-bottom: 1px solid var(--aether-border);
  overflow-x: auto;
  scrollbar-width: none;
}
.tab {
  min-height: 40px;
  padding: 0 var(--space-4);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: all 150ms ease;
}
.tab:hover {
  color: var(--text-primary);
}
.tab.active {
  color: var(--aether-primary);
  border-bottom-color: var(--aether-primary);
}
```

### 7.5 Badges
```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 22px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
}
.badge-primary {
  background: rgba(124, 111, 255, 0.15);
  color: var(--aether-primary);
}
.badge-success {
  background: var(--success-surface);
  color: var(--status-online);
}
.badge-warning {
  background: var(--warning-surface);
  color: var(--status-busy);
}
.badge-error {
  background: var(--error-surface);
  color: var(--status-error);
}
```

### 7.6 Toggle Switch
```css
.toggle-switch {
  position: relative;
  width: 44px;
  height: 24px;
}
.toggle-slider {
  position: absolute;
  inset: 0;
  cursor: pointer;
  border-radius: var(--radius-full);
  background: var(--aether-border);
  transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-slider::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: white;
  box-shadow: var(--shadow-sm);
  transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.toggle-switch input:checked + .toggle-slider {
  background: var(--aether-primary);
}
.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(20px);
}
```

### 7.7 Modal
```css
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(9, 9, 16, 0.8);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: var(--z-modal);
  animation: fadeIn 150ms ease;
}
.modal {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  min-width: min(400px, calc(100vw - 32px));
  max-width: 560px;
  max-height: calc(100vh - 60px);
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl), 0 0 60px rgba(124, 111, 255, 0.1);
  animation: modalIn 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

### 7.8 Toast
```css
.toast-container {
  position: fixed;
  top: var(--space-4);
  right: var(--space-4);
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.toast {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border);
  box-shadow: var(--shadow-lg);
  animation: slideIn 250ms cubic-bezier(0.22, 1, 0.36, 1);
  max-width: 400px;
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.toast-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.toast.success {
  border-left: 3px solid var(--status-online);
}
.toast.error {
  border-left: 3px solid var(--status-error);
}
.toast.warning {
  border-left: 3px solid var(--status-busy);
}
.toast.info {
  border-left: 3px solid var(--status-idle);
}
```

### 7.9 Empty State
```css
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-12) var(--space-6);
}
.empty-state-icon {
  width: 64px;
  height: 64px;
  margin-bottom: var(--space-4);
  color: var(--text-tertiary);
  opacity: 0.5;
}
.empty-state-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
.empty-state-desc {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  max-width: 400px;
  margin-bottom: var(--space-4);
}
```

---

## 8. Navigation

### Sidebar Navigation
```css
.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 40px;
  padding: var(--space-2) var(--space-3);
  margin: 2px var(--space-2);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 150ms ease;
}
.nav-item:hover {
  background: var(--aether-glass);
  color: var(--text-primary);
}
.nav-item.active {
  background: linear-gradient(135deg, rgba(124, 111, 255, 0.1) 0%, rgba(124, 111, 255, 0.05) 100%);
  color: var(--aether-primary);
  border-color: rgba(124, 111, 255, 0.2);
  box-shadow: inset 3px 0 0 var(--aether-primary);
}
.nav-item svg {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.nav-badge {
  margin-left: auto;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: var(--radius-full);
  background: var(--aether-primary);
  color: white;
  font-size: 10px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### Section Headers
```css
.nav-section-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
  padding: var(--space-4) var(--space-4) var(--space-2);
  cursor: pointer;
  user-select: none;
}
.nav-section-title::before {
  content: '';
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-tertiary);
  transition: all 150ms ease;
}
.nav-section-title:hover::before {
  background: var(--aether-primary);
  box-shadow: 0 0 8px var(--aether-primary-glow);
}
```

---

## 9. Dashboard Components

### Command Center (Hero Widget)
```css
.command-center {
  background: linear-gradient(135deg, var(--aether-elevated) 0%, rgba(124, 111, 255, 0.05) 100%);
  border: 1px solid var(--aether-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  margin-bottom: var(--space-6);
  position: relative;
  overflow: hidden;
}
.command-center::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 400px;
  height: 400px;
  background: radial-gradient(circle, rgba(124, 111, 255, 0.08) 0%, transparent 70%);
  pointer-events: none;
}
```

### Status Indicators
```css
.status-indicator {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  font-size: var(--text-xs);
  font-weight: 500;
}
.status-indicator.online {
  background: var(--success-surface);
  color: var(--status-online);
}
.status-indicator.busy {
  background: var(--warning-surface);
  color: var(--status-busy);
}
.status-indicator.error {
  background: var(--error-surface);
  color: var(--status-error);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.status-dot.online {
  background: var(--status-online);
  box-shadow: 0 0 8px var(--status-online);
}
.status-dot.busy {
  background: var(--status-busy);
  animation: pulse 2s infinite;
}
.status-dot.error {
  background: var(--status-error);
}
```

### Quick Actions Grid
```css
.quick-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-3);
}
.quick-action {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border-soft);
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 200ms cubic-bezier(0.22, 1, 0.36, 1);
}
.quick-action:hover {
  border-color: var(--aether-primary);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.quick-action-icon {
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-md);
  background: var(--aether-glass);
  color: var(--aether-primary);
}
.quick-action-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-primary);
}
```

---

## 10. Chat Interface

### Chat Sidebar
```css
.chat-sidebar {
  width: 280px;
  background: var(--aether-elevated);
  border-right: 1px solid var(--aether-border);
  display: flex;
  flex-direction: column;
}
.chat-sidebar-header {
  padding: var(--space-4);
  border-bottom: 1px solid var(--aether-border);
}
.chat-session-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  cursor: pointer;
  border-left: 2px solid transparent;
  transition: all 150ms ease;
}
.chat-session-item:hover {
  background: var(--aether-glass);
}
.chat-session-item.active {
  background: rgba(124, 111, 255, 0.08);
  border-left-color: var(--aether-primary);
}
```

### Chat Messages
```css
.message-bubble {
  max-width: 80%;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  line-height: 1.6;
  animation: messageIn 300ms cubic-bezier(0.22, 1, 0.36, 1);
}
.message-user {
  background: linear-gradient(135deg, var(--aether-primary) 0%, #9585FF 100%);
  color: white;
  border-bottom-right-radius: var(--radius-sm);
  margin-left: auto;
}
.message-assistant {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border-soft);
  color: var(--text-primary);
  border-bottom-left-radius: var(--radius-sm);
}
```

### Chat Input
```css
.chat-input-wrapper {
  padding: var(--space-4);
  background: var(--aether-elevated);
  border-top: 1px solid var(--aether-border);
}
.chat-input {
  width: 100%;
  min-height: 48px;
  max-height: 200px;
  padding: var(--space-3) var(--space-4);
  background: var(--aether-void);
  border: 1px solid var(--aether-border);
  border-radius: var(--radius-lg);
  color: var(--text-primary);
  font-size: var(--text-base);
  resize: none;
  transition: all 150ms ease;
}
.chat-input:focus {
  border-color: var(--aether-primary);
  box-shadow: 0 0 0 3px var(--aether-primary-glow);
}
.chat-send-btn {
  position: absolute;
  right: var(--space-4);
  bottom: var(--space-4);
  width: 40px;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--aether-primary);
  color: white;
  border: none;
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: all 150ms ease;
}
.chat-send-btn:hover {
  transform: scale(1.05);
  box-shadow: var(--shadow-glow-md);
}
```

---

## 11. Animations

### Entrance Animations
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideIn {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scaleIn {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes messageIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### Loading Animations
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    var(--aether-void) 25%,
    var(--aether-glass) 50%,
    var(--aether-void) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.8s ease-in-out infinite;
}
```

### Micro-interactions
```css
/* Button press */
.btn:active {
  transform: scale(0.97);
  transition: transform 100ms ease;
}

/* Card hover lift */
.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-lg);
}

/* Nav item slide */
.nav-item:hover svg {
  transform: translateX(2px);
}

/* Tab indicator */
.tab {
  position: relative;
}
.tab::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 50%;
  width: 0;
  height: 2px;
  background: var(--aether-primary);
  transition: all 200ms ease;
  transform: translateX(-50%);
}
.tab.active::after {
  width: 100%;
}
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 12. Accessibility

### Focus States
```css
:focus-visible {
  outline: 2px solid var(--aether-primary);
  outline-offset: 2px;
  box-shadow: var(--shadow-glow);
}
```

### Skip Link
```css
.skip-link {
  position: absolute;
  top: -100px;
  left: var(--space-2);
  z-index: var(--z-max);
  padding: var(--space-2) var(--space-4);
  background: var(--aether-primary);
  color: white;
  border-radius: var(--radius-md);
  font-weight: 600;
  text-decoration: none;
  transition: top 150ms ease;
}
.skip-link:focus {
  top: var(--space-2);
}
```

### Screen Reader Only
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Color Contrast
- Primary text: 12.5:1 contrast ratio
- Secondary text: 5.2:1 contrast ratio (WCAG AA)
- Interactive elements: 4.5:1 minimum contrast ratio

---

## 13. Responsive Breakpoints

```css
/* Mobile: ≤768px */
@media (max-width: 768px) {
  :root {
    --sidebar-width: 100%;
  }
  #sidebar {
    position: fixed;
    z-index: var(--z-drawer);
    transform: translateX(-100%);
    transition: transform 250ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  #sidebar.open {
    transform: translateX(0);
  }
  .page {
    padding: var(--space-4);
  }
  .stat-cards {
    grid-template-columns: 1fr;
  }
}

/* Tablet: 769px – 1024px */
@media (min-width: 769px) and (max-width: 1024px) {
  :root {
    --sidebar-width: 200px;
  }
  .page {
    padding: var(--space-4) clamp(var(--space-4), 2.5vw, var(--space-6));
  }
}

/* Desktop: ≥1025px */
@media (min-width: 1025px) {
  :root {
    --sidebar-width: 240px;
  }
}

/* Large Desktop: ≥1440px */
@media (min-width: 1440px) {
  :root {
    --sidebar-width: 260px;
  }
  .page {
    max-width: 1600px;
  }
}
```

---

## 14. Implementation Notes

### File Structure
```
src/
├── style/
│   ├── variables.css      # Design tokens (colors, typography, spacing)
│   ├── layout.css         # Layout system (sidebar, main, page)
│   ├── components.css     # Component styles
│   ├── pages.css          # Page-specific styles
│   └── animations.css     # Animation keyframes
```

### Migration Strategy
1. **Phase 1**: Update `variables.css` with new design tokens
2. **Phase 2**: Update `layout.css` with new layout system
3. **Phase 3**: Update `components.css` with new component styles
4. **Phase 4**: Update page-specific styles
5. **Phase 5**: Add animations and micro-interactions
6. **Phase 6**: Test accessibility and responsive behavior

### Key Improvements
- Glass morphism effects for depth
- Gradient accents for visual interest
- Consistent border radius system
- Improved shadow hierarchy
- Smooth micro-interactions
- Enhanced accessibility features
- Better responsive behavior

---

## 15. Color Token Migration Map

| Old Token | New Token | Notes |
|-----------|-----------|-------|
| `--brand` | `--aether-primary` | Primary brand color |
| `--bg-base` | `--aether-base` | Main background |
| `--bg-elevated` | `--aether-elevated` | Card backgrounds |
| `--text-1` | `--text-primary` | Primary text |
| `--text-2` | `--text-secondary` | Secondary text |
| `--text-3` | `--text-tertiary` | Muted text |
| `--border-1` | `--aether-border` | Borders |
| `--success` | `--status-online` | Success states |
| `--error` | `--status-error` | Error states |
| `--warning` | `--status-busy` | Warning states |
| `--info` | `--status-idle` | Info states |

---

*Design System v2.0 — Aether Interface*