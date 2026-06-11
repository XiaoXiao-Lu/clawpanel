# ChatCraw UI Redesign — "Aether Interface"

## Overview

This document outlines a comprehensive UI/UX redesign for ChatCraw (ClawPanel), introducing the **"Aether Interface"** design system — a refined, layered, fluid design with cosmic indigo accents, glass morphism effects, and modern interactions.

---

## Design Philosophy

### Core Principles

1. **Layered Depth** — Multi-layer interface with glass morphism, subtle shadows, and depth hierarchy
2. **Fluid Motion** — Smooth micro-interactions with purposeful animation using spring easing
3. **Information Density** — Clean data presentation without overwhelming the user
4. **Dark-First Excellence** — Optimized for dark mode with refined light mode support
5. **Accessibility** — WCAG AA compliant, full keyboard navigation, screen reader support

### Visual Identity: "Aether"

- **Metaphor**: Floating interface elements in a cosmic void — ethereal yet grounded
- **Personality**: Professional, intelligent, trustworthy, modern
- **Mood**: Calm precision with moments of vibrant energy

---

## Color System

### Primary Palette: "Cosmic Indigo"

| Token | Value (Dark) | Value (Light) | Usage |
|-------|-------------|---------------|-------|
| `--aether-void` | `#090910` | `#F8F8FC` | Deepest background |
| `--aether-base` | `#0D0D18` | `#FFFFFF` | Primary surface |
| `--aether-elevated` | `#13131F` | `#FAFAFC` | Cards, modals |
| `--aether-raised` | `#18182A` | `#F4F4F8` | Hover states |
| `--aether-primary` | `#7C6FFF` | `#5B4EE8` | Primary actions |
| `--aether-secondary` | `#10E3A0` | `#0EBB8A` | Success, active states |

### Semantic Colors

| Token | Value | Usage |
|-------|-------|-------|
| `--status-online` | `#10E3A0` | Online, success |
| `--status-busy` | `#FFB347` | Processing, warning |
| `--status-error` | `#FF6B8A` | Errors, critical |
| `--status-idle` | `#4ECDC4` | Idle, info |

### Text Hierarchy

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `#F0F0F8` / `#1A1A2E` | Primary text |
| `--text-secondary` | `#9090B0` / `#5C5C7A` | Secondary text |
| `--text-tertiary` | `#606080` / `#9090A8` | Muted text |

---

## Typography

### Font Stack

```css
--font-display: 'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
--font-sans:    'Inter', 'PingFang SC', 'Microsoft YaHei', -apple-system, sans-serif;
--font-mono:    'JetBrains Mono', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
```

### Type Scale

| Token | Size | Usage |
|-------|------|-------|
| `--text-xxs` | 10px | Badges, timestamps |
| `--text-xs` | 11px | Captions, hints |
| `--text-sm` | 13px | Secondary content |
| `--text-base` | 14px | Body text |
| `--text-lg` | 16px | Subheadings |
| `--text-xl` | 20px | Section titles |
| `--text-2xl` | 24px | Page titles |
| `--text-3xl` | 30px | Hero headings |

---

## Spacing System

Base unit: **4px**

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Tight spacing |
| `--space-2` | 8px | Small spacing |
| `--space-3` | 12px | Default small |
| `--space-4` | 16px | Default medium |
| `--space-5` | 20px | Default large |
| `--space-6` | 24px | Section spacing |
| `--space-8` | 32px | Large section |
| `--space-10` | 40px | Extra large |
| `--space-12` | 48px | Section gap |

---

## Component Highlights

### Buttons

**Primary Button**
- Gradient background with glow effect
- Hover: lift + intensified shadow
- Active: scale down to 98%

```css
.btn-primary {
  background: var(--brand-gradient);
  box-shadow: 0 2px 8px rgba(124, 111, 255, 0.3);
}
.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(124, 111, 255, 0.4);
}
```

### Cards

- Subtle left accent bar on hover
- Smooth elevation transition
- Border color shift on interaction

```css
.card {
  background: var(--aether-elevated);
  border: 1px solid var(--aether-border-soft);
  transition: all var(--ease-normal);
}
.card:hover {
  border-color: var(--aether-border);
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}
```

### Stat Cards

- Gradient top accent line
- Left border reveal on hover
- Semantic color tones

### Forms

- Floating label highlight on focus
- Smooth border glow animation
- Clear error/success states

### Tabs

- Animated underline indicator
- Smooth width transition
- Color shift on active

### Toggle Switch

- Spring animation on state change
- Larger hit area (44×24px)
- Glow effect on hover

---

## Layout System

### Sidebar (240px → 64px collapsed)

- Gradient background overlay
- Section headers with colored dots
- Icon color coding per navigation item
- Smooth collapse animation

### Main Content

- Subtle radial gradient accent
- Page-level animations
- Responsive breakpoints

### Responsive Breakpoints

| Breakpoint | Sidebar Width | Content Padding |
|------------|--------------|-----------------|
| ≥1440px | 260px | 48px |
| 1025-1439px | 240px | 32px |
| 769-1024px | 200px | 24px |
| ≤768px | 100% (overlay) | 16px |

