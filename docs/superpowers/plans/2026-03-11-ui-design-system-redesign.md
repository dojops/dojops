# UI/UX Design System Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cyberpunk dark-only theme across dojops.ai, dojops-hub, dojops-console, and dojops-doc with a light-first professional design system featuring warm colors, soft shadows, Plus Jakarta Sans typography, and dark mode toggle.

**Architecture:** Each site gets a new `globals.css` built from shared design tokens (CSS variables for light/dark), registered via Tailwind v4 `@theme inline`. Font swap from Sora to Plus Jakarta Sans in each `layout.tsx`. Components restyled in-place — same React structure, new visual language. Dark mode via `.dark` class on `<html>` with localStorage persistence and inline script for flash prevention.

**Tech Stack:** Tailwind CSS v4, CSS custom properties, Plus Jakarta Sans (Google Fonts), Next.js `layout.tsx` for font/theme injection, Nextra theme overrides for docs site.

**Spec:** `docs/superpowers/specs/2026-03-11-ui-design-system-redesign.md`

---

## File Structure

### Shared pattern (applied per-site)

Each site's `globals.css` is rewritten with identical token values. No shared package — each site is an independent repo with its own copy of the design tokens.

### dojops.ai (15 components, 1 CSS file, 1 layout)

| Action  | File                                 | Responsibility                                                |
| ------- | ------------------------------------ | ------------------------------------------------------------- |
| Rewrite | `src/app/globals.css`                | All design tokens, animations, utility classes                |
| Modify  | `src/app/layout.tsx`                 | Font swap (Sora to Plus Jakarta Sans), dark mode script       |
| Modify  | `src/components/Navbar.tsx`          | Light theme styling, dark mode toggle, remove glass morphism  |
| Modify  | `src/components/Hero.tsx`            | Light background, softer accent glow, responsive display size |
| Modify  | `src/components/PipelineFlow.tsx`    | Restyle nodes/edges per spec Section 9.1, remove neon         |
| Modify  | `src/components/InstallSection.tsx`  | Terminal component per spec Section 3.11, clean tabs          |
| Modify  | `src/components/HighlightStats.tsx`  | Card styling per spec Section 3.2, neutral colors             |
| Modify  | `src/components/HowItWorks.tsx`      | Light cards, accent top borders                               |
| Modify  | `src/components/Features.tsx`        | Card restyling, remove glow                                   |
| Modify  | `src/components/ToolsGrid.tsx`       | Clean grid, neutral icon treatment                            |
| Modify  | `src/components/Security.tsx`        | Card restyling                                                |
| Modify  | `src/components/Footer.tsx`          | Light footer, subtle bg                                       |
| Modify  | `src/components/GlowCard.tsx`        | Restyle to clean card (border + shadow, no glow)              |
| Modify  | `src/components/ScrollReveal.tsx`    | Keep fadeInUp, update timing per spec                         |
| Modify  | `src/components/SectionHeading.tsx`  | Text colors to tokens                                         |
| Modify  | `src/components/TerminalDemo.tsx`    | Always-dark terminal per spec Section 3.11                    |
| Modify  | `src/components/FloatingIconsBg.tsx` | Reduce opacity, neutral tones, keep drift                     |
| Modify  | `src/components/CopyButton.tsx`      | Token colors                                                  |
| Modify  | `src/lib/constants.ts`               | No changes needed (content data, not styling)                 |

### dojops-hub (33 components, 1 CSS file, 1 layout)

