/**
 * code.ts — Subliminal Relay
 *
 * Runs inside Figma's plugin sandbox. Reads variables and styles and emits Figma's *native*
 * variable-export shape, one file per collection per mode, so Relay output and a manual
 * "Export variables" download are interchangeable downstream.
 */

import {
  AliasData,
  ColorValue,
  ComposedColor,
  ComposedColorValue,
  DesignToken,
  DiagnosticReport,
  ExportProblem,
  RuntimeVariableValue,
  SubliminalTokenExport,
  TokenCollection,
  TokenFile,
  TextStyleVariableRef,
  TokenValue,
  UIToPluginMessage,
  VariableExpressionValue,
  VariableProbe,
} from './types';

const PLUGIN_VERSION = '0.6.0';

/** How many of each discovered category the diagnostic dumps in full. */
const PROBES_PER_CATEGORY = 4;

figma.showUI(__html__, { width: 480, height: 580, title: 'Subliminal Relay' });

figma.ui.onmessage = (msg: UIToPluginMessage) => {
  switch (msg.type) {
    case 'EXTRACT_TOKENS':
      run(extractAndSendTokens);
      break;
    case 'RUN_DIAGNOSTIC':
      run(runDiagnostic);
      break;
    case 'CLOSE_PLUGIN':
      figma.closePlugin();
      break;
  }
};

function run(task: () => Promise<void>): void {
  task().catch((err) => {
    const message = err instanceof Error ? err.message : 'Unknown error.';
    figma.ui.postMessage({ type: 'EXPORT_ERROR', message });
  });
}

// ─── Variable index ──────────────────────────────────────────────────────────

interface VarRecord {
  variable: Variable;
  collection: VariableCollection;
}

/**
 * Every variable reachable from the local collections, keyed by id, so alias targets resolve
 * synchronously afterwards.
 *
 * The index deliberately reaches *past* the local collections. `getLocalVariableCollectionsAsync`
 * only returns collections this file owns, but an alias can point into a subscribed library
 * collection (Intent Colors' `Brand/*` all alias into the published Global Values, whose ids carry
 * the `/-1:-1` suffix characteristic of a library variable). Those variables are still readable
 * one at a time by id once something in the file references them, so after indexing the local
 * collections we chase every alias/expression target until the set closes. Without this, every
 * `Brand/*` token — and therefore every composed colour derived from one — would resolve to null
 * and emit an empty `$value`.
 */
async function buildVariableIndex(collections: VariableCollection[]): Promise<Map<string, VarRecord>> {
  const index = new Map<string, VarRecord>();
  const collectionsById = new Map<string, VariableCollection>();
  for (const collection of collections) collectionsById.set(collection.id, collection);

  const seen = new Set<string>();
  let frontier: string[] = [];
  for (const collection of collections) frontier = frontier.concat(collection.variableIds);

  // Depth-capped: an alias chain that long is a data problem, not something to hang on.
  for (let hop = 0; hop < 12 && frontier.length > 0; hop++) {
    const next: string[] = [];

    for (const id of frontier) {
      if (seen.has(id)) continue;
      seen.add(id);

      const variable = await figma.variables.getVariableByIdAsync(id);
      if (!variable) continue;

      let collection = collectionsById.get(variable.variableCollectionId);
      if (!collection) {
        const fetched = await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId);
        if (!fetched) continue;
        collection = fetched;
        collectionsById.set(collection.id, collection);
      }

      index.set(id, { variable, collection });

      for (const modeId of Object.keys(variable.valuesByMode)) {
        for (const target of aliasTargetIds(variable.valuesByMode[modeId])) {
          if (!seen.has(target)) next.push(target);
        }
      }
    }

    frontier = next;
  }

  return index;
}

/** Every variable id a raw value points at — directly, or through a composed colour or expression. */
function aliasTargetIds(value: unknown): string[] {
  if (isVariableAlias(value)) return [value.id];

  const composed = readComposedColor(value);
  if (composed) return aliasTargetIds(composed.color);

  if (isVariableExpression(value)) {
    const ids: string[] = [];
    for (const arg of value.expressionArguments) {
      for (const id of aliasTargetIds(arg)) ids.push(id);
    }
    return ids;
  }
  return [];
}

// ─── Value conversion ────────────────────────────────────────────────────────

function isRgb(value: unknown): value is RGB {
  return typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value;
}

