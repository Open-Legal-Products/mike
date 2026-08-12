# Design System

How Mike's frontend actually looks and how to build with it. This documents the
existing system — it is not a proposal to change it. Everything below was read
off `frontend/src/app/globals.css` and measured across
`frontend/src/app/components/` (~120 component files), so where the de facto
convention differs from the theoretical one, the de facto one is what's written
down.

Stack: Next.js App Router, Tailwind v4, shadcn/ui (`new-york`, see
`frontend/components.json`), Lucide icons.

---

## 1. Colour

There are three colour vocabularies in the codebase. Knowing which one you're
in is most of the job.

### 1.1 The Tailwind grey ramp — the working palette

~930 usages of `text-gray-*` / `bg-gray-*` / `border-gray-*` across the feature
components. This, not the semantic token set, is what the app is actually built
out of.

| Usage | Class |
| --- | --- |
| Primary text | `text-gray-900` (headings), `text-gray-700` (body) |
| Secondary text | `text-gray-600` |
| Muted / meta text | `text-gray-500` |
| Placeholder, disabled-ish | `text-gray-400` |
| Hairlines and borders | `border-gray-100`, `border-gray-300` |
| Filled control (checkbox, pill) | `bg-gray-900` |
| Inverted text on filled | `text-white` |

Contrast floors worth remembering, all against a near-white background:
`gray-400` is ~2.5:1 and **fails** WCAG AA for text; `gray-500` is ~4.8:1 and
passes. Do not use `text-gray-400` for text a user has to read — it is fine for
decorative icons and for genuinely disabled controls, which are exempt.

### 1.2 The `app-*` surface tokens — layered chrome

Defined in `globals.css` as plain hex, exposed as Tailwind colours via
`@theme inline`:

| Token | Value | Meaning |
| --- | --- | --- |
| `--app-background` | `#f9fafb` | The page behind everything |
| `--app-surface` | `#fdfdfe` | A raised panel or table surface |
| `--app-surface-hover` | `#f9fafb` | Row/item hover |
| `--app-surface-active` | `#eff0f3` | Row/item selected |
| `--app-floating` | `#fefefe` | Floating elements above a surface |

Use these through the shared constants in
`frontend/src/app/components/ui/liquid-surface.ts` rather than hand-writing the
classes — `APP_SURFACE_HOVER_CLASS`, `APP_SURFACE_ACTIVE_CLASS`,
`APP_SURFACE_PRESSED_CLASS`, `APP_SURFACE_GROUP_HOVER_CLASS`. That file also
holds the two composite surface recipes, `LIQUID_TABLE_SURFACE_CLASS` and
`LIQUID_PANEL_SURFACE_CLASS`.

### 1.3 The shadcn semantic tokens — primitives only

`--background`, `--foreground`, `--card`, `--popover`, `--primary`,
`--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`,
`--ring`, plus `--sidebar-*` and `--chart-1..5`. All oklch, all in `:root` with
a `.dark` counterpart.

In practice these are used almost exclusively by the vendored shadcn
primitives (`button.tsx`, `input.tsx`, `dropdown-menu.tsx`) — about 45 usages
total against the grey ramp's 930. Keep using them inside anything derived from
shadcn, so that the primitive stays swappable with upstream. Don't try to
convert the feature layer to them as a drive-by; that's a separate, deliberate
migration.

`--muted-foreground` (`oklch(0.556 0 0)`, ≈`#767676`) is ~4.6:1 on the light
background and clears AA for body text.

### 1.4 Accent blue

Declared once in `@theme inline` and used for links, focus rings, and the "on"
state of controls:

`--color-blue` / `--color-blue-600` = `rgb(0, 136, 255)`, with `blue-50`,
`blue-100`, `blue-200` as translucent tints and `blue-700` as the pressed
shade. `--color-azure` (`0, 136, 255` as a bare triple) exists so legal-content
CSS can build `rgba()` from it — that's why the USC/CFR link styles use
`rgb(var(--color-azure))`.

### 1.5 Dark mode: defined, not wired up