| Action  | File                                          | Responsibility                               |
| ------- | --------------------------------------------- | -------------------------------------------- |
| Rewrite | `src/app/globals.css`                         | Design tokens, remove glow/glass utilities   |
| Modify  | `src/app/layout.tsx`                          | Font swap, dark mode script, metadata        |
| Modify  | `src/components/layout/Navbar.tsx`            | Light navbar, dark toggle, remove glass blur |
| Modify  | `src/components/layout/Footer.tsx`            | Light footer                                 |
| Modify  | `src/components/ui/Button.tsx`                | 4 variants per spec Section 3.1              |
| Modify  | `src/components/ui/Badge.tsx`                 | Pill shape, semantic colors per spec         |
| Modify  | `src/components/ui/GlowCard.tsx`              | Clean card (border + shadow)                 |
| Modify  | `src/components/ui/SearchBar.tsx`             | Input styling per spec Section 3.3           |
| Modify  | `src/components/ui/Pagination.tsx`            | Token colors                                 |
| Modify  | `src/components/ui/Spinner.tsx`               | Accent stroke per spec Section 3.14          |
| Modify  | `src/components/ui/EmptyState.tsx`            | Per spec Section 3.13                        |
| Modify  | `src/components/package/PackageCard.tsx`      | Card per spec, risk badge                    |
| Modify  | `src/components/package/PackageDetail.tsx`    | Token colors, layout                         |
| Modify  | `src/components/package/PackageGrid.tsx`      | Grid spacing                                 |
| Modify  | `src/components/package/RiskBadge.tsx`        | Semantic badge colors                        |
| Modify  | `src/components/package/InstallCommand.tsx`   | Terminal component style                     |
| Modify  | `src/components/package/VersionHistory.tsx`   | Table styling per spec                       |
| Modify  | `src/components/package/DopsPreview.tsx`      | Code block styling                           |
| Modify  | `src/components/package/IntegrityHash.tsx`    | Mono font, token colors                      |
| Modify  | `src/components/package/PermissionBadges.tsx` | Badge styling                                |
| Modify  | `src/components/publish/PublishForm.tsx`      | Form validation states per spec              |
| Modify  | `src/components/publish/MetadataPreview.tsx`  | Code preview styling                         |
| Modify  | `src/components/community/StarButton.tsx`     | Accent color for active                      |
| Modify  | `src/components/community/CommentThread.tsx`  | Card styling                                 |
| Modify  | `src/components/community/CommentItem.tsx`    | Token colors                                 |
| Modify  | `src/components/community/AuthorBadge.tsx`    | Badge styling                                |
| Modify  | `src/components/user/UserProfile.tsx`         | Token colors                                 |
| Modify  | `src/components/user/UserPackages.tsx`        | Grid styling                                 |
| Modify  | `src/components/user/UserStars.tsx`           | Grid styling                                 |
| Modify  | `src/components/admin/PackageModeration.tsx`  | Table + badge styling                        |
| Modify  | `src/components/settings/TokenManager.tsx`    | Form + table styling                         |
| Modify  | `src/app/page.tsx`                            | Homepage section backgrounds                 |
| Modify  | `src/app/explore/page.tsx`                    | Search page styling                          |
| Modify  | `src/app/auth/signin/page.tsx`                | Light card, remove glass                     |
| Modify  | `src/app/not-found.tsx`                       | Token colors                                 |
| Modify  | `src/app/loading.tsx`                         | Skeleton/spinner per spec                    |

### dojops-console (7 pages, 3 layout components, 1 CSS file)

| Action  | File                                    | Responsibility                                   |
| ------- | --------------------------------------- | ------------------------------------------------ |
| Rewrite | `src/app/globals.css`                   | Design tokens, status classes, remove glass/glow |
| Modify  | `src/app/layout.tsx`                    | Font swap, dark mode script                      |
| Modify  | `src/components/layout/Sidebar.tsx`     | Light sidebar per spec Section 3.6               |
| Modify  | `src/components/layout/Header.tsx`      | Light header, border-bottom                      |
| Modify  | `src/components/layout/UserMenu.tsx`    | Token colors, plan badge                         |
| Modify  | `src/app/dashboard/layout.tsx`          | Background token                                 |
| Modify  | `src/app/dashboard/page.tsx`            | Stat cards, status indicators                    |
| Modify  | `src/app/dashboard/license/page.tsx`    | Form + table styling                             |
| Modify  | `src/app/dashboard/billing/page.tsx`    | Plan cards, table                                |
| Modify  | `src/app/dashboard/executions/page.tsx` | Table + status indicators                        |
| Modify  | `src/app/dashboard/team/page.tsx`       | Token colors                                     |
| Modify  | `src/app/dashboard/settings/page.tsx`   | Token colors                                     |
| Modify  | `src/app/auth/signin/page.tsx`          | Light card                                       |

### dojops-doc (Nextra theme, 1 layout, 1 CSS file to create)