function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as VariableAlias).type === 'VARIABLE_ALIAS'
  );
}

/**
 * A Figma variable expression — the 2026-09 carrier for "alias + opacity", and potentially for
 * other expression functions Relay doesn't evaluate. See `VariableExpressionValue`.
 */
function isVariableExpression(value: unknown): value is VariableExpressionValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as VariableExpressionValue).type === 'VARIABLE_EXPRESSION' &&
    Array.isArray((value as VariableExpressionValue).expressionArguments)
  );
}

/** The 2026-11 carrier for "alias + opacity". See `ComposedColorValue`. */
function isComposedColorValue(value: unknown): value is ComposedColorValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    'color' in value &&
    typeof (value as ComposedColorValue).opacity === 'number'
  );
}

const COMPOSE_COLOR = 'COMPOSE_COLOR';

/** "Alias + opacity", normalized away from whichever runtime shape delivered it. */
interface ComposedColorArgs {
  color: unknown;
  opacity: unknown;
}

/**
 * Figma has delivered composed colours in two different runtime shapes, neither of them in the
 * published typings:
 *
 *   2026-09   { type: 'VARIABLE_EXPRESSION', expressionFunction: 'COMPOSE_COLOR',
 *               expressionArguments: [color, opacity] }
 *   2026-11   { color, opacity }
 *
 * Relay reads both, so neither a Figma rollout nor an older file breaks an export. Everything
 * downstream works on the normalized pair — if Figma moves it a third time, this is the only
 * function that changes. (The 2026-11 move went unnoticed until an export came back with 249
 * raw API objects in place of colours; `describeProblem` is what now catches that.)
 */
function readComposedColor(value: unknown): ComposedColorArgs | null {
  if (isComposedColorValue(value)) return { color: value.color, opacity: value.opacity };
  if (isVariableExpression(value) && value.expressionFunction === COMPOSE_COLOR) {
    return { color: value.expressionArguments[0], opacity: value.expressionArguments[1] };
  }
  return null;
}

/**
 * Figma stores the opacity of a composed colour on a 0–100 scale and the resulting alpha as a
 * 32-bit float. Rounding through `fround` reproduces the native export exactly — 80 becomes
 * 0.800000011920929, not 0.8 — which is what keeps a Relay export byte-comparable with a manual
 * "Export variables" download. Verified against all 261 composed tokens across both modes.
 */
function opacityToAlpha(opacity: number): number {
  return Math.fround(opacity / 100);
}

function toColorValue(color: RGB | RGBA): ColorValue {
  const alpha = 'a' in color ? color.a : 1;
  const channel = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0').toUpperCase();

  return {
    colorSpace: 'srgb',
    components: [color.r, color.g, color.b],
    alpha,
    hex: `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`,
  };
}

/** Figma variable name → dot path used in same-collection refs: "Brand/Neutral" → "Brand.Neutral" */
function toRefPath(variableName: string): string {
  return variableName.split('/').join('.');
}

/**
 * Pick the mode to read on a *target* collection when following a cross-collection alias.
 * Prefers a mode of the same name (so Lightmode→Lightmode stays aligned across collections)
 * and otherwise falls back to that collection's default mode.
 */
function pickTargetMode(target: VariableCollection, currentModeName: string): string {
  const sameName = target.modes.find((m) => m.name === currentModeName);
  return sameName ? sameName.modeId : target.defaultModeId;
}

/** Follow an alias chain to a concrete (non-alias) value. Depth-capped against cycles. */
function resolveConcrete(
  record: VarRecord,
  modeId: string,
  index: Map<string, VarRecord>,
  modeName: string,
  depth = 0,
): RuntimeVariableValue | null {
  if (depth > 10) return null;
  return resolveValue(record.variable.valuesByMode[modeId], index, modeName, depth);
}

/**
 * Reduce a raw value to a concrete one, following aliases and evaluating expressions.
 * A composed colour collapses to its base colour carrying the composed alpha, which is exactly
 * what Figma writes into `$value` — the *relationship* is preserved separately, in
 * `com.figma.composedColor`.
 */
