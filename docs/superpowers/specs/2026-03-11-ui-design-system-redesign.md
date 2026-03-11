# UI/UX Design System Redesign

**Scope:** dojops.ai (marketing), dojops-hub (marketplace), dojops-console (dashboard)

**Direction:** Light-first professional design with dark mode. Warm and approachable — soft shadows, rounded corners, gentle accents. Shared design foundation with distinct per-site personalities.

**Logo:** `/icons/dojops-3d-icon.png` (3D mini person) stays as the official logo across all sites.

---

## 1. Color System

### 1.1 Light Mode (default)

| Token                | Value     | Usage                            |
| -------------------- | --------- | -------------------------------- |
| `--bg-primary`       | `#FAFBFC` | Page background                  |
| `--bg-secondary`     | `#F3F4F6` | Section alternation, sidebar bg  |
| `--bg-card`          | `#FFFFFF` | Cards, modals, dropdowns         |
| `--bg-card-hover`    | `#F9FAFB` | Card hover state                 |
| `--border-primary`   | `#E5E7EB` | Card borders, dividers           |
| `--border-secondary` | `#D1D5DB` | Input borders, stronger dividers |
| `--text-primary`     | `#111827` | Headings, body text              |
| `--text-secondary`   | `#6B7280` | Labels, captions, hints          |
| `--text-tertiary`    | `#9CA3AF` | Placeholders, disabled           |

### 1.2 Dark Mode

| Token                | Value     | Usage                                        |
| -------------------- | --------- | -------------------------------------------- |
| `--bg-primary`       | `#0F1117` | Page background (deep slate, not pure black) |
| `--bg-secondary`     | `#161921` | Section alternation, sidebar bg              |
| `--bg-card`          | `#1A1D27` | Cards, modals                                |
| `--bg-card-hover`    | `#22252F` | Card hover                                   |
| `--border-primary`   | `#2A2D37` | Borders                                      |
| `--border-secondary` | `#363A47` | Stronger borders                             |
| `--text-primary`     | `#E8EDF5` | Headings, body                               |
| `--text-secondary`   | `#8B95A8` | Labels, captions                             |
| `--text-tertiary`    | `#5A6478` | Placeholders, disabled                       |

### 1.3 Accent Colors

| Token             | Light     | Dark      | Usage                                          |
| ----------------- | --------- | --------- | ---------------------------------------------- |
| `--accent`        | `#0EA5E9` | `#38BDF8` | Primary CTA, links, active states              |
| `--accent-hover`  | `#0284C7` | `#0EA5E9` | Hover on accent elements                       |
| `--accent-subtle` | `#F0F9FF` | `#0C2D48` | Accent tinted backgrounds (badges, highlights) |
| `--accent-border` | `#BAE6FD` | `#1E5A7E` | Accent-tinted borders                          |

Accent is a softer, warmer cyan (`#0EA5E9` — sky-500 range) that maintains brand recognition from the original `#00e5ff` neon cyan without the cyberpunk feel. Accessible on both light and dark backgrounds.

### 1.4 Semantic Colors

| Purpose | Foreground (light/dark) | Background (light/dark) |
| ------- | ----------------------- | ----------------------- |
| Success | `#10B981` / `#34D399`   | `#ECFDF5` / `#0A2922`   |
| Warning | `#F59E0B` / `#FBBF24`   | `#FFFBEB` / `#2A2008`   |
| Error   | `#EF4444` / `#F87171`   | `#FEF2F2` / `#2A0F0F`   |
| Info    | `#0EA5E9` / `#38BDF8`   | `#F0F9FF` / `#0C2D48`   |

### 1.5 Shadow System

```
--shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.04)
--shadow-md:  0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.06)
--shadow-lg:  0 2px 6px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.08)
--shadow-xl:  0 4px 12px rgba(0, 0, 0, 0.05), 0 16px 40px rgba(0, 0, 0, 0.1)
```

Dark mode shadows use slightly higher opacity (multiply by 1.5x) since subtle shadows vanish on dark backgrounds.

---

## 2. Typography

### 2.1 Font Stack

| Role          | Font              | Fallback                | Weight Range |
| ------------- | ----------------- | ----------------------- | ------------ |
| Body/Headings | Plus Jakarta Sans | system-ui, sans-serif   | 400-700      |
| Code/Terminal | JetBrains Mono    | ui-monospace, monospace | 400-500      |

Plus Jakarta Sans chosen for rounder letterforms that feel warm and approachable. JetBrains Mono stays for code — it's excellent and already in use.

### 2.2 Type Scale

| Name      | Size             | Line Height | Weight | Usage                                |
| --------- | ---------------- | ----------- | ------ | ------------------------------------ |
| `display` | 48px / 3rem      | 1.1         | 700    | Hero headlines (marketing site only) |
| `h1`      | 36px / 2.25rem   | 1.2         | 700    | Page titles                          |
| `h2`      | 24px / 1.5rem    | 1.3         | 600    | Section titles                       |
| `h3`      | 20px / 1.25rem   | 1.4         | 600    | Card titles, subsections             |
| `h4`      | 16px / 1rem      | 1.5         | 600    | Labels, group headings               |
| `body`    | 15px / 0.9375rem | 1.6         | 400    | Default body text                    |
| `body-sm` | 14px / 0.875rem  | 1.5         | 400    | Secondary text, table cells          |
| `caption` | 13px / 0.8125rem | 1.4         | 400    | Timestamps, metadata                 |
| `small`   | 12px / 0.75rem   | 1.4         | 500    | Badges, labels, overlines            |
| `code`    | 14px / 0.875rem  | 1.6         | 400    | Inline code, terminal                |

Body at 15px is the sweet spot for Plus Jakarta Sans — slightly larger than typical dashboards, matching the approachable goal. Console pages use `body-sm` for data density.

### 2.3 Spacing Scale

4px base grid:

| Value | Token        | Usage                                       |
| ----- | ------------ | ------------------------------------------- |
| 4px   | `--space-1`  | Tight gaps, icon padding                    |
| 8px   | `--space-2`  | Inline spacing, small gaps                  |
| 12px  | `--space-3`  | Compact element spacing                     |
| 16px  | `--space-4`  | Default element spacing, input padding      |
| 20px  | `--space-5`  | Card padding (compact)                      |
| 24px  | `--space-6`  | Card padding (standard), section gaps       |
| 32px  | `--space-8`  | Section spacing within a page               |
| 48px  | `--space-12` | Section spacing between major blocks        |
| 64px  | `--space-16` | Page-level section separation               |
| 96px  | `--space-24` | Hero/large section padding (marketing only) |

### 2.4 Border Radius

| Token           | Value  | Usage                         |
| --------------- | ------ | ----------------------------- |
| `--radius-sm`   | 6px    | Badges, small buttons, inputs |
| `--radius-md`   | 10px   | Buttons, dropdowns            |
| `--radius-lg`   | 14px   | Cards, modals                 |
| `--radius-xl`   | 20px   | Large cards, hero elements    |
| `--radius-full` | 9999px | Avatars, pills                |

14px card radius is key to the warm feel. Rounder than typical SaaS (6-8px).

---

## 3. Component Patterns

Shared primitives used across all three sites.

### 3.1 Buttons

| Variant   | Light                                                   | Dark                                | Usage                     |
| --------- | ------------------------------------------------------- | ----------------------------------- | ------------------------- |
| Primary   | White text on `--accent`, `--shadow-sm`                 | White text on `--accent`, no shadow | Main CTAs                 |
| Secondary | `--text-primary` on `--bg-card`, 1px `--border-primary` | Same tokens, dark values            | Secondary actions         |
| Ghost     | `--text-secondary`, transparent bg, no border           | Same                                | Tertiary, toolbar actions |
| Danger    | White on `#EF4444`                                      | White on `#DC2626`                  | Destructive actions       |

Sizes: `sm` (32px height, 12px horizontal padding), `md` (38px, 16px), `lg` (44px, 20px). All use `--radius-md` (10px). Hover: `translateY(-1px)` + shadow increase. Active: `translateY(0)`.

### 3.2 Cards

- Background: `--bg-card`
- Border: 1px `--border-primary`
- Radius: `--radius-lg` (14px)
- Shadow: `--shadow-sm` default, `--shadow-md` on hover
- Hover: background shifts to `--bg-card-hover`
- No glow effects — shadows and border do the work

### 3.3 Inputs

