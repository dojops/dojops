# UI/UX Design System Redesign

**Scope:** dojops.ai (marketing), dojops-hub (marketplace), dojops-console (dashboard), dojops-doc (documentation)

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
| `--text-secondary`   | `#4B5563` | Labels, captions, hints          |
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

| Token             | Light     | Dark      | Usage                                                    |
| ----------------- | --------- | --------- | -------------------------------------------------------- |
| `--accent`        | `#0EA5E9` | `#38BDF8` | Primary CTA buttons, icons, active states, UI components |
| `--accent-text`   | `#0369A1` | `#7DD3FC` | Accent-colored text: links, active nav labels (AA-safe)  |
| `--accent-hover`  | `#0284C7` | `#0EA5E9` | Hover on accent elements                                 |
| `--accent-subtle` | `#F0F9FF` | `#0C2D48` | Accent tinted backgrounds (badges, highlights)           |
| `--accent-border` | `#BAE6FD` | `#1E5A7E` | Accent-tinted borders                                    |

Accent is a softer, warmer cyan (`#0EA5E9` — sky-500 range) that maintains brand recognition from the original `#00e5ff` neon cyan without the cyberpunk feel.

`--accent` is for buttons, icons, and UI component borders (WCAG 1.4.11 — 3:1). `--accent-text` (`#0369A1` — sky-700) is for readable text on light backgrounds at 4.6:1 contrast. Always use `--accent-text` for links and labels.

**Accent usage rule:** Accent should appear in only three places per screen: primary CTA, active navigation, and links. Everything else uses neutral colors. Target accent coverage under 10% of any given screen to keep the UI clean and premium.

### 1.4 Semantic Colors

| Purpose | Foreground (light/dark) | Background (light/dark) |
| ------- | ----------------------- | ----------------------- |
| Success | `#10B981` / `#34D399`   | `#ECFDF5` / `#0A2922`   |
| Warning | `#F59E0B` / `#FBBF24`   | `#FFFBEB` / `#2A2008`   |
| Error   | `#EF4444` / `#F87171`   | `#FEF2F2` / `#2A0F0F`   |
| Info    | `#0EA5E9` / `#38BDF8`   | `#F0F9FF` / `#0C2D48`   |

### 1.5 Shadow System

Light mode:

```
--shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.04)
--shadow-md:  0 1px 3px rgba(0, 0, 0, 0.04), 0 4px 12px rgba(0, 0, 0, 0.06)
--shadow-lg:  0 2px 6px rgba(0, 0, 0, 0.04), 0 8px 24px rgba(0, 0, 0, 0.08)
--shadow-xl:  0 4px 12px rgba(0, 0, 0, 0.05), 0 16px 40px rgba(0, 0, 0, 0.1)
```

Dark mode (higher opacity — subtle shadows vanish on dark backgrounds):

```
--shadow-sm:  0 1px 2px rgba(0, 0, 0, 0.06)
--shadow-md:  0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 12px rgba(0, 0, 0, 0.09)
--shadow-lg:  0 2px 6px rgba(0, 0, 0, 0.06), 0 8px 24px rgba(0, 0, 0, 0.12)
--shadow-xl:  0 4px 12px rgba(0, 0, 0, 0.08), 0 16px 40px rgba(0, 0, 0, 0.15)
```

### 1.6 Elevation System

| Level | Shadow        | Component                    |
| ----- | ------------- | ---------------------------- |
| 0     | none          | Page background              |
| 1     | `--shadow-sm` | Cards, table rows            |
| 2     | `--shadow-md` | Dropdowns, popovers          |
| 3     | `--shadow-lg` | Modals, slide-over panels    |
| 4     | `--shadow-xl` | Toasts, floating action bars |

Assign by layer, not by preference. A card is always level 1 — it does not get `--shadow-lg` because it "looks better."

### 1.7 Data Visualization Colors

For charts, graphs, and pipeline visualizations. Ordered for visual distinction.

| Token       | Light     | Dark      |
| ----------- | --------- | --------- |
| `--chart-1` | `#0EA5E9` | `#38BDF8` |
| `--chart-2` | `#10B981` | `#34D399` |
| `--chart-3` | `#F59E0B` | `#FBBF24` |
| `--chart-4` | `#EF4444` | `#F87171` |
| `--chart-5` | `#8B5CF6` | `#A78BFA` |

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

Responsive scaling (mobile, below `sm` breakpoint): `display` scales to 32px, `h1` to 28px, `h2` to 20px. Use `clamp()` for fluid sizing — e.g. `font-size: clamp(2rem, 5vw, 3rem)` for `display`.

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

Tokens skip `--space-7`, `--space-9` through `--space-11`, etc. intentionally — 4px grid lands on these specific values. For spacing needs between tokens, use the nearest lower token. Do not create one-off values outside this scale.