function resolveValue(
  value: RuntimeVariableValue | undefined,
  index: Map<string, VarRecord>,
  modeName: string,
  depth = 0,
): RuntimeVariableValue | null {
  if (value === undefined || depth > 10) return null;

  if (isVariableAlias(value)) {
    const target = index.get(value.id);
    if (!target) return null; // not reachable from this file even after the index closure
    return resolveConcrete(target, pickTargetMode(target.collection, modeName), index, modeName, depth + 1);
  }

  const composed = readComposedColor(value);
  if (composed) {
    const base = resolveValue(composed.color as RuntimeVariableValue, index, modeName, depth + 1);
    if (!isRgb(base) || typeof composed.opacity !== 'number') return null;

    return { r: base.r, g: base.g, b: base.b, a: opacityToAlpha(composed.opacity) };
  }

  if (isVariableExpression(value)) return null; // an expression function Relay can't evaluate

  return value;
}

/**
 * A resolved value as `$value`. An object that isn't a colour is *refused* rather than passed
 * through: that pass-through is precisely how the 2026-11 export shipped raw `{color, opacity}`
 * objects as colour values. The token is marked instead, so `describeProblem` reports it.
 */
function toTokenValue(value: RuntimeVariableValue | null, token: DesignToken): TokenValue {
  if (value === null) return '';
  if (isRgb(value)) return toColorValue(value);
  if (typeof value === 'object') {
    token.$extensions!['com.subliminal.unreadableValue'] = { raw: JSON.stringify(value) };
    return '';
  }
  return value;
}

// ─── Token emission ──────────────────────────────────────────────────────────

function mapVariableType(type: VariableResolvedDataType): string {
  switch (type) {
    case 'COLOR': return 'color';
    case 'FLOAT': return 'number';
    case 'STRING': return 'string';
    case 'BOOLEAN': return 'boolean';
    default: return 'unknown';
  }
}

/**
 * The Plugin API and the native export disagree on one scope name: `variable.scopes` reports
 * `STROKE_COLOR` where "Export variables" writes `STROKE`. Every other value that appears in both
 * — ALL_SCOPES, ALL_FILLS, FRAME_FILL, SHAPE_FILL, TEXT_FILL, EFFECT_COLOR, EFFECT_FLOAT — is
 * spelled identically, so this is a one-entry map rather than a translation table.
 *
 * Scopes that only occur in collections we have no native export to compare against
 * (CORNER_RADIUS, FONT_*, LINE_HEIGHT, LETTER_SPACING, STROKE_FLOAT, …) pass through untouched.
 * That's the honest default — inventing a mapping for them would be guessing — but if a hand
 * export of Shape and Space or Responsive Typography ever disagrees, this map is where it's fixed.
 */
const NATIVE_SCOPE_NAMES: Record<string, string> = {
  STROKE_COLOR: 'STROKE',
};

function toNativeScopes(scopes: readonly string[]): string[] {
  return scopes.map((scope) => NATIVE_SCOPE_NAMES[scope] || scope);
}

/**
 * Identify an alias target the way Figma's export does. An unresolvable target is named rather
 * than dropped, so a broken link is visible in the output instead of looking like a plain value.
 */
function describeAlias(id: string, target: VarRecord | undefined): AliasData {
  return {
    targetVariableId: id,
    targetVariableName: target ? target.variable.name : '(unresolved — library variable)',
    targetVariableSetId: target ? target.collection.id : '',
    targetVariableSetName: target ? target.collection.name : '(unresolved)',
  };
}