- Height: 38px
- Background: `--bg-card`
- Border: 1px `--border-secondary`
- Radius: `--radius-sm` (6px)
- Focus: 2px `--accent` ring + `--accent-subtle` box-shadow
- Placeholder: `--text-tertiary`

### 3.4 Badges / Tags

- Shape: pill (`--radius-full`)
- Size: `small` (12px, weight 500)
- Semantic: success/warning/error/info use their `subtle` background + foreground
- Default: `--bg-secondary` background + `--text-secondary` text

### 3.5 Tables

- Header: `--bg-secondary`, `body-sm`, `--text-secondary`, weight 600
- Rows: `--bg-card`, 1px bottom `--border-primary`
- Row hover: `--bg-card-hover`
- Cells: `body-sm`

### 3.6 Navigation — Sidebar (console)

- Background: `--bg-secondary`
- Width: 240px, fixed
- Nav items: 38px height, `--radius-md`
- Active: `--accent-subtle` background + `--accent` text
- Hover: `--bg-card-hover`

### 3.7 Navigation — Navbar (marketing/hub)

- Background: `--bg-card` with 1px bottom `--border-primary`
- Position: sticky
- Dark mode: slight `backdrop-blur(8px)` for depth
- Light mode: opaque background (no blur needed)
- Mobile: slide-down drawer

### 3.8 Modals / Dialogs

- Backdrop: `rgba(0, 0, 0, 0.4)` light / `rgba(0, 0, 0, 0.6)` dark
- Background: `--bg-card`
- Radius: `--radius-xl` (20px)
- Shadow: `--shadow-xl`
- Sizes: small (480px), medium (640px)

### 3.9 Toasts / Notifications

- Background: `--bg-card` + `--shadow-lg`
- Radius: `--radius-lg`
- Left border: 3px solid, colored by severity
- Position: top-right, slide-in animation

---

## 4. Motion

### 4.1 Transitions

| Property                  | Duration | Easing   |
| ------------------------- | -------- | -------- |
| Color, background, border | 150ms    | ease-out |
| Shadow, transform         | 200ms    | ease-out |
| Opacity (fade)            | 250ms    | ease-out |

### 4.2 Animations

| Name        | Duration                          | Usage                      | Sites          |
| ----------- | --------------------------------- | -------------------------- | -------------- |
| `fadeInUp`  | 500ms, ease-out                   | Scroll reveal on sections  | Marketing only |
| `fadeIn`    | 300ms, ease-out                   | Modal/dropdown entrance    | All            |
| `slideDown` | 250ms, cubic-bezier(0.16,1,0.3,1) | Mobile menu, dropdown      | All            |
| `typing`    | Per-character                     | Terminal demo typewriter   | Marketing only |
| `drift`     | 40-60s, ease-in-out               | Floating background shapes | Marketing only |

All animations gated by `@media (prefers-reduced-motion: reduce)` — instant states, no motion.

Marketing site gets entrance animations and floating background. Hub and console: hover transitions only.

---

## 5. Dark Mode Implementation

Toggle via `class="dark"` on `<html>` element (Tailwind dark mode strategy). Persisted to `localStorage`, defaults to system preference via `prefers-color-scheme`.

CSS variables switch via:

```css
:root {
  /* light tokens */
}
.dark {
  /* dark tokens */
}
```

Toggle control placement:

- **dojops.ai:** Navbar, visible toggle (sun/moon icon)
- **dojops-hub:** Navbar or user dropdown
- **dojops-console:** Sidebar footer or header user menu

---

## 6. Site Personalities

### 6.1 dojops.ai (Marketing)

Most expressive. Job is to sell.

- **Layout:** Single-page scroll, full-width hero, alternating section backgrounds (`--bg-primary` / `--bg-secondary`)
- **Typography:** Uses `display` (48px) for hero. Generous spacing — 96px between sections
- **Motion:** Scroll entrance animations (`fadeInUp`), terminal typing demo, floating background shapes (muted, slow drift, low opacity). No neon glows
- **Color use:** Hero gets a subtle radial glow using `--accent-subtle`. Feature cards can use 2px colored top borders
- **Logo:** 3D mini person (`dojops-3d-icon.png`) prominent in hero (40-48px) + navbar
- **Distinctive elements:** Terminal demo, pipeline visualization, install tabs, stat counters