### 2.4 Border Radius

| Token           | Value  | Usage                         |
| --------------- | ------ | ----------------------------- |
| `--radius-sm`   | 6px    | Badges, small buttons, inputs |
| `--radius-md`   | 10px   | Buttons, dropdowns            |
| `--radius-lg`   | 14px   | Cards, modals                 |
| `--radius-xl`   | 20px   | Large cards, hero elements    |
| `--radius-full` | 9999px | Avatars, pills                |

14px card radius is key to the warm feel. Rounder than typical SaaS (6-8px).

### 2.5 Container Widths

| Token             | Value  | Usage                                        |
| ----------------- | ------ | -------------------------------------------- |
| `--container-sm`  | 640px  | Narrow content (auth pages, settings forms)  |
| `--container-md`  | 768px  | Medium content (blog posts, single-column)   |
| `--container-lg`  | 1024px | Standard content area                        |
| `--container-xl`  | 1200px | Marketing sections, wide content             |
| `--container-2xl` | 1280px | Maximum content width (marketing full-bleed) |

Marketing sections use `max-width: 1200px; margin: auto`. Console content fills available space within the sidebar layout.

### 2.6 Icon Sizing

| Size | Token       | Usage                                    |
| ---- | ----------- | ---------------------------------------- |
| 16px | `--icon-sm` | Inline with text, badges                 |
| 20px | `--icon-md` | Inside buttons, form elements            |
| 24px | `--icon-lg` | Navigation items, section headers        |
| 32px | `--icon-xl` | Feature cards, hero elements, stat cards |

All icons use Lucide. Stroke width: 1.5px (default) for 16-24px, 1.25px for 32px.

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

- Sizes: `sm` (32px), `md` (38px default) — matches button sizes for inline pairing. `lg` button (44px) is for standalone CTAs, not inline with inputs
- Background: `--bg-card`
- Border: 1px `--border-secondary`
- Radius: `--radius-sm` (6px)
- Focus: `outline: 2px solid var(--accent-hover); outline-offset: 2px` (see Section 8 for full spec)
- Placeholder: `--text-tertiary` (only when a visible label is present — placeholders must not be the sole descriptor)

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
- Active: `--accent-subtle` background + `--accent-text` text
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
- Sizes: small (`max-width: 480px`), medium (`max-width: 640px`), large (`max-width: 800px`). All use `width: 100%`
- Mobile (below `sm` breakpoint): full-width with 16px horizontal margin

### 3.9 Toasts / Notifications

- Background: `--bg-card` + `--shadow-lg`
- Radius: `--radius-lg`
- Left border: 3px solid, colored by severity
- Position: top-right, slide-in animation

### 3.10 Status Indicators

For execution states, license states, and pipeline steps across console and hub.

| Status  | Color (light/dark)    | Indicator              |
| ------- | --------------------- | ---------------------- |
| Running | `#0EA5E9` / `#38BDF8` | Pulsing dot (2s cycle) |
| Success | `#10B981` / `#34D399` | Solid dot              |
| Failed  | `#EF4444` / `#F87171` | Solid dot              |
| Pending | `#9CA3AF` / `#5A6478` | Hollow ring            |
| Paused  | `#F59E0B` / `#FBBF24` | Solid dot              |

Dot size: 8px. Paired with a `caption`-sized label. The running pulse animation respects `prefers-reduced-motion` (falls back to solid dot).

### 3.11 Terminal Component

Used for the marketing site demo and code/output display across all sites.

- Background: `#0F1117` (same as dark `--bg-primary`)
- Font: JetBrains Mono, 14px, weight 400
- Padding: `--space-4` (16px)
- Radius: `--radius-lg` (14px)
- Border: 1px `--border-primary` (dark values)
- Prompt color: `--accent` (`#0EA5E9`)
- Text color: `#E8EDF5` (dark `--text-primary`)
- Always renders in dark style regardless of page theme

### 3.12 Form Validation States

| State    | Border                   | Background        | Helper text color  |
| -------- | ------------------------ | ----------------- | ------------------ |
| Default  | 1px `--border-secondary` | `--bg-card`       | `--text-tertiary`  |
| Focus    | 2px `--accent-hover`     | `--bg-card`       | `--text-secondary` |
| Error    | 1px `#EF4444`            | Error subtle bg   | `#EF4444`          |
| Success  | 1px `#10B981`            | Success subtle bg | `#10B981`          |
| Disabled | 1px `--border-primary`   | `--bg-secondary`  | `--text-tertiary`  |

Error and success messages appear below the input in `caption` size. Error icon (16px) inline with message.

### 3.13 Empty States

Pattern for dashboard pages with no data (no executions, no connectors, no license keys).