function buildToken(
  record: VarRecord,
  modeId: string,
  modeName: string,
  index: Map<string, VarRecord>,
): DesignToken | null {
  const { variable, collection } = record;
  const raw: RuntimeVariableValue | undefined = variable.valuesByMode[modeId];
  if (raw === undefined) return null;

  // Key insertion order matters: it's what makes a Relay file diff cleanly against a manual
  // "Export variables" download. Figma writes $type, $value, $description, $extensions.
  const token: DesignToken = {
    $type: mapVariableType(variable.resolvedType),
    $value: '',
  };
  if (variable.description) token.$description = variable.description;
  token.$extensions = { 'com.figma.variableId': variable.id };
  // Figma omits the key entirely for a variable with no scopes rather than writing `[]`.
  if (variable.scopes.length > 0) token.$extensions['com.figma.scopes'] = toNativeScopes(variable.scopes);

  // Composition is checked before aliasing: a composed colour's base *is* an alias, but Figma
  // emits the flattened value plus `composedColor` — never a `{Ref}` and never `aliasData`.
  // Verified against native exports of both modes.
  const composed = readComposedColor(raw);
  if (composed) {
    token.$value = toTokenValue(resolveValue(raw, index, modeName), token);

    const colorSource = composed.color;
    const opacity = composed.opacity;

    let colorArg: ComposedColor['colorArg'];
    if (isVariableAlias(colorSource)) {
      const target = index.get(colorSource.id);
      colorArg = {
        type: 'alias',
        // Mirrors the split `$value` makes between "{Ref}" and com.figma.aliasData: a base in
        // this same collection is named, one from elsewhere carries full alias data. Note the
        // name is the slash form ("Brand/Neutral"), not the dot form used by `{Ref}`.
        alias:
          target && target.collection.id === collection.id
            ? { targetVariableName: target.variable.name }
            : describeAlias(colorSource.id, target),
      };
    } else if (isRgb(colorSource)) {
      colorArg = { type: 'color', value: toColorValue(colorSource) };
    } else {
      const nested = resolveValue(colorSource as RuntimeVariableValue, index, modeName);
      colorArg = isRgb(nested)
        ? { type: 'color', value: toColorValue(nested) }
        : { type: 'alias', alias: { targetVariableName: '(unresolved)' } };
    }

    token.$extensions!['com.figma.composedColor'] = {
      colorArg,
      opacityArg: { type: 'number', value: typeof opacity === 'number' ? opacity : 0 },
    };
    return token;
  }

  if (isVariableExpression(raw)) {
    token.$extensions!['com.subliminal.unsupportedExpression'] = {
      expressionFunction: raw.expressionFunction,
      raw: JSON.stringify(raw),
    };
    return token;
  }

  if (isVariableAlias(raw)) {
    const target = index.get(raw.id);

    // Same collection → emit a portable "{Group.Name}" reference, matching Figma's own export.
    if (target && target.collection.id === collection.id) {
      token.$value = `{${toRefPath(target.variable.name)}}`;
      return token;
    }

    // Cross-collection (or library) → Figma emits the resolved value plus aliasData.
    const concrete = target
      ? resolveConcrete(target, pickTargetMode(target.collection, modeName), index, modeName)
      : null;

    token.$value = toTokenValue(concrete, token);
    token.$extensions!['com.figma.aliasData'] = describeAlias(raw.id, target);
    return token;
  }

  token.$value = toTokenValue(raw, token);
  return token;
}

/** Keep a raw dump short enough to read in the plugin panel. */
function clip(text: string, max = 120): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Does `$value` actually match `$type`? This is the export's sanity check, run on every token —
 * the one that would have caught the 2026-11 export, which carried 249 raw API objects in place
 * of colours and looked complete. Returns null when the token is sound.
 */
function describeProblem(token: DesignToken): string | null {
  const ext = token.$extensions || {};
  const unreadable = ext['com.subliminal.unreadableValue'];
  if (unreadable) return `unrecognised value shape — ${clip(unreadable.raw)}`;
  const unsupported = ext['com.subliminal.unsupportedExpression'];
  if (unsupported) return `unsupported expression ${unsupported.expressionFunction}`;

  const value = token.$value;
  // A same-collection `{Group.Name}` reference is valid for any type.
  if (typeof value === 'string' && /^\{.+\}$/.test(value)) return null;

  switch (token.$type) {
    case 'color':
      if (typeof value === 'object' && value !== null && 'colorSpace' in value) return null;
      return value === ''
        ? 'colour could not be resolved — broken or unreachable alias'
        : `not a colour — ${clip(JSON.stringify(value))}`;
    case 'number':
      return typeof value === 'number' ? null : `not a number — ${clip(JSON.stringify(value))}`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `not a boolean — ${clip(JSON.stringify(value))}`;
    case 'string':
      return typeof value === 'string' ? null : `not a string — ${clip(JSON.stringify(value))}`;
    default:
      return `unsupported variable type "${token.$type}"`;
  }
}

function setNestedToken(target: TokenCollection, name: string, token: DesignToken): void {
  const parts = name.split('/');
  let current = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const existing = current[part];
    if (!existing || typeof existing !== 'object' || '$value' in existing) {
      current[part] = {};
    }
    current = current[part] as TokenCollection;
  }

  current[parts[parts.length - 1]] = token;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