A full `.dark` token set exists and `@custom-variant dark` is declared, but
**nothing in the app ever adds the `dark` class**, and `dark:` variants appear
only in the three vendored shadcn primitives. Treat dark mode as unshipped: you
don't need to design for it, and you shouldn't assume it works if you turn it
on. Keeping the `dark:` arms that come with a shadcn component is fine and
costs nothing.

### 1.6 Raw hex

Exactly five component files use raw 6-digit hex, all for a legitimate reason
(third-party viewer chrome, an SVG logo, syntax-ish highlighting):
`assistant/CaseLawPanel.tsx`, `assistant/AssistantSidePanel.tsx`,
`chat/mike-icon.tsx`, `shared/DocumentSidePanel.tsx`,
`shared/views/SpreadsheetView.tsx`. Adding a sixth needs a reason. Note this
does **not** cover `rgba()` inside arbitrary `shadow-[...]` values, which is
the normal way shadows are written here (see §4).

---

## 2. Typography

Two fonts, both loaded via `next/font/google` in `frontend/src/app/layout.tsx`
and bound to CSS variables:

| Family | Variable | Tailwind | Role |
| --- | --- | --- | --- |
| Inter | `--font-inter` | `font-sans` (default) | All UI chrome |
| EB Garamond | `--font-eb-garamond` | `font-serif`, `.font-eb-garamond` | Legal document content, and display headings |

`font-sans` is applied to `<body>`, so UI text needs no font class. Reach for
`font-serif` in two places, matching what the app already does:

1. **Rendered legal text** — the `.usc-section`, `.cfr-section`, and
   `.workflow-editor-content` blocks in `globals.css` set it wholesale, along
   with a `1.6`–`1.65` line-height for long-form reading.
2. **Display headings** — empty-state titles and panel titles, e.g.
   `font-serif text-2xl font-medium text-gray-900`. Available via
   `EmptyState` (§5) so you don't retype it.

The de facto type scale, by frequency:

| Class | Uses | Where |
| --- | --- | --- |
| `text-xs` | ~200 | The default for dense UI: rows, pills, menu items, meta |
| `text-sm` | ~155 | Comfortable body text, inputs, buttons |
| `text-2xl` | ~14 | Empty-state / display headings (with `font-serif`) |
| `text-base`, `text-lg`, `text-xl` | <10 each | Occasional panel titles |

`text-xs` being the workhorse is the single most surprising thing about this
codebase's type scale — it is a dense, table-heavy application. There is also a
tail of arbitrary sizes (`text-[11px]`, `text-[10px]`, `text-[9px]`, ~36 uses)
for badge and annotation text below `text-xs`. Prefer `text-[10px]`/`text-[11px]`
over inventing a new one.

Weights: `font-medium` is the emphasis weight almost everywhere;
`font-semibold` appears mainly in long-form legal headings. `font-bold` is
essentially unused — don't start.

---

## 3. Spacing and radius

Nothing is customised: this is Tailwind's default 0.25rem-step scale. What
matters is which steps the codebase actually uses, because sticking to them is
what keeps screens looking consistent.

**Spacing**, by frequency:

- Gaps: `gap-2` (82), `gap-1.5` (73), `gap-1` (67), then `gap-3` (26), `gap-4` (10).
  `gap-1.5` is the idiomatic icon-to-label gap inside a control.
- Horizontal padding: `px-3` (112), `px-2` (60), `px-4` (21), `px-2.5` (17).
- Vertical padding: `py-2` (83), `py-1.5` (44), `py-1` (22), `py-0.5` (24).

So a dense row is `px-2 py-2` or `px-3 py-1.5`; a comfortable control is
`px-3 py-2`. Steps above `4` are rare and mostly page-level.

**Radius.** `--radius: 0.625rem` (10px) feeds the shadcn `--radius-sm/md/lg/xl`
ladder, but the feature layer mostly uses Tailwind's literal radii:

| Class | Uses | Meaning |
| --- | --- | --- |
| `rounded-full` | 87 | Pills, toggles, circular icon buttons — the house style |
| `rounded-lg` | 58 | Menu items, rows, small panels |
| `rounded-md` | 46 | Inputs, buttons (shadcn default) |
| `rounded-xl` | 28 | Dropdown/popover containers |
| `rounded-2xl` | 13 | Large floating surfaces (the `liquid-*` recipes) |