| Action | File                 | Responsibility                                 |
| ------ | -------------------- | ---------------------------------------------- |
| Create | `app/globals.css`    | Design tokens + Nextra theme overrides         |
| Modify | `app/layout.tsx`     | Font swap, import globals.css, theme colors    |
| Modify | `mdx-components.tsx` | Custom code block styling (terminal component) |
| Modify | `package.json`       | Add font dependency if needed                  |

---

## Chunk 1: dojops.ai (Marketing Site)

### Task 1: Rewrite globals.css with design tokens

**Files:**

- Rewrite: `/app/dojops-org/dojops.ai/src/app/globals.css`

- [ ] **Step 1: Replace entire globals.css with new design system**

The new file contains these sections in order:

1. `@import "tailwindcss"`
2. `:root` block with all light mode tokens (bg, border, text, accent, semantic, chart, shadow)
3. `.dark` block with all dark mode token overrides
4. `@theme inline` block registering all tokens for Tailwind utilities
5. Base styles (`html` bg/color, `:focus-visible` ring)
6. Animation keyframes: `fadeInUp`, `fadeIn`, `slideDown`, `typing`, `drift-1/2/3`, `blink`, `pulse-dot`, `spin`, `pulse-skeleton`
7. Animation utility classes: `.animate-fade-in-up`, `.animate-fade-in`, `.animate-slide-down`
8. Utility classes: `.section-divider`, `.terminal`, `.terminal-prompt`, `.cursor-blink`, `.floating-icon`, `.ambient-glow`, `.status-dot`, `.status-dot-pulse`, `.skeleton`, `.noise-overlay`
9. `@media (prefers-reduced-motion: reduce)` disabling all animations

All token values come from the spec Sections 1.1 through 1.7. See spec for exact hex values.

- [ ] **Step 2: Verify the CSS compiles**

Run: `cd /app/dojops-org/dojops.ai && npm run build 2>&1 | head -20`
Expected: Build starts without CSS parse errors

### Task 2: Swap fonts and add dark mode script in layout.tsx

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/app/layout.tsx`

- [ ] **Step 1: Replace Sora import with Plus Jakarta Sans**

Change the font imports:

```typescript
// Before:
import { Sora, JetBrains_Mono } from "next/font/google";
const sora = Sora({ variable: "--font-sora", ... });

// After:
import { Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  display: "swap",
});
```

- [ ] **Step 2: Update body className to use new font variable**

Replace `sora.variable` with `plusJakartaSans.variable` in the body className.

- [ ] **Step 3: Remove `className="dark"` from `<html>` tag**

The page should render in light mode by default. The dark mode script handles the `.dark` class.

- [ ] **Step 4: Add inline dark mode detection script**

Add a `<script>` tag in the `<head>` that synchronously reads `localStorage` for the saved theme preference, or falls back to `prefers-color-scheme`, and applies `class="dark"` to `<html>` before paint. This prevents the flash-of-incorrect-theme on SSG pages. The script content is a static string literal with no user input — it is safe for inline use.

- [ ] **Step 5: Build and verify**

Run: `cd /app/dojops-org/dojops.ai && npm run build 2>&1 | tail -5`
Expected: Build succeeds. No font loading errors.

### Task 3: Restyle Navbar with light theme and dark mode toggle

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/Navbar.tsx`

- [ ] **Step 1: Replace glass morphism with clean navbar**

Replace the navbar container classes:

- Remove: `bg-bg-deep/80 backdrop-blur` or any glass-border references
- Add: `bg-bg-card border-b border-border-primary` for light mode
- Dark mode: `dark:backdrop-blur-sm dark:bg-bg-card/95`
- Position: `sticky top-0 z-50`

- [ ] **Step 2: Update text colors to token classes**

- Nav links: `text-text-secondary hover:text-text-primary`
- Active link: `text-accent-text`
- Logo text: `text-text-primary font-bold`

- [ ] **Step 3: Add dark mode toggle button**

Add a `ThemeToggle` component: `useState` for dark state, `useEffect` to read initial class from `document.documentElement`, toggle function that flips the class and writes to `localStorage`. Render `Sun` icon (from lucide-react) when dark, `Moon` icon when light. Button: `p-2 rounded-md text-text-secondary hover:text-text-primary hover:bg-bg-card-hover transition-colors`.