async function extractAndSendTokens(): Promise<void> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const index = await buildVariableIndex(collections);

  const files: TokenFile[] = [];
  const problems: ExportProblem[] = [];

  for (const collection of collections) {
    // One file per mode — the scaffold only ever read defaultModeId, which silently dropped
    // Darkmode and two of the three typography breakpoints.
    for (const mode of collection.modes) {
      const fileName = `${collection.name}.${mode.name}.tokens.json`;
      const tokens: TokenCollection = {};

      for (const id of collection.variableIds) {
        const record = index.get(id);
        if (!record) continue;

        const token = buildToken(record, mode.modeId, mode.name, index);
        if (!token) continue;

        setNestedToken(tokens, record.variable.name, token);
        const reason = describeProblem(token);
        if (reason) problems.push({ fileName, tokenPath: record.variable.name, reason });
      }

      tokens.$extensions = { 'com.figma.modeName': mode.name } as unknown as TokenCollection;

      files.push({ collectionName: collection.name, modeName: mode.name, fileName, tokens });
    }
  }

  const payload: SubliminalTokenExport = {
    meta: {
      exportedAt: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION,
      figmaFileName: figma.root.name,
      collections: collections.map((c) => ({
        name: c.name,
        modes: c.modes.map((m) => m.name),
        variableCount: c.variableIds.length,
      })),
      problems,
    },
    files,
    effectStyles: await extractEffectStyles(),
    textStyles: await extractTextStyles(),
  };

  figma.ui.postMessage({ type: 'TOKENS_EXTRACTED', payload });
}

// ─── Effect styles ───────────────────────────────────────────────────────────