- Centered layout within content area
- Icon: `--icon-xl` (32px), `--text-tertiary`
- Title: `h3`, `--text-primary`
- Description: `body-sm`, `--text-secondary`, max 2 lines
- Action: Primary button (optional)

### 3.14 Loading States

| Type     | Usage                             | Spec                                                                            |
| -------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Skeleton | Page/card content placeholder     | Height matches content, `--radius-sm`, `--bg-secondary`, pulse animation (1.5s) |
| Spinner  | Button loading, inline indicators | 16px or 20px circle, 2px `--accent` stroke, 0.6s rotation                       |
| Progress | File upload, long operations      | 4px height bar, `--bg-secondary` track, `--accent` fill                         |

Skeleton lines: 12px height for text, full-width for first line, 60% for second. Cards use skeleton matching their final layout.

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

Flash-of-incorrect-theme prevention: All three sites use Next.js SSR/SSG. An inline (non-deferred) `<script>` must be placed in the root `<head>` (in `layout.tsx`) to synchronously read `localStorage` and apply `class="dark"` before paint. This prevents the light theme flashing for users with a saved dark preference.

Toggle control placement:

- **dojops.ai:** Navbar, visible toggle (sun/moon icon)
- **dojops-hub:** Navbar (accessible to unauthenticated users)
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

### 6.4 dojops-doc (Documentation)

Reference-focused. Readability and navigation.

- **Layout:** Sidebar (collapsible, 260px) + content area + optional right-side table of contents. Nextra-based
- **Typography:** `body` (15px) for content, `h1`-`h3` for headings. Generous line height (1.7 for body) for long-form reading
- **Motion:** None. Instant page transitions only
- **Color use:** Minimal accent — links and active sidebar items only. Code blocks use terminal component styling (Section 3.11)
- **Logo:** 3D mini person in sidebar header (24px) + "DojOps Docs" text
- **Distinctive elements:** Sidebar navigation with collapse levels, pagefind search, code blocks with copy button, callout boxes (info/warning/tip)

### 6.5 Personality Summary

| Trait            | dojops.ai                           | dojops-hub       | dojops-console      | dojops-doc           |
| ---------------- | ----------------------------------- | ---------------- | ------------------- | -------------------- |
| Max heading      | `display` 48px                      | `h1` 36px        | `h1` 36px           | `h1` 36px            |
| Motion           | Scroll reveals, typing, floating bg | Card hovers only | Near zero           | None                 |
| Section spacing  | 96px                                | 48px             | 32px                | 32px                 |
| Color expression | Subtle gradients, accent glows      | Conservative     | Minimal             | Minimal (links only) |
| Primary pattern  | Full-width sections                 | Card grids       | Tables + stat cards | Sidebar + prose      |
| Logo size        | 40-48px                             | 28px             | 24px                | 24px                 |
| Body text size   | `body` 15px                         | `body-sm` 14px   | `body-sm` 14px      | `body` 15px          |

---

## 7. Tailwind v4 Integration

All three sites use Tailwind v4 with CSS-first configuration. Design tokens must be registered in the `@theme` block to be usable as utility classes.

```css
@import "tailwindcss";

@theme inline {
  /* Colors — `inline` ensures utilities emit var() references resolved at
     paint time, so dark mode switching via .dark class works correctly. */
  --color-bg-primary: var(--bg-primary);
  --color-bg-secondary: var(--bg-secondary);
  --color-bg-card: var(--bg-card);
  --color-bg-card-hover: var(--bg-card-hover);
  --color-border-primary: var(--border-primary);
  --color-border-secondary: var(--border-secondary);
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-tertiary: var(--text-tertiary);
  --color-accent: var(--accent);
  --color-accent-text: var(--accent-text);
  --color-accent-hover: var(--accent-hover);
  --color-accent-subtle: var(--accent-subtle);
  --color-accent-border: var(--accent-border);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* Shadows — use Tailwind's built-in shadow scale.
     Custom shadow tokens from Section 1.5 live in :root / .dark
     and are used via shadow-[var(--shadow-sm)] when needed.
     Do NOT re-declare them here — @theme resolves at build time
     and cannot forward-reference runtime CSS variables. */

  /* Fonts */
  --font-sans: "Plus Jakarta Sans", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
}
```

This enables utilities like `bg-bg-card`, `text-accent-text`, `rounded-lg`, `shadow-md`, `font-sans`. Dark mode switches via `@variant dark` which reads the `.dark` class.

---

## 8. Focus States

All interactive elements use `:focus-visible` (not `:focus`) to avoid showing focus rings on mouse clicks.

```css
:focus-visible {
  outline: 2px solid var(--accent-hover); /* light: #0284C7, 3.4:1 on white — meets 1.4.11 */
  outline-offset: 2px;
}
.dark :focus-visible {
  outline-color: var(--accent); /* dark: #38BDF8, passes on dark backgrounds */
}
```