- [ ] **Step 4: Update mobile drawer styling**

Replace dark glass styling with:

- Background: `bg-bg-card border-b border-border-primary`
- Animation: `animate-slide-down`

- [ ] **Step 5: Verify navbar renders correctly**

Run dev server and check: Light navbar with logo, nav links, dark mode toggle. No neon/glass.

### Task 4: Restyle Hero section

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/Hero.tsx`

- [ ] **Step 1: Replace dark background with light**

- Section background: `bg-bg-primary`
- Ambient glow: Use `.ambient-glow` class (accent-subtle radial gradient)
- Remove any `bg-bg-deep` or `#050508` references

- [ ] **Step 2: Update typography**

- Headline: `text-text-primary` with `display` size. Add responsive clamp: `style={{ fontSize: "clamp(2rem, 5vw, 3rem)" }}`
- Subheadline: `text-text-secondary`
- CTA buttons: Primary button uses `bg-accent text-white`, secondary uses card styling

- [ ] **Step 3: Update 3D logo icon**

Keep `/icons/dojops-3d-icon.png` at 40-48px. Ensure it renders well on light background.

- [ ] **Step 4: Verify**

Visual check: Hero should feel warm and professional on light bg. Dark mode toggle should switch to dark variant.

### Task 5: Restyle GlowCard to clean Card component

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/GlowCard.tsx`

- [ ] **Step 1: Remove glow pseudo-element and glass morphism**

Remove the `::before` gradient mask, glass borders, and glow box-shadows.

- [ ] **Step 2: Apply spec Section 3.2 card styling**

Card container: `bg-bg-card border border-border-primary rounded-[14px]` with `shadow-[var(--shadow-sm)]` default, `hover:shadow-[var(--shadow-md)]` and `hover:bg-bg-card-hover` on hover. Transition: `transition-all duration-200`.

### Task 6: Restyle remaining marketing components

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/Features.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/ToolsGrid.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/Security.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/HowItWorks.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/HighlightStats.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/SectionHeading.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/Footer.tsx`

- [ ] **Step 1: Update SectionHeading** — Title: `text-text-primary`, Subtitle: `text-text-secondary`

- [ ] **Step 2: Update Features, Security, HighlightStats** — All use GlowCard (now clean card). Alternate section bgs: `bg-bg-primary` / `bg-bg-secondary`. Icon colors: `text-accent`. Text: token colors.

- [ ] **Step 3: Update ToolsGrid** — Remove icon filters (grayscale, invert). Icons: `text-text-secondary hover:text-text-primary`.

- [ ] **Step 4: Update HowItWorks** — Step numbers: `text-accent-text font-bold`. Step cards: clean card. Connectors: `text-border-secondary`.

- [ ] **Step 5: Update Footer** — Background: `bg-bg-secondary`. Text: `text-text-secondary`. Links: `text-accent-text hover:text-text-primary`. Border: `border-t border-border-primary`.

- [ ] **Step 6: Verify all sections** — Run: `cd /app/dojops-org/dojops.ai && npm run build`. Expected: Build succeeds.

### Task 7: Restyle terminal components

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/TerminalDemo.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/InstallSection.tsx`

- [ ] **Step 1: Update TerminalDemo to use `.terminal` class**

Apply the always-dark terminal styling from globals.css. Replace any inline dark colors with the `.terminal` class.

- [ ] **Step 2: Update InstallSection tabs**

Tab container: `bg-bg-card border border-border-primary rounded-[14px]`. Active tab: `bg-accent-subtle text-accent-text`. Inactive tab: `text-text-secondary hover:text-text-primary`. Code area: `.terminal` class.

- [ ] **Step 3: Verify terminal renders correctly**

Visual check: Terminal should be dark with cyan prompt, regardless of page theme.

### Task 8: Restyle PipelineFlow and FloatingIconsBg

**Files:**

- Modify: `/app/dojops-org/dojops.ai/src/components/PipelineFlow.tsx`
- Modify: `/app/dojops-org/dojops.ai/src/components/FloatingIconsBg.tsx`

- [ ] **Step 1: Update PipelineFlow nodes per spec Section 9.1**

Node fill: `var(--bg-card)` with 2px border colored by status. Active: `var(--accent)` border + `var(--accent-subtle)` fill. Success: `var(--success-fg)` border + `var(--success-bg)` fill. Edge lines: `var(--border-secondary)`, 2px. Remove all neon glow, drop-shadow filters, and cyan SVG effects. Labels: caption size, `var(--text-secondary)`.

- [ ] **Step 2: Update FloatingIconsBg**

Opacity: 0.03-0.04. Color: `var(--text-tertiary)` instead of cyan. Keep drift animations at 40-60s.

- [ ] **Step 3: Verify pipeline renders on light background**

Visual check: Pipeline should be clean and readable on `--bg-primary`.

### Task 9: Full build and visual verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /app/dojops-org/dojops.ai && npm run build`
Expected: Build succeeds with zero errors.