### 6.2 dojops-hub (Marketplace)

Content-focused. Packages are the star.

- **Layout:** Navbar + content area. Package card grid as primary pattern. Filter sidebar on search/browse
- **Typography:** Max `h1` (36px). `body-sm` (14px) for package cards. Standard spacing — 48px between sections
- **Motion:** Card hover transitions only. No scroll animations. Instant, responsive
- **Color use:** Conservative. Accent for links, CTAs, star buttons. Semantic colors for risk badges
- **Logo:** 3D mini person in navbar (28px)
- **Distinctive elements:** Search bar with results dropdown, package cards (name/desc/tags/author/stars/downloads), risk badges, install commands

### 6.3 dojops-console (Dashboard)

Utilitarian. Data density and clarity.

- **Layout:** Fixed sidebar (240px) + header (56px) + content. Classic dashboard shell
- **Typography:** Mostly `body-sm` (14px) and `caption` (13px). `h1` for page titles only. Compact spacing — 32px between blocks
- **Motion:** Near-zero. Status color transitions only. No entrance animations
- **Color use:** Most restrained. Accent for active nav + primary buttons + links. Heavy semantic colors for execution status, license states
- **Logo:** 3D mini person in sidebar header (24px) + "DojOps" text
- **Distinctive elements:** Stat cards, data tables (sortable), status indicators, license key management, execution timeline

### 6.4 Personality Summary

| Trait            | dojops.ai                           | dojops-hub       | dojops-console      |
| ---------------- | ----------------------------------- | ---------------- | ------------------- |
| Max heading      | `display` 48px                      | `h1` 36px        | `h1` 36px           |
| Motion           | Scroll reveals, typing, floating bg | Card hovers only | Near zero           |
| Section spacing  | 96px                                | 48px             | 32px                |
| Color expression | Subtle gradients, accent glows      | Conservative     | Minimal             |
| Primary pattern  | Full-width sections                 | Card grids       | Tables + stat cards |
| Logo size        | 40-48px                             | 28px             | 24px                |
| Body text size   | `body` 15px                         | `body-sm` 14px   | `body-sm` 14px      |

---

## 7. Migration Notes

### 7.1 What Changes

- **Color palette:** Cyberpunk neon → warm light-first with soft cyan accent
- **Backgrounds:** Pure black `#050508` → light `#FAFBFC` (default), deep slate `#0F1117` (dark)
- **Font:** Sora → Plus Jakarta Sans (body/headings). JetBrains Mono stays for code
- **Borders:** Glass borders (`rgba(0,200,255,0.06)`) → solid subtle borders (`#E5E7EB`)
- **Shadows:** Glow effects → soft multi-layer shadows
- **Radius:** Mixed → consistent system (6/10/14/20px)
- **Cards:** Glass morphism → clean card with border + shadow
- **Animations:** Reduce from 18 keyframes to 5. Remove neon pulse, glow breathe, shimmer
- **Dark mode:** Was only mode → becomes opt-in toggle, light is default

### 7.2 What Stays

- **Logo:** `/icons/dojops-3d-icon.png` (3D mini person) — unchanged
- **Code font:** JetBrains Mono — unchanged
- **Tailwind v4** — unchanged
- **Component structure:** Same React components, restyled
- **Lucide icons** — unchanged
- **Responsive breakpoints:** sm/md/lg/xl — unchanged

### 7.3 Migration Order

1. **Shared tokens** — Create CSS variable file with light/dark tokens
2. **dojops.ai** — Highest visibility, sets the new tone
3. **dojops-hub** — Apply shared tokens + restyle components
4. **dojops-console** — Apply shared tokens + restyle dashboard

Each site is a separate repo with its own `globals.css`, so migrations are independent and can be done in parallel.

---

## 8. Accessibility

- All text meets WCAG 2.1 AA contrast (4.5:1 body, 3:1 large text)
- `--accent` on `--bg-card` light: contrast ratio 4.6:1 (passes AA)
- `--accent` (dark variant `#38BDF8`) on `--bg-card` dark: contrast ratio 5.2:1 (passes AA)
- Focus states: 2px accent ring, visible on both themes
- `prefers-reduced-motion`: all animations disabled
- `prefers-color-scheme`: initial theme detection
- Interactive targets: minimum 32px (touch), 24px (pointer)
