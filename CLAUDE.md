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

Working branch: **`claude/brand-alpha-export`**. Version `0.3.0`.

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

## 🔴 The open question — settle this before designing the emitter

**Does the Figma Plugin API expose "alias + opacity" composition at all?**

Figma's *native* export clearly has it (`$extensions["com.figma.composedColor"]` with `colorArg`
and `opacityArg`). But the published typings (`@figma/plugin-typings@1.138.0`) declare:

```ts
type VariableValue = boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias
```

— with **no composed-colour member**. Typings do lag the runtime, so this isn't conclusive.

Two possible outcomes, needing very different designs:

- **`valuesByMode` returns resolved `RGBA`** → composition is only *partly* recoverable by
  matching RGB against Brand, and it's **genuinely ambiguous**: in light mode `Brand/Primary` and
  `Brand/Accent` are both `#1A39DE`, and `Background`/`Static`/`Primary-foreground`/
  `Secondary-foreground` are all `#FFFFFF`. Checking both modes disambiguates some but *not*
  Primary-vs-Accent. That leaves path-name heuristics — rejected, since it's how you ship a
  subtly wrong colour that nobody notices for a year.
- **It returns a bare `VariableAlias` with opacity dropped** → worse, and silent: hover, active
  and disabled would all collapse to `{Brand.Primary}`.

**How to settle it:** the plugin's **Diagnostics** tab. It dumps raw `valuesByMode` for
auto-discovered composed candidates and — the important part — reports the *actual runtime object
keys*, so an undocumented field would surface even though the typings don't declare one. Run it
against the real Figma file and read the verdict.

Do **not** design the emitter before this is answered.

## 🔴 Second open question — are collections missing from the export?

Reported symptom: not all collections come through.

Note that extraction does **not** filter by collection name — it iterates whatever
`getLocalVariableCollectionsAsync()` returns. So a stale name list isn't the cause (that *was* a
bug in the diagnostic's probe list, now fixed by discovering probes by value shape instead).

Leading hypothesis: **`getLocalVariableCollectionsAsync()` cannot see collections published from
another file.** If Global Values is a subscribed library collection rather than one this file
owns, it's invisible to that call. Supporting evidence: exported alias data carries
`targetVariableSetId: "...a06b48.../-1:-1"`, and that `/-1:-1` suffix is characteristic of a
subscribed library variable.

The Diagnostics tab now reports library collections separately (via
`figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync()`, guarded — needs the
`teamlibrary` manifest permission, which is present). If the local list is short and a library
collection shows up there, that's the answer, and the fix is importing library variables by key
(`figma.variables.importVariableByKeyAsync`) rather than anything name-related.

## Verification expectations

There's no test suite. Minimum bar before claiming something works:

- `npx tsc --noEmit` clean
- `npm run build` succeeds
- **Load the built `dist/ui.html` in a real browser** and confirm React mounts, the three tabs
  render, and the console is clean. This is how bug #3 above was caught — a green webpack build
  says nothing about whether Figma can actually render the panel.
- Anything touching the Figma API itself can only be verified by Dylan running it in Figma.
  Say so plainly rather than implying you tested it.

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
