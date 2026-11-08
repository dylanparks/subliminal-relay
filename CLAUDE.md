# CLAUDE.md — Subliminal Relay

Context for working on this repo. Read this first; it should be enough to start without
re-deriving anything.

## What this is

**Subliminal Relay** is a Figma plugin that exports the Subliminal Design System's Figma
variables and styles as JSON. Its output is consumed by the **`subliminal-design-system`** repo
(separate repo — `dylanparks/subliminal-design-system`), whose `design-system/build-tokens.mjs`
turns that JSON into `tokens.css` / `tokens.ts` via Style Dictionary.

So Relay is one half of a pipeline: **Figma variables → Relay export → SDS token build → CSS
custom properties consumed by ~39 React components.**

## Current state (2026-11-08)

Working branch: **`claude/brand-alpha-export`**. Version `0.5.0`.

**Figma changed the composed-colour runtime format in 2026-11** (see "Two runtime shapes" below).
Every Relay ≤ 0.4.1 export of a current file silently ships 249 raw API objects in place of
colours. 0.5.0 reads both formats and refuses to emit anything it can't read.

```bash
npm install     # lockfile changed — a broken dep was removed
npm run build   # REQUIRED: dist/ is gitignored, so pulling never refreshes the bundle
```

Then in Figma: **Plugins → Development → Import plugin from manifest** → pick `manifest.json`.

`manifest.json` ships with `"id": "REPLACE_WITH_FIGMA_PLUGIN_ID"`. Dylan sets a real id in his
local copy — **don't overwrite it**, and don't invent one (it could collide with a real published
plugin id).

**Confirmed working in Figma (2026-09-10):** Dylan ran a real export off v0.4.0. All four
collections came through with every mode — Global Values ×1, Intent Colors ×2, Shape and Space ×2
(`Subliminal Brand` / `Example Brand`), Responsive Typography ×3 — 336 / 193 / 14 / 65 variables
respectively, no empty `$value`, no unsupported expressions.

## ⚠️ This scaffold was never actually working — verify, don't assume

The repo sat at a single "initial scaffold" commit for months. Three separate things were written
but had never worked, all found in one pass:

1. **Only one mode was ever exported.** Extraction read `collection.defaultModeId` and nothing
   else — silently dropping Darkmode and two of three typography breakpoints.
2. **`tsconfig.json` `typeRoots` pointed at the typings *package*** rather than the directory
   containing it, so the Figma globals had never type-checked at all.
3. **The UI bundle wasn't inlined.** `dist/ui.html` referenced `ui.js` externally; Figma loads
   plugin UI as a standalone document with no file server, so the panel rendered blank. The
   webpack config *claimed* to inline (it set `inlineSource` and had a comment saying it was
   required) but never registered the plugin that implements it.

All three are fixed. **Treat anything else in here as unverified until you've actually exercised
it.** `GitHubExport` in particular has never been run end-to-end as far as anyone knows.

## The architecture that matters

Dylan has restructured the Figma file around **opacity-on-variable** twice. As of 2026-11 it is
**4 collections, with Brand as its own layer**:

| Collection | Modes | Variables | Role |
|---|---|---|---|
| `Globals` | Value | 345 | Primitives: colour ramps, Transparent, font weights |
| `Brand` | Default | 113 | **The brand file.** `Colors/Light/*` + `Colors/Dark/*` (25 each), radius, size, border thickness, font family/weight/letter-spacing |
| `Color mode` | Lightmode, Darkmode | 181 | Intent tokens. Picks Light or Dark Brand colours and applies state opacities |
| `Breakpoint` | XS, MD, LG | 39 | Font size, line height, viewport — numbers only; typeface is deliberately a Brand decision, not a breakpoint one |

Brand is *data* (one mode, a flat list of values); Color mode is *behaviour*. Measured on the
2026-11 export: **174 of 181 intent tokens route through Brand** (124 composed + 50 aliases); the
two exceptions are the `Accents/Gradient` start/end tokens, which point straight at Globals.

The payoff, on the SDS side: emit Brand as its own CSS variable layer, then *derive* intent
tokens with `color-mix(in srgb, var(--sds-brand-x) N%, transparent)`, so a new brand is a set of
runtime CSS variable overrides with no token rebuild. That's why preserving the "which Brand token
+ what opacity" relationship through the export matters so much — flattening it to literals
throws away the entire benefit.

## Export format: Figma's native shape, deliberately

Relay emits **one file per collection per mode**, in Figma's own variable-export shape
(`{colorSpace, components, alpha, hex}` values, `{Group.Name}` refs for same-collection aliases,
`com.figma.aliasData` for cross-collection ones).

This is a deliberate choice: it makes a Relay export and a manual "Export variables" download
from Figma **interchangeable**, so the SDS pipeline only ever needs one parser. Don't invent a
bespoke format.

## ✅ Settled: the Plugin API *does* expose "alias + opacity"

This was the blocking question, and the Diagnostics tab answered it against the real file. The
published typings (`@figma/plugin-typings@1.138.0`) declare `VariableValue` as
`boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias` with no composed-colour
member — but the typings lag the runtime. `valuesByMode` actually returns:

```jsonc
{ "type": "VARIABLE_EXPRESSION",
  "expressionFunction": "COMPOSE_COLOR",
  "expressionArguments": [ { "type": "VARIABLE_ALIAS", "id": "VariableID:425:16248" }, 80 ] }
```

The trailing number is opacity on a **0–100** scale (fractional values occur), and
`alpha = Math.fround(opacity / 100)` — `fround`, not plain division, is what reproduces Figma's
own `0.800000011920929`.

This is the good outcome. Composition is read directly, so none of the fallbacks matter: no RGB
matching against Brand (which couldn't have disambiguated `Brand/Primary` from `Brand/Accent` —
both `#1A39DE` in light mode) and no path-name heuristics.

### Two runtime shapes — Figma moved it once already

In 2026-11, after opacity-on-variable shipped properly, the same data started arriving as:

```jsonc
{ "color": { "type": "VARIABLE_ALIAS", "id": "VariableID:442:10918" }, "opacity": 93 }
```

Still 0–100, still undocumented. Relay ≤ 0.4.1 only recognised the `VARIABLE_EXPRESSION` form, so
this fell through to the literal branch and the raw object was written into `$value` — 249 tokens,
in an export that otherwise looked complete. Nothing flagged it; it was caught by inspecting the
JSON by hand.

**Both shapes now go through one function, `readComposedColor`**, which normalizes either to a
`{ color, opacity }` pair; every consumer (index closure, resolution, emission, diagnostics) works
on that. If Figma moves it a third time, that function is the only place that changes. The old
shape is kept rather than replaced, so older files keep exporting.

Any other `expressionFunction` is emitted with a `com.subliminal.unsupportedExpression` marker.

### The sanity check: never pass an unknown object through

The real bug was not the format change — it was that an unrecognised value was *passed through*
as if it were a colour. Two guards now make that impossible:

- **`toTokenValue`** refuses any non-colour object: `$value` becomes `''` and the token gets a
  `com.subliminal.unreadableValue` marker carrying the raw JSON. This covers both the direct path
  and the cross-collection `aliasData` path, which could leak the same way.
- **`describeProblem`** checks every emitted token's `$value` against its `$type` and collects
  failures into `meta.problems`. Both export tabs show these in a red banner, and the GitHub tab
  withholds its "Tokens ready" badge. An empty `meta.problems` is the definition of a sound export.

The Diagnostics tab also names unrecognised shapes by their keys (`Unrecognised object {hue, mix}`)
instead of reporting `object`, which is what hid the 2026-11 change.

### Emitted shape

Composed colours match Figma's native export exactly: `$value` is the base colour carrying the
composed alpha, and the relationship lives in `$extensions["com.figma.composedColor"]`.
Composition is checked **before** aliasing — a composed colour's first argument *is* an alias, but
Figma never emits a `{Ref}` or `aliasData` for one.

`colorArg.alias` has two forms, mirroring how `$value` treats aliases:

- base in the **same collection** → `{ targetVariableName: "Brand/Neutral" }` (slash form here,
  even though same-collection `{Ref}` values use the dot form)
- base in **another collection** → the full `AliasData` object

In the 2026-09-09 native export, 260 of 261 composed tokens used the short form and
`Status/Error/Stroke/Default` was the one long-form case (composing straight onto Global Values'
`Colors/Red/600` at 30%).

**Since 2026-11 this has inverted:** Brand is its own collection, so every composed colour in
Color mode is cross-collection and *all 249 now use the long form*. That rule was verified against
native output on exactly one token. A native "Export variables" of Color mode would confirm it —
and would also show whether Figma's *export* format moved along with the runtime one. Until that
comparison is done, treat byte-parity with native as verified for 2026-09 only.

### Scope names: one deliberate translation

`variable.scopes` reports `STROKE_COLOR` where the native export writes `STROKE`; everything
appearing in both is spelled identically. `NATIVE_SCOPE_NAMES` in `code.ts` is that one-entry map.
Scopes occurring only in collections with no native export to compare against (CORNER_RADIUS,
FONT_*, LINE_HEIGHT, LETTER_SPACING, STROKE_FLOAT, …) pass through untouched rather than being
guessed at — if a hand export of Shape and Space or Responsive Typography ever disagrees, that map
is the place to fix it.

Figma also **omits** `com.figma.scopes` entirely for a variable with no scopes; Relay does the
same rather than writing `[]`.

## ✅ Settled: collections were missing because they're subscribed from a library

`getLocalVariableCollectionsAsync()` only returns collections the file *owns*. Global Values is
published from another file, so it was invisible — and every `Brand/*` token aliases into it,
which meant they all resolved to `null` and would have emitted an empty `$value`.

Extraction never filtered by collection name, so a stale name list was never the cause. (That
*was* a bug in the diagnostic's probe list, fixed separately.)

The fix is in `buildVariableIndex`: after indexing the local collections it chases every
alias/expression target id through `getVariableByIdAsync` until the set closes, pulling in library
variables one at a time. Depth-capped at 12 hops. `getVariableCollectionByIdAsync` fills in the
owning collection so cross-collection alias data stays accurate.

Diagnostics still reports library collections separately (via
`figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`, which needs the `teamlibrary`
manifest permission — present), which is the fastest way to confirm this if it recurs.

## Verification expectations

There's no test suite. Minimum bar before claiming something works:

- `npx tsc --noEmit` clean
- `npm run build` succeeds
- **Load the built `dist/ui.html` in a real browser** and confirm React mounts, the three tabs
  render, and the console is clean. This is how bug #3 above was caught — a green webpack build
  says nothing about whether Figma can actually render the panel.
- Anything touching the Figma API itself can only be verified by Dylan running it in Figma.
  Say so plainly rather than implying you tested it.

**The emitter, though, can be verified offline** — and should be, because it's where the subtle
bugs live. Take a pair of real "Export variables" downloads from Figma, reconstruct the runtime
state they imply (`{Ref}` → `VARIABLE_ALIAS`, `composedColor` → `VARIABLE_EXPRESSION`, `aliasData`
→ an alias into a synthetic library collection), stub the `figma` global with it, transpile
`src/code.ts` with `ts.transpileModule`, and diff the emitted files against the originals with
`JSON.stringify` — key order included, since matching Figma's key order is the whole point.

That round trip caught the two-form `colorArg.alias` shape, which reading the emitter alone would
not have. As of 0.5.0 the harness runs three checks, and all pass:

1. **Parity** — the committed 2026-09 export (`subliminal-design-system`:
   `design-system/src/tokens/relay-export/`, 945 tokens) rebuilt from *each* runtime shape in turn;
   both reproduce it byte-for-byte. (The 2026-09 native files themselves were lost to a container
   recycle; that export was verified against them at the time, differing only in the two scope
   fixes, which the harness applies.)
2. **Real data** — a pre-0.5 export's leaked `$value`s *are* the literal `valuesByMode` objects,
   so the 2026-11 export reconstructs the exact runtime state of the current file. All 249
   composed colours recover with the right Brand base, name and `fround` alpha; the other 688
   tokens are unchanged; and three rows match Figma AI's independently produced opacity table.
3. **Discrimination** — the *old* code run on the same data must reproduce the 249 leaks (or test
   2 proves nothing), and a made-up future shape must be emptied, marked, reported once per mode,
   and named by the diagnostic.

The fixtures are brand data, so the harness lives outside the repo; the steps above are enough
to rebuild it.

## Conventions

- Conventional-ish commit subjects (`feat:`, `fix:`, `chore:`), with a body explaining *why*.
- Don't hardcode Figma variable or collection names — the file gets restructured, and hardcoded
  names fail silently. Discover by shape or enumerate.
- Dylan works on Windows/PowerShell. Keep npm scripts cross-platform (no shell `cp`/`cat`), and
  remember `curl` there is aliased to `Invoke-WebRequest` — tell him `curl.exe` for real curl.

## Known follow-ups (not done)

- `GitHubExport` pushes the whole payload as a single JSON blob. It should push the separate
  per-collection files, which needs the GitHub tree API.
- Text styles are still exported as `$value: style.name`. Effect styles were fixed to emit real
  `boxShadow`/`filter` CSS; text styles weren't, because nothing downstream consumes them yet.