- [ ] **Step 2: Run lint**

Run: `cd /app/dojops-org/dojops.ai && npm run lint`
Expected: No new warnings.

- [ ] **Step 3: Visual smoke test**

Start dev server and verify:

1. Light mode: warm light background, readable text, clean cards, no neon
2. Dark mode toggle: switches to dark slate, tokens swap correctly
3. Terminal demo: always dark regardless of theme
4. Pipeline: clean nodes without glow
5. Mobile responsive: navbar drawer, sections stack, hero scales
6. Animations: fadeInUp on scroll, typing demo, floating icons

---

## Chunk 2: dojops-hub (Marketplace)

### Task 10: Rewrite hub globals.css with design tokens

**Files:**

- Rewrite: `/app/dojops-org/dojops-hub/src/app/globals.css`

- [ ] **Step 1: Replace entire globals.css**

Use the exact same token block from Task 1 (`:root` + `.dark` + `@theme inline`). Remove all glow-card, glass-border, shimmer, and neon-specific classes. Keep only: `.terminal`, `.status-dot`, `.skeleton`, focus states, and reduced-motion media query. No marketing animations (no fadeInUp, no drift) — hub only needs transitions.

- [ ] **Step 2: Verify build**

Run: `cd /app/dojops-org/dojops-hub && npm run build 2>&1 | tail -10`
Expected: Build starts. CSS errors will surface here.

### Task 11: Swap fonts and add dark mode in hub layout.tsx

**Files:**

- Modify: `/app/dojops-org/dojops-hub/src/app/layout.tsx`

- [ ] **Step 1: Replace Sora with Plus Jakarta Sans** — Same pattern as Task 2.
- [ ] **Step 2: Remove `className="dark"` from `<html>`**
- [ ] **Step 3: Add inline dark mode script** — Same script as Task 2, Step 4.
- [ ] **Step 4: Verify build** — Run: `cd /app/dojops-org/dojops-hub && npm run build 2>&1 | tail -10`

### Task 12: Restyle hub UI primitives

**Files:**

- Modify: `/app/dojops-org/dojops-hub/src/components/ui/Button.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/Badge.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/GlowCard.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/SearchBar.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/Pagination.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/Spinner.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/ui/EmptyState.tsx`

- [ ] **Step 1: Restyle Button.tsx per spec Section 3.1**

Update variant classes:

- Primary: `bg-accent text-white hover:bg-accent-hover shadow-[var(--shadow-sm)]`
- Secondary: `bg-bg-card text-text-primary border border-border-primary hover:bg-bg-card-hover`
- Ghost: `text-text-secondary hover:text-text-primary hover:bg-bg-card-hover`
- Sizes: sm=32px h, md=38px h, lg=44px h. All `rounded-[10px]`

- [ ] **Step 2: Restyle Badge.tsx per spec Section 3.4**

Shape: `rounded-full` (pill). Size: `text-xs font-medium`. Variants: success uses `bg-success-bg text-success-fg`, warning uses `bg-warning-bg text-warning-fg`, error uses `bg-error-bg text-error-fg`. Default: `bg-bg-secondary text-text-secondary`.

- [ ] **Step 3: Restyle GlowCard.tsx to clean card** — Same as Task 5.