- **Buttons:** `outline-offset: 2px`. Ghost buttons on `--bg-secondary` backgrounds need this offset to stay visible
- **Inputs:** Same ring, already specified in Section 3.3
- **Sidebar nav items:** Same ring
- **Modal close buttons:** Same ring
- **Cards (if clickable):** Same ring, on the card element

---

## 9. Domain-Specific Patterns

### 9.1 Pipeline Visualization

Reusable across marketing (feature showcase), console (execution timeline), and docs (architecture diagrams).

- **Node:** 40px circle or 32px rounded square, `--bg-card` fill, 2px border colored by status
- **Edge:** 2px line, `--border-secondary`, horizontal or stepped path
- **Active node:** `--accent` border + `--accent-subtle` fill
- **Error node:** Error foreground border + error subtle fill
- **Success node:** Success foreground border + success subtle fill
- **Label:** `caption` size, centered below node
- **Flow direction:** Left to right on desktop, top to bottom on mobile (below `md` breakpoint)

Example pipeline: Goal → Planner → TaskGraph → Executor → Verify → Execute → Audit

### 9.2 Connector Branding

For hub package cards and console connector management. External service logos (GitHub, GitLab, Jira, etc.) need consistent framing.

- **Connector icon:** 24px, displayed at native colors (not tinted)
- **Connector card:** Standard card (Section 3.2) + connector icon in top-left + service name in `h4`
- **Connector badge:** 20px icon + service name in `caption`, `--bg-secondary` pill background
- External logos are never recolored to match the accent — they keep their brand colors

---

## 10. Migration Notes

### 10.1 What Changes

- **Color palette:** Cyberpunk neon → warm light-first with soft cyan accent
- **Backgrounds:** Pure black `#050508` → light `#FAFBFC` (default), deep slate `#0F1117` (dark)
- **Font:** Sora → Plus Jakarta Sans (body/headings). JetBrains Mono stays for code
- **Borders:** Glass borders (`rgba(0,200,255,0.06)`) → solid subtle borders (`#E5E7EB`)
- **Shadows:** Glow effects → soft multi-layer shadows
- **Radius:** Mixed → consistent system (6/10/14/20px)
- **Cards:** Glass morphism → clean card with border + shadow
- **Animations:** Reduce from 18 keyframes to 5. Remove neon pulse, glow breathe, shimmer
- **Dark mode:** Was only mode → becomes opt-in toggle, light is default

### 10.2 What Stays

- **Logo:** `/icons/dojops-3d-icon.png` (3D mini person) — unchanged
- **Code font:** JetBrains Mono — unchanged
- **Tailwind v4** — unchanged
- **Component structure:** Same React components, restyled
- **Lucide icons** — unchanged
- **Responsive breakpoints:** sm/md/lg/xl — unchanged

### 10.3 Migration Order

1. **Shared tokens** — Create CSS variable file with light/dark tokens
2. **dojops.ai** — Highest visibility, sets the new tone
3. **dojops-hub** — Apply shared tokens + restyle components
4. **dojops-console** — Apply shared tokens + restyle dashboard
5. **dojops-doc** — Apply shared tokens + restyle Nextra theme

Each site is a separate repo with its own `globals.css`, so migrations are independent and can be done in parallel.

---

## 11. Accessibility

- All text meets WCAG 2.1 AA contrast (4.5:1 body, 3:1 large text)
- `--text-primary` (#111827) on `--bg-primary` (#FAFBFC): 17.5:1 (passes AAA)
- `--text-secondary` (#4B5563) on `--bg-primary` (#FAFBFC): 6.0:1 (passes AA)
- `--accent` (#0EA5E9) on white: 2.6:1 — approved for filled buttons (solid bg provides context), icons, and decorative elements only. Does not meet 3:1 for UI component boundaries; use `--accent-hover` (#0284C7) for borders where 3:1 is required. Not for body text
- `--accent-text` (#0369A1) on white: 4.6:1 — use for all accent-colored text (links, active labels)
- `--accent-text` dark (#7DD3FC) on `--bg-primary` dark (#0F1117): 9.6:1 (passes AAA)
- `--text-tertiary` (#9CA3AF): 2.6:1 on white — approved only when a visible label is present (WCAG SC 1.4.3 exempts disabled states; placeholder text requires an associated label)
- Focus states: `outline: 2px solid var(--accent-hover); outline-offset: 2px` via `:focus-visible`; dark mode uses `--accent` (see Section 8)
- `prefers-reduced-motion`: all animations disabled
- `prefers-color-scheme`: initial theme detection, with inline script for flash prevention (see Section 5)
- Interactive targets: minimum 32px (touch), 24px (pointer)