The rule of thumb: the bigger the surface, the bigger the radius. Interactive
chips are always `rounded-full`.

**Control heights.** `h-7` (28px) for compact controls (tab pills, icon
buttons), `h-8`/`h-9` for standard (shadcn `sm`/`default`), `h-3.5` for the
checkbox square. Icon sizes track the control: `h-2.5`, `h-3`, `h-3.5` inside
compact chrome, `h-4` (`size-4`) for shadcn defaults.

---

## 4. The glass / "liquid" idiom

Mike's distinctive surface treatment: a translucent white fill, a white
hairline border, an inset highlight, and a blur. ~68 `backdrop-blur-*` usages,
overwhelmingly `backdrop-blur-xl` (38) on controls and `backdrop-blur-2xl` (20)
on large surfaces.

Shadows in this idiom are written as arbitrary values with `rgba()` literals —
`shadow-[0_3px_9px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.86)]`
and friends. That is deliberate and unavoidable (Tailwind's shadow scale can't
express layered inset highlights), but it is also the main source of copy-paste
drift in this codebase.

**Never retype one of these shadow triples.** Every one that is used more than
once already lives in a shared primitive or in `liquid-surface.ts`. If you need
a glass surface, compose from: `PillButton`, `TabPillButton`, `SearchBar`,
`GlassIconButton`, `LiquidDropdown*`, `LIQUID_TABLE_SURFACE_CLASS`,
`LIQUID_PANEL_SURFACE_CLASS`, or the `.white-liquid-glass` utility in
`globals.css`.

---

## 5. The primitive layer: `components/ui/`

`frontend/src/app/components/ui/` is the shared layer. Two kinds of file live
there: **vendored shadcn** components, which should stay close to upstream so
they can be re-synced, and **Mike-native** primitives, which encode this app's
own idioms.

| Primitive | Origin | What it's for |
| --- | --- | --- |
| `button.tsx` | shadcn | The standard button; `cva` variants + `asChild` |
| `input.tsx` | shadcn | The standard text input |
| `dropdown-menu.tsx` | shadcn (Radix) | All menus, submenus, checkbox/radio items |
| `pill-button.tsx` | Mike | Primary action pill. `tone` = `black` \| `white` \| `blue` \| `danger` |
| `tab-pill-button.tsx` | Mike | Filter/tab chip. `active` tri-state: `true` \| `false` \| `undefined` (not a toggle) |
| `search-bar.tsx` | Mike | Glass search field with clear button; `size` = `sm` \| `normal` |
| `toggle-switch.tsx` | Mike | `role="switch"` with an optional inline label |
| `cite-button.tsx` | Mike | Copy-quote-and-citation control |
| `glass-icon-button.tsx` | Mike | Circular glass icon button (panel/modal close) |
| `check-square.tsx` | Mike | The selection square; purely visual, ARIA-free by design |
| `empty-state.tsx` | Mike | Icon + serif title + description + action body |
| `liquid-dropdown.tsx` | Mike | The glass skin over `dropdown-menu` |
| `liquid-surface.ts` | Mike | Surface class constants (not a component) |

Two shared components live just outside this directory and are worth knowing
about, because reimplementing either is a common mistake:
`shared/TablePrimitive.tsx` (table shell, `TableEmptyState`, `SkeletonLine`,
`SkeletonDot`, `TABLE_CHECKBOX_CLASS`) and `modals/Modal.tsx` (the modal shell,
used by 18 files).

### 5.1 Which layer do I reach for?

In order. Stop at the first one that works.

1. **A primitive in `components/ui/`** — if one covers it, use it, even if you
   need to pass a `className` tweak. This is almost always the answer.
2. **A shared constant** — `liquid-surface.ts` for surfaces,
   `tabular/pillUtils.ts` (`getPillClass`, `TAG_COLORS`) for tag colours,
   `TABLE_CHECKBOX_CLASS` for native table checkboxes.