- [ ] **Step 4: Restyle SearchBar.tsx per spec Section 3.3**

Input: `bg-bg-card border border-border-secondary rounded-[6px] h-[38px] text-text-primary placeholder:text-text-tertiary`. Dropdown: `bg-bg-card border border-border-primary rounded-[14px] shadow-[var(--shadow-md)]`.

- [ ] **Step 5: Restyle Pagination, Spinner, EmptyState**

Pagination: `text-text-secondary`, active page `bg-accent-subtle text-accent-text`. Spinner: `border-accent border-t-transparent` with 0.6s spin. EmptyState: per spec Section 3.13.

### Task 13: Restyle hub layout components (Navbar, Footer)

**Files:**

- Modify: `/app/dojops-org/dojops-hub/src/components/layout/Navbar.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/components/layout/Footer.tsx`

- [ ] **Step 1: Restyle Navbar** — Same pattern as Task 3: clean light navbar, dark mode toggle, no glass.
- [ ] **Step 2: Restyle Footer** — Background: `bg-bg-secondary`. Text/links: token colors. Border: `border-t border-border-primary`.

### Task 14: Restyle hub package components

**Files:**

- Modify: All 9 files in `/app/dojops-org/dojops-hub/src/components/package/`

- [ ] **Step 1: Restyle PackageCard**

Uses GlowCard (now clean card). Title: `text-text-primary font-semibold`. Description: `text-text-secondary text-sm line-clamp-2`. Tags: Badge component (pill). Stats: `text-text-tertiary text-xs`.

- [ ] **Step 2: Restyle PackageDetail**

Header: `bg-bg-primary`. Metadata sidebar: `bg-bg-card border border-border-primary rounded-[14px]`. Install command: `.terminal` class.

- [ ] **Step 3: Restyle RiskBadge**

LOW: `bg-success-bg text-success-fg`. MEDIUM: `bg-warning-bg text-warning-fg`. HIGH: `bg-error-bg text-error-fg`.

- [ ] **Step 4: Restyle remaining package components**

InstallCommand: `.terminal` class. VersionHistory: table per spec Section 3.5. DopsPreview: `.terminal` class. IntegrityHash: `font-mono text-text-secondary text-xs`. PermissionBadges: Badge styling.

### Task 15: Restyle hub community, publish, user, admin, settings components

**Files:**

- Modify: All components in `community/`, `publish/`, `user/`, `admin/`, `settings/` directories

- [ ] **Step 1: Restyle community components** — StarButton active: `text-accent`. CommentThread/Item: card borders, token colors. AuthorBadge: `text-text-secondary text-sm`.

- [ ] **Step 2: Restyle publish components** — PublishForm: form validation states per spec Section 3.12. Drag-drop: `border-2 border-dashed border-border-secondary rounded-[14px] bg-bg-secondary`. MetadataPreview: `.terminal` class.

- [ ] **Step 3: Restyle user profile components** — UserProfile: `bg-bg-card` header card. UserPackages/Stars: grid with clean cards.

- [ ] **Step 4: Restyle admin and settings** — PackageModeration: table per spec Section 3.5, status badges. TokenManager: form + table, danger button for revoke.

### Task 16: Restyle hub pages

**Files:**

- Modify: `/app/dojops-org/dojops-hub/src/app/page.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/app/explore/page.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/app/auth/signin/page.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/app/not-found.tsx`
- Modify: `/app/dojops-org/dojops-hub/src/app/loading.tsx`

- [ ] **Step 1: Homepage** — Background: `bg-bg-primary`. Featured: `bg-bg-secondary`. Recent: clean card grid.

- [ ] **Step 2: Explore page** — Search: `bg-bg-primary`. Filter sidebar: `bg-bg-card border-r border-border-primary`. Results: clean cards.

- [ ] **Step 3: Auth page** — Centered card: `bg-bg-card border border-border-primary rounded-[14px] shadow-[var(--shadow-md)]`.

- [ ] **Step 4: Not-found and loading** — not-found: empty state per spec. loading: skeleton per spec Section 3.14.

### Task 17: Hub build and visual verification

**Files:** None (verification only)