function rgbaCss({ r, g, b, a }: RGBA): string {
  const c = (n: number) => Math.round(n * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a})`;
}

/**
 * Effect styles export their real CSS, not their name — SDS's pipeline reads
 * `$value.css.boxShadow`. The scaffold set `$value` to `style.name`, which was unusable.
 */
async function extractEffectStyles(): Promise<TokenCollection> {
  const styles = await figma.getLocalEffectStylesAsync();
  const result: TokenCollection = {};

  for (const style of styles) {
    const shadows: string[] = [];
    let filter: string | undefined;
    let backdropFilter: string | undefined;

    for (const effect of style.effects) {
      if (!effect.visible) continue;

      switch (effect.type) {
        case 'DROP_SHADOW':
        case 'INNER_SHADOW': {
          const inset = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
          shadows.push(
            `${inset}${effect.offset.x}px ${effect.offset.y}px ${effect.radius}px ${effect.spread ?? 0}px ${rgbaCss(effect.color)}`,
          );
          break;
        }
        case 'LAYER_BLUR':
          filter = `blur(${effect.radius}px)`;
          break;
        case 'BACKGROUND_BLUR':
          backdropFilter = `blur(${effect.radius}px)`;
          break;
      }
    }

    const css: Record<string, string> = {};
    if (shadows.length) css.boxShadow = shadows.join(', ');
    if (filter) css.filter = filter;
    if (backdropFilter) css.backdropFilter = backdropFilter;

    const cssRaw = Object.keys(css)
      .map((key) => `${key.replace(/([A-Z])/g, '-$1').toLowerCase()}: ${css[key]};`)
      .join(' ');

    const token = {
      $type: 'effect',
      $value: { css, cssRaw, emotion: css, $effects: style.effects },
    } as unknown as DesignToken;
    if (style.description) token.$description = style.description;

    setNestedToken(result, style.name, token);
  }

  return result;
}

// ─── Text styles ─────────────────────────────────────────────────────────────

/** The text-style fields Figma lets a variable drive. */
const TEXT_STYLE_BINDABLE = [
  'fontFamily',
  'fontStyle',
  'fontSize',
  'fontWeight',
  'lineHeight',
  'letterSpacing',
  'paragraphSpacing',
  'paragraphIndent',
] as const;

/**
 * Text styles export what each one *is* and, more importantly, which variable drives each field.
 * SDS builds its type classes from those bindings, so a style hooked to a different variable in
 * Figma changes the code with no other edit. A style field with no variable is simply absent from
 * `com.subliminal.boundVariables`, which the build treats as an error for the fields a type style
 * needs.
 *
 * Variables are named by collection and path, not id: ids mean nothing outside this file.
 */
async function extractTextStyles(): Promise<TokenCollection> {
  const styles = await figma.getLocalTextStylesAsync();
  const result: TokenCollection = {};
  const resolved = new Map<string, TextStyleVariableRef | null>();

  const resolve = async (alias: VariableAlias): Promise<TextStyleVariableRef | null> => {
    if (!resolved.has(alias.id)) {
      const variable = await figma.variables.getVariableByIdAsync(alias.id);
      const collection = variable
        ? await figma.variables.getVariableCollectionByIdAsync(variable.variableCollectionId)
        : null;
      resolved.set(alias.id, variable ? { collection: collection ? collection.name : '', name: variable.name } : null);
    }
    return resolved.get(alias.id) ?? null;
  };

  for (const style of styles) {
    const bound: Record<string, TextStyleVariableRef> = {};
    const bindings = (style.boundVariables ?? {}) as Record<string, VariableAlias | undefined>;
    for (const field of TEXT_STYLE_BINDABLE) {
      const alias = bindings[field];
      if (!alias) continue;
      const ref = await resolve(alias);
      if (ref) bound[field] = ref;
    }

    const { lineHeight, letterSpacing } = style;
    const token = {
      $type: 'typography',
      $value: {
        fontFamily: style.fontName.family,
        fontStyle: style.fontName.style,
        fontSize: style.fontSize,
        lineHeight: lineHeight.unit === 'AUTO' ? { unit: 'AUTO' } : { unit: lineHeight.unit, value: lineHeight.value },
        letterSpacing: { unit: letterSpacing.unit, value: letterSpacing.value },
        textCase: style.textCase,
        textDecoration: style.textDecoration,
        paragraphSpacing: style.paragraphSpacing,
        paragraphIndent: style.paragraphIndent,
      },
      $extensions: {
        'com.figma.styleId': style.id,
        'com.subliminal.boundVariables': bound,
      },
    } as unknown as DesignToken;
    if (style.description) token.$description = style.description;

    setNestedToken(result, style.name, token);
  }

  return result;
}

// ─── Diagnostic ──────────────────────────────────────────────────────────────

/**
 * Reports what `valuesByMode` *actually* returns at runtime for variables that are
 * alias + opacity in the Figma file. The published typings say VariableValue can only be
 * boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias — with no
 * composed-color member — but typings lag the runtime, so this inspects real object keys
 * instead of trusting the type.
 */
async function runDiagnostic(): Promise<void> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const index = await buildVariableIndex(collections);

  // Both composed-colour shapes are absent from the published typings but are understood by
  // Relay, so their keys count as known here — `undocumentedKeys` should mean "a shape nobody
  // has looked at yet", which is the thing worth flagging.
  const documentedKeys = new Set([
    'r', 'g', 'b', 'a', 'type', 'id', 'expressionFunction', 'expressionArguments', 'color', 'opacity',
  ]);
  const undocumented = new Set<string>();
  const shapeCounts: Record<string, number> = {};
  const probes: VariableProbe[] = [];
  const categoryCounts: Record<string, number> = {};
  let composedCount = 0;

  const COMPOSED_CURRENT = 'ComposedColor {color, opacity}';
  const COMPOSED_LEGACY = `VariableExpression (${COMPOSE_COLOR})`;
  const UNRECOGNISED = 'Unrecognised object';

  function classify(value: RuntimeVariableValue): string {
    if (isComposedColorValue(value)) return COMPOSED_CURRENT;
    if (isVariableExpression(value)) return `VariableExpression (${value.expressionFunction})`;
    if (isVariableAlias(value)) return 'VariableAlias';
    if (isRgb(value)) {
      const alpha = 'a' in value ? (value as RGBA).a : 1;
      return alpha < 1 ? 'RGBA (alpha < 1)' : 'RGB/RGBA (opaque)';
    }
    // Name the keys: "object" is what this said in 2026-11, and it hid a format change.
    if (typeof value === 'object' && value !== null) {
      return `${UNRECOGNISED} {${Object.keys(value).sort().join(', ')}}`;
    }
    return typeof value;
  }

  for (const collection of collections) {
    for (const id of collection.variableIds) {
      const record = index.get(id);
      if (!record) continue;
      const { variable } = record;

      for (const mode of collection.modes) {
        const raw = variable.valuesByMode[mode.modeId];
        if (raw === undefined) continue;

        if (variable.resolvedType === 'COLOR') {
          const shape = classify(raw);
          shapeCounts[shape] = (shapeCounts[shape] || 0) + 1;
          if (readComposedColor(raw)) composedCount++;
        }

        if (raw && typeof raw === 'object') {
          for (const key of Object.keys(raw)) {
            if (!documentedKeys.has(key)) undocumented.add(key);
          }
        }
      }

      // Probe candidates are *discovered*, not hardcoded — a fixed name list goes stale the
      // moment the Figma file is restructured. Composed values are the interesting ones; a
      // translucent RGBA would be the signature of a *flattened* alias+opacity, and aliases and
      // opaque values are sampled alongside both for contrast.
      if (variable.resolvedType === 'COLOR') {
        const values = collection.modes
          .map((mode) => variable.valuesByMode[mode.modeId] as RuntimeVariableValue | undefined)
          .filter((raw): raw is RuntimeVariableValue => raw !== undefined);
        const shapes = values.map(classify);

        const category = shapes.some((shape) => shape.indexOf(UNRECOGNISED) === 0)
          ? 'unrecognised'
          : values.some((raw) => readComposedColor(raw) !== null)
            ? 'composed'
            : shapes.indexOf('RGBA (alpha < 1)') !== -1
              ? 'translucent'
              : shapes.indexOf('VariableAlias') !== -1 ? 'alias' : 'opaque';

        if ((categoryCounts[category] || 0) < PROBES_PER_CATEGORY) {
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;

          probes.push({
            collectionName: collection.name,
            variableName: variable.name,
            resolvedType: variable.resolvedType,
            values: collection.modes.map((mode) => {
              const raw = variable.valuesByMode[mode.modeId];
              return {
                modeName: mode.name,
                jsType: typeof raw,
                objectKeys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
                json: JSON.stringify(raw),
              };
            }),
          });
        }
      }
    }
  }

  const otherExpressions = Object.keys(shapeCounts).filter(
    (shape) => shape.indexOf('VariableExpression') === 0 && shape !== COMPOSED_LEGACY,
  );
  const unrecognised = Object.keys(shapeCounts).filter((shape) => shape.indexOf(UNRECOGNISED) === 0);

  let verdict: string;
  if (composedCount > 0) {
    const forms = [COMPOSED_CURRENT, COMPOSED_LEGACY]
      .filter((shape) => shapeCounts[shape])
      .map((shape) => `${shapeCounts[shape]} as ${shape}`)
      .join(', ');
    verdict =
      `Composed colours readable: ${composedCount} alias+opacity value(s) (${forms}). ` +
      'Relay exports these as com.figma.composedColor, matching Figma\'s native export.';
  } else if (Object.keys(shapeCounts).indexOf('RGBA (alpha < 1)') !== -1) {
    verdict =
      'No composed values, but translucent RGBA is present — the Plugin API has flattened alias+opacity ' +
      'and the base-variable link is NOT readable. Check that this file actually uses opacity-on-variable.';
  } else {
    verdict = 'No composed or translucent colour values found in this file.';
  }

  if (unrecognised.length > 0) {
    verdict +=
      ` ⚠ Value shapes Relay does NOT recognise, which will export as empty: ${unrecognised.join('; ')}. ` +
      'Figma has likely changed a format — readComposedColor in code.ts is the usual place to fix it.';
  }
  if (otherExpressions.length > 0) {
    verdict += ` Also present, and NOT yet supported by Relay: ${otherExpressions.join(', ')}.`;
  }
  if (undocumented.size > 0) {
    verdict += ` Undocumented keys seen on raw values: ${Array.from(undocumented).join(', ')}.`;
  }

  // A collection published from another file is invisible to getLocalVariableCollectionsAsync,
  // which is the most likely reason a collection would appear "missing" from an export.
  let libraryCollections: { name: string; libraryName: string; key: string }[] = [];
  let libraryLookupError: string | null = null;
  try {
    const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    libraryCollections = libs.map((l) => ({
      name: l.name,
      libraryName: l.libraryName,
      key: l.key,
    }));
  } catch (err) {
    libraryLookupError = err instanceof Error ? err.message : String(err);
  }

  const report: DiagnosticReport = {
    figmaFileName: figma.root.name,
    pluginApiVerdict: verdict,
    libraryCollections,
    libraryLookupError,
    collections: collections.map((c) => ({
      name: c.name,
      id: c.id,
      modes: c.modes.map((m) => ({ name: m.name, id: m.modeId })),
      variableCount: c.variableIds.length,
      isRemote: c.remote,
    })),
    valueShapeCounts: shapeCounts,
    probes,
    undocumentedKeys: Array.from(undocumented),
  };

  figma.ui.postMessage({ type: 'DIAGNOSTIC_COMPLETE', payload: report });
}