---

## Animations

### Easing Curves

```css
--ease-fast:    150ms cubic-bezier(0.22, 1, 0.36, 1);
--ease-normal:  250ms cubic-bezier(0.22, 1, 0.36, 1);
--ease-slow:    400ms cubic-bezier(0.22, 1, 0.36, 1);
--ease-spring:  500ms cubic-bezier(0.34, 1.56, 0.64, 1);
```

### Key Animations

| Animation | Usage |
|-----------|-------|
| `fadeIn` | Modal overlay, page load |
| `slideIn` | Toast notifications |
| `slideUp` | Page entrance |
| `scaleIn` | Modal content |
| `messageIn` | Chat messages |
| `skeleton-shine` | Loading states |

### Micro-interactions

- Button press: scale to 97%
- Card hover lift: translateY(-2px)
- Nav icon slide: translateX(2px)
- Tab indicator: width 0 → 100%

---

## Accessibility

### Focus States

```css
:focus-visible {
  outline: 2px solid var(--aether-primary);
  outline-offset: 2px;
  box-shadow: var(--shadow-glow);
}
```

### Screen Reader Support

- Skip navigation link
- ARIA labels on all interactive elements
- Role attributes on containers
- Live regions for dynamic content

### Color Contrast

- Primary text: 12.5:1 (AAA)
- Secondary text: 5.2:1 (AA)
- Interactive elements: 4.5:1 minimum (AA)

### Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## File Structure

```
src/style/
├── variables.css         # Original "Precision Noir" tokens (keep for compatibility)
├── variables-aether.css  # NEW: "Aether Interface" design tokens
├── layout.css            # Original layout styles
├── layout-aether.css     # NEW: Aether layout system
├── components.css        # Original component styles
├── components-aether.css # NEW: Aether components
├── chat.css              # Original chat styles
├── chat-aether.css       # NEW: Aether chat interface
├── pages.css             # Page-specific styles
├── reset.css             # CSS reset
└── ...

docs/
└── design-specification.md  # Complete design specification
```

---

## Migration Guide

### Phase 1: Adopt New Variables

Import the new token file to start using the Aether design system:

```html
<link rel="stylesheet" href="/src/style/variables-aether.css">
```

### Phase 2: Apply Component Styles

Replace or extend existing components:

```html
<link rel="stylesheet" href="/src/style/components-aether.css">
<link rel="stylesheet" href="/src/style/layout-aether.css">
<link rel="stylesheet" href="/src/style/chat-aether.css">
```

### Phase 3: Gradual Page Migration

Update page styles to use new tokens and classes:
- Replace `--brand` → `--aether-primary`
- Replace `--bg-base` → `--aether-base`
- Replace `--text-1` → `--text-primary`
- etc.

### Backward Compatibility

The new CSS files maintain backward compatibility through alias tokens:
- `--accent` → `--aether-primary`
- `--primary` → `--aether-primary`
- `--success` → `--status-online`
- etc.

---

## Key Improvements

### Visual Enhancements

1. **Cosmic Indigo palette** — More refined, less saturated
2. **Glass morphism** — Subtle transparency and blur effects
3. **Gradient accents** — Subtle gradient overlays on cards and buttons
4. **Icon color coding** — Each navigation section has a unique color
5. **Depth hierarchy** — Clear elevation through shadows and backgrounds

### Interaction Enhancements

1. **Spring easing** — More natural, bouncy animations
2. **Hover lift** — Cards elevate on hover
3. **Animated tab indicator** — Smooth sliding underline
4. **Status pulse** — Subtle pulse on active status indicators
5. **Loading shimmer** — Refined skeleton loading animation

### UX Enhancements

1. **Larger touch targets** — 44px minimum on mobile
2. **Better focus states** — Visible, styled focus rings
3. **Improved contrast** — WCAG AA compliance
4. **Responsive improvements** — Better mobile experience
5. **Keyboard navigation** — Full keyboard accessibility

---

## Design Token Migration Map

| Old Token | New Token |
|-----------|-----------|
| `--brand` | `--aether-primary` |
| `--brand-400` | `--aether-primary-light` |
| `--bg-root` | `--aether-void` |
| `--bg-base` | `--aether-base` |
| `--bg-elevated` | `--aether-elevated` |
| `--text-1` | `--text-primary` |
| `--text-2` | `--text-secondary` |
| `--text-3` | `--text-tertiary` |
| `--border-1` | `--aether-border` |
| `--border-2` | `--aether-border-soft` |
| `--success` | `--status-online` |
| `--error` | `--status-error` |
| `--warning` | `--status-busy` |
| `--info` | `--status-idle` |
| `--shadow-sm` | (unchanged) |
| `--shadow-md` | (unchanged) |
| `--shadow-lg` | (unchanged) |

---

## Next Steps

1. **Review** the design specification in `docs/design-specification.md`
2. **Preview** the new CSS files in the codebase
3. **Test** by importing the new stylesheets
4. **Iterate** based on visual feedback
5. **Migrate** pages incrementally

---

*Design System v2.0 — Aether Interface*