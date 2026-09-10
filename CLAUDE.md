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

## Current state (2026-09-10)

Working branch: **`claude/brand-alpha-export`**. Version `0.4.0`.

```bash
npm install     # lockfile changed — a broken dep was removed
npm run build   # REQUIRED: dist/ is gitignored, so pulling never refreshes the bundle
```

Then in Figma: **Plugins → Development → Import plugin from manifest** → pick `manifest.json`.

`manifest.json` ships with `"id": "REPLACE_WITH_FIGMA_PLUGIN_ID"`. Dylan sets a real id in his
local copy — **don't overwrite it**, and don't invent one (it could collide with a real published
plugin id).

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

Dylan restructured the Figma file around Figma's **alpha-on-variable** feature, consolidating 12
export files into **4 collections**: Global Values (336 vars), Intent Colors (193), Shape and
Space (14), Responsive Typography (65).

Measured from real exports of both modes:

- **17 "Brand" tokens drive 169 of 176 intent tokens** — 131 are composed (a Brand alias + an
  opacity), 38 are pure aliases.
- **162 of 176 intent tokens derive identically in light and dark.** Only 8 differ by opacity,
  6 by kind. Dark mode ≈ swap the 17 knobs + 14 overrides.

The payoff, on the SDS side: emit Brand as its own CSS variable layer, then *derive* intent
tokens with `color-mix(in srgb, var(--sds-brand-x) N%, transparent)`. **A whole new brand becomes
~17 CSS variable overrides at runtime**, with no token rebuild. That's why preserving the
"which Brand token + what opacity" relationship through the export matters so much — flattening
it to literals throws away the entire benefit.

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

`VariableExpressionValue` in `src/types/index.ts` declares the shape; `isVariableExpression` in
`code.ts` guards it. Only `COMPOSE_COLOR` is understood — any other `expressionFunction` is
emitted with a `com.subliminal.unsupportedExpression` marker rather than a silently empty value,
and the Diagnostics verdict calls it out.

### Emitted shape

Composed colours match Figma's native export exactly: `$value` is the base colour carrying the
composed alpha, and the relationship lives in `$extensions["com.figma.composedColor"]`.
Composition is checked **before** aliasing — a composed colour's first argument *is* an alias, but
Figma never emits a `{Ref}` or `aliasData` for one.

`colorArg.alias` has two forms, mirroring how `$value` treats aliases:

- base in the **same collection** → `{ targetVariableName: "Brand/Neutral" }` (slash form here,
  even though same-collection `{Ref}` values use the dot form)
- base in **another collection** → the full `AliasData` object

260 of 261 composed tokens use the short form; `Status/Error/Stroke/Default` in Lightmode is the
one long-form case, composing straight onto Global Values' `Colors/Red/600` at 30%.

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

That round trip currently passes on all 386 tokens across Lightmode and Darkmode. It's what caught
the two-form `colorArg.alias` shape, which reading the emitter alone would not have.

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
