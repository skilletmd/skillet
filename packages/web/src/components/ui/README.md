# UI primitives

Shared, reusable building blocks. **Anything that repeats across the app lives
here as a component**, not as a one-off class string or a parallel `globals.css`
widget rule. This is the single source of truth so primitives can't drift apart
(the avatar/menu that rendered two different ways).

## Conventions

- **Styling is Tailwind utilities + CSS-variable tokens** (`--ink`, `--surface`,
  `--line`, `--accent`, `--danger`, …). Compose classes with `cn()` (`@/lib/cn`),
  which merges Tailwind conflicts.
- **Variants use `cva`** (class-variance-authority). See `button.tsx`,
  `badge.tsx`, `avatar.tsx`.
- **Behavioural primitives wrap Radix** (focus trap, keyboard, ARIA, positioning
  come for free) and we style the parts with our tokens. See `dropdown-menu.tsx`.
  Do **not** pull in shadcn's pre-styled defaults — they ship a neutral theme;
  take the Radix primitive and apply our tokens.
- `globals.css` is for base resets, keyframes, third-party overrides, and
  page-specific layout — **not** for reusable widgets. When a primitive replaces
  a `globals.css` rule, delete the rule.

## Migration note

`button.tsx` still emits the legacy `.ui-button*` classes (their `color-mix`
hovers are hard to express as Tailwind without flaky arbitrary classes). The
**component is the boundary**: call sites already use `<Button>`, so those
internals can move to Tailwind later without touching a single call site. Same
applies to any primitive that temporarily wraps an existing class.

## Current primitives

| Component | Replaces | Styling |
| --- | --- | --- |
| `Button` | `.ui-button*` | cva → legacy classes (boundary established) |
| `DropdownMenu` | hand-rolled menus | Radix + tokens |
| `Avatar` | `.account-dashboard-avatar` | Tailwind + tokens |
| `Badge` | `.ui-badge*` | Tailwind + cva |
| `Input` / `Select` / `Textarea` / `FieldLabel` | `.ui-input` | Tailwind + tokens |
| `Panel` | `rounded-2xl border bg-(--surface)` shells | Tailwind + tokens (`as` for semantic tags) |
| `EmptyState` | hand-rolled "nothing here" blocks | `quiet` \| `card` variants |
| `DialogFooter` | `mt-5 flex justify-end gap-3` rows | `end` \| `between` layouts |
| `ToggleSwitch` | hand-rolled `h-6 w-11` switches | controlled `role="switch"` |
| `StatTile` | profile/stats number+label markup | `compact` \| `full` variants |
| `Dialog` / `Popover` / `Tooltip` | hand-rolled overlays | Radix + tokens |
| `SegmentedControl` / `Tabs` | hand-rolled toggles/tab bars | tokens (`.seg` / `.feed-tabs`) |
| `CountBadge` | hand-rolled count chips | accent circle, caps at `{max}+` |
| `Shimmer` / `Eyebrow` | inline `animate-pulse` / labels | Tailwind + tokens |

Every primitive is rendered live from the real component in the internal design
page (`app/internal/design/page.tsx` → `DesignPrimitives`), so the catalog can't
drift from what ships. Add new primitives to that gallery.

**Number formatting is an intentional split, not a drift:** social-proof counts
use the compact form (`compactCount` → `1.2K`) while exact metrics use the full
`Intl.NumberFormat` (`1,234`). Keep that split.