3. **The shadcn registry** — for a genuinely standard interaction pattern we
   don't have yet (dialog, tooltip, popover, select, tabs, accordion…). Prefer
   this over hand-rolling, because you inherit Radix's keyboard and ARIA
   behaviour for free. Add it with the shadcn CLI so it lands in
   `components/ui/` in `new-york` style with our token names, then adapt the
   colours to §1 if it needs the glass treatment. Adding a Radix dependency for
   this is expected and fine.
4. **A one-off in the feature folder** — legitimate when the thing is used
   once, is specific to one screen, and has no interaction semantics worth
   sharing. Keep it in the feature directory, not in `ui/`.
5. **A new primitive in `components/ui/`** — earn this. The bar is the same one
   the existing Mike-native primitives cleared: **the same markup, with only
   cosmetic variation, in three or more places.** Two occurrences is a
   coincidence; three is a pattern. When you promote one, migrate every call
   site in the same PR, and give it a `*.test.tsx`.

### 5.2 Promoting a duplicated pattern

The grep that finds candidates: pick a distinctive class string from the thing
you're about to write and search for it.

```bash
grep -rn "rounded-full border border-white/70" --include='*.tsx' frontend/src/app/components/
```

Three or more hits with the same shape means the primitive already wants to
exist. Some things look duplicated but aren't, and shouldn't be merged:
inline `Loader2` spinners (real size/colour variation at every site, a wrapper
would trade one line for one line), tag pills (already shared via
`pillUtils.ts`), and one-line `<p>` "no results" messages (a paragraph with one
class is not a component).

---

## 6. Accessibility baseline

The primitives are where an a11y fix pays off everywhere at once, so the rules
here are tighter than for feature code.

**Focus must be visible.** The house focus indicator is
`outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2`
(drop the offset inside dense containers like menus). Two traps this codebase
already fell into: a focus style that only changes a translucent background
(`white/70` → `white/90` is imperceptible), and `outline-hidden` on a Radix
menu item whose skin then overrides the highlight colour. A ring is independent
of the background, so it survives both. Never remove an outline without
replacing it.

**Icon-only controls need a name.** An icon is not a label. `GlassIconButton`
makes `aria-label` a required prop for exactly this reason. Where a visible
label exists, let it be the accessible name — don't override it with an
`aria-label` that says something different (WCAG 2.5.3). `CiteButton` therefore
only sets `aria-label` when it's rendering icon-only.

**Don't signal state with colour alone** (WCAG 1.4.1) and keep state
indicators above 3:1 (WCAG 1.4.11). Both were violated here: a switch whose
"off" track was `bg-gray-100` behind a white thumb (~1.07:1, fixed with a
`ring-1 ring-gray-300`), and a selected menu radio item marked only by
`bg-gray-100` on white (~1.03:1, fixed by adding `font-medium` as a second,
non-colour channel).

**Text contrast**: see §1.1. `text-gray-400` is not a text colour.

**Interactive `<span>`s carry their own ARIA.** `CheckSquare` is deliberately
role-free and ARIA-free because call sites disagree about whether the checkbox
semantics belong on the square or on the row button wrapping it. When the
square is the control, pass `role="checkbox"` + `aria-checked` (+
`aria-disabled`, `aria-label`) to it; when the row is the control, put them
there and leave the square as decoration.

**Every button declares `type`.** Default is `type="submit"`, which submits any
surrounding form. Every Mike-native primitive defaults to `type="button"`.

---

## 7. Testing a primitive

Primitives are unit-tested with Vitest + Testing Library; see the `*.test.tsx`
files alongside them for the house style. Query by role and accessible name
(`getByRole("button", { name: "Close" })`) rather than by test id — it asserts
the a11y contract and the behaviour at the same time. Assert the specific
classes that carry meaning (state colours, focus rings), not the whole class
string, which is churn.

```bash
npm test --prefix frontend -- src/app/components/ui
```

Some list and table screens accept `?emptyStates=1` to force their empty state,
which is the quickest way to eyeball `EmptyState` changes in the running app.