- [ ] **Step 1: Run build** — Run: `cd /app/dojops-org/dojops-hub && npm run build`. Expected: Build succeeds.
- [ ] **Step 2: Run lint** — Run: `cd /app/dojops-org/dojops-hub && npm run lint`. Expected: No new warnings.
- [ ] **Step 3: Run tests** — Run: `cd /app/dojops-org/dojops-hub && npm test`. Expected: All tests pass (styling changes don't break logic tests).

---

## Chunk 3: dojops-console (Dashboard)

### Task 18: Rewrite console globals.css with design tokens

**Files:**

- Rewrite: `/app/dojops-org/dojops-console/src/app/globals.css`

- [ ] **Step 1: Replace entire globals.css**

Same token block as Tasks 1 and 10. Add console-specific status classes:

```css
/* Console-specific: status indicators */
.status-running {
  color: var(--accent);
}
.status-completed,
.status-success {
  color: var(--success-fg);
}
.status-failed {
  color: var(--error-fg);
}
.status-pending,
.status-queued {
  color: var(--text-tertiary);
}
.status-paused,
.status-cancelled,
.status-expired {
  color: var(--warning-fg);
}
.status-approval-pending {
  color: var(--warning-fg);
}
```

Remove `.glass-card`, `.glow-focus`, `.ambient-glow`, and all cyberpunk-specific classes.

### Task 19: Swap fonts and dark mode in console layout.tsx

**Files:**

- Modify: `/app/dojops-org/dojops-console/src/app/layout.tsx`

- [ ] **Step 1: Same font swap and dark mode script as Tasks 2 and 11**

### Task 20: Restyle console layout components

**Files:**

- Modify: `/app/dojops-org/dojops-console/src/components/layout/Sidebar.tsx`
- Modify: `/app/dojops-org/dojops-console/src/components/layout/Header.tsx`
- Modify: `/app/dojops-org/dojops-console/src/components/layout/UserMenu.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/layout.tsx`

- [ ] **Step 1: Restyle Sidebar per spec Section 3.6**

Background: `bg-bg-secondary` (was `--dark-navy`). Logo: 3D icon (24px) + "DojOps" in `text-text-primary font-bold`. Nav items: `h-[38px] rounded-[10px] text-text-secondary`. Active: `bg-accent-subtle text-accent-text`. Hover: `hover:bg-bg-card-hover`. Width: 240px. Add dark mode toggle to sidebar footer.

- [ ] **Step 2: Restyle Header**

Background: `bg-bg-card border-b border-border-primary`. Breadcrumbs: `text-text-secondary`, current `text-text-primary`. Remove all `var(--color-dark-navy)` inline styles.

- [ ] **Step 3: Restyle UserMenu**

Avatar fallback: `bg-bg-secondary text-text-primary`. Plan badge: semantic colors (FREE=secondary, PRO=accent, TEAM=accent, ENTERPRISE=warning). Dropdown: `bg-bg-card border border-border-primary rounded-[14px] shadow-[var(--shadow-md)]`.

- [ ] **Step 4: Update dashboard layout**

Remove `bg-bg-deep`. Content area: `bg-bg-primary`.

### Task 21: Restyle console dashboard pages

**Files:**

- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/license/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/billing/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/executions/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/team/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/dashboard/settings/page.tsx`
- Modify: `/app/dojops-org/dojops-console/src/app/auth/signin/page.tsx`

- [ ] **Step 1: Restyle overview dashboard**

Stat cards: `bg-bg-card border border-border-primary rounded-[14px] p-4 shadow-[var(--shadow-sm)]`. Values: `text-text-primary text-2xl font-bold`. Labels: `text-text-secondary text-sm`. Recent executions: replace `.glass-card` with clean card + status dots per spec Section 3.10. Replace all `var(--color-*)` inline styles with Tailwind token classes.

- [ ] **Step 2: Restyle license page**

Key form: input per spec Section 3.3, button per Section 3.1. Key table: per spec Section 3.5. Status badges: Active=success, Expired=warning, Revoked=error. Copy button: `text-text-tertiary hover:text-text-primary`.

- [ ] **Step 3: Restyle billing page**

Plan cards: `bg-bg-card border border-border-primary rounded-[14px]`. Current plan: `border-accent-border`. Prices: `text-text-primary text-3xl font-bold`. Billing history: table per spec Section 3.5.

- [ ] **Step 4: Restyle executions page**

Table per spec Section 3.5. Status column: `.status-dot` + `.status-dot-pulse` (for running) + status text. Replace inline `style={{ color: ... }}` with CSS class status system.

- [ ] **Step 5: Update stub pages** — Background: `bg-bg-primary`. Text: token colors.

- [ ] **Step 6: Restyle sign-in page** — Centered card: `bg-bg-card border border-border-primary rounded-[14px] shadow-[var(--shadow-md)]`. GitHub button: secondary styling.

### Task 22: Console build and verification

**Files:** None (verification only)

- [ ] **Step 1: Run build** — Run: `cd /app/dojops-org/dojops-console && pnpm build`. Expected: Build succeeds.
- [ ] **Step 2: Run lint** — Run: `cd /app/dojops-org/dojops-console && pnpm lint`. Expected: No new warnings.
- [ ] **Step 3: Run tests** — Run: `cd /app/dojops-org/dojops-console && pnpm test`. Expected: All 28 tests pass.

---

## Chunk 4: dojops-doc (Documentation)

### Task 23: Create globals.css and update layout for docs site

**Files:**

- Create: `/app/dojops-org/dojops-doc/app/globals.css`
- Modify: `/app/dojops-org/dojops-doc/app/layout.tsx`

- [ ] **Step 1: Create globals.css with design tokens + Nextra overrides**

Tokens: same `:root` and `.dark` blocks as other sites (subset — no chart colors needed). Nextra overrides: set `--nextra-primary-hue: 199deg` and `--nextra-primary-saturation: 89%` to match accent cyan. Override body `font-family` to Plus Jakarta Sans. Override `pre` for terminal-style code blocks: `background: #0F1117`, `border-radius: 14px`, `border: 1px solid #2A2D37`. Override `code` font to JetBrains Mono at 14px.

Note: Nextra has its own theming. CSS overrides must work alongside `nextra-theme-docs/style.css`. Test carefully.

- [ ] **Step 2: Update layout.tsx**

Import the new globals.css: `import "./globals.css"`. Nextra 4 may not support `next/font/google` injection the same way. Check if Plus Jakarta Sans can be loaded via `<link>` in Head or via CSS `@import`. Update logo to spec (24px icon + "DojOps Docs").

- [ ] **Step 3: Verify build**

Run: `cd /app/dojops-org/dojops-doc && npm run build`
Expected: Build succeeds. Pagefind post-build runs.

### Task 24: Customize MDX components for code blocks

**Files:**

- Modify: `/app/dojops-org/dojops-doc/mdx-components.tsx`

- [ ] **Step 1: Override code block rendering if needed**

If Nextra's default code blocks don't match the terminal spec after the CSS overrides in Task 23, override the `pre` component in `useMDXComponents` to apply terminal styling inline.

- [ ] **Step 2: Verify code blocks render correctly**

Start dev server and check a documentation page with code examples (e.g., `/getting-started/installation`).

### Task 25: Docs build and verification

**Files:** None (verification only)

- [ ] **Step 1: Run build** — Run: `cd /app/dojops-org/dojops-doc && npm run build`. Expected: Build + pagefind succeed.
- [ ] **Step 2: Run format check** — Run: `cd /app/dojops-org/dojops-doc && npm run format:check`. Expected: No issues.
- [ ] **Step 3: Visual verification** — Light mode default, dark mode toggle works, code blocks are dark terminal style, sidebar readable, headings correct.

---

## Summary

| Chunk | Site           | Tasks | Key Changes                                                   |
| ----- | -------------- | ----- | ------------------------------------------------------------- |
| 1     | dojops.ai      | 1-9   | Full redesign: tokens, fonts, 15 components, dark mode toggle |
| 2     | dojops-hub     | 10-17 | Tokens, fonts, 33 components, dark mode toggle                |
| 3     | dojops-console | 18-22 | Tokens, fonts, sidebar/header/pages, status indicators        |
| 4     | dojops-doc     | 23-25 | Tokens, Nextra overrides, code blocks                         |

All chunks are independent and can be executed in parallel (each site is a separate repo).
