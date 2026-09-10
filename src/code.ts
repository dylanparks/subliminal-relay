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
  DesignToken,
  DiagnosticReport,
  RawValueProbe,
  SubliminalTokenExport,
  TokenCollection,
  TokenFile,
  UIToPluginMessage,
  VariableProbe,
} from './types';

const PLUGIN_VERSION = '0.2.0';

/** Variables whose Figma values are known to be alias + opacity — used by the diagnostic. */
const COMPOSED_PROBE_TARGETS = [
  'Neutral/Content/Secondary',
  'Neutral/Stroke/Default',
  'Interactive/Primary/Filled/Background/Hover',
  'Interactive/Primary/Hollow/Stroke/Default',
  'Effects/ShadowDefault',
];

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
 * Every local variable keyed by id, so alias targets resolve synchronously afterwards.
 * A target missing from this map is a library variable this file can't read — callers
 * degrade to emitting the resolved value rather than failing.
 */
async function buildVariableIndex(collections: VariableCollection[]): Promise<Map<string, VarRecord>> {
  const index = new Map<string, VarRecord>();

  for (const collection of collections) {
    for (const id of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(id);
      if (variable) index.set(id, { variable, collection });
    }
  }

  return index;
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
): VariableValue | null {
  if (depth > 10) return null;

  const value = record.variable.valuesByMode[modeId];
  if (value === undefined) return null;

  if (isVariableAlias(value)) {
    const target = index.get(value.id);
    if (!target) return null; // library variable — not readable from this file
    return resolveConcrete(target, pickTargetMode(target.collection, modeName), index, modeName, depth + 1);
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

function buildToken(
  record: VarRecord,
  modeId: string,
  modeName: string,
  index: Map<string, VarRecord>,
): DesignToken | null {
  const { variable, collection } = record;
  const raw = variable.valuesByMode[modeId];
  if (raw === undefined) return null;

  const token: DesignToken = {
    $type: mapVariableType(variable.resolvedType),
    $value: '',
    $extensions: {
      'com.figma.variableId': variable.id,
      'com.figma.scopes': variable.scopes,
    },
  };
  if (variable.description) token.$description = variable.description;

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

    token.$value = concrete === null
      ? ''
      : isRgb(concrete) ? toColorValue(concrete) : (concrete as string | number | boolean);

    const aliasData: AliasData = {
      targetVariableId: raw.id,
      targetVariableName: target ? target.variable.name : '(unresolved — library variable)',
      targetVariableSetId: target ? target.collection.id : '',
      targetVariableSetName: target ? target.collection.name : '(unresolved)',
    };
    token.$extensions!['com.figma.aliasData'] = aliasData;
    return token;
  }

  token.$value = isRgb(raw) ? toColorValue(raw) : (raw as string | number | boolean);
  return token;
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

  for (const collection of collections) {
    // One file per mode — the scaffold only ever read defaultModeId, which silently dropped
    // Darkmode and two of the three typography breakpoints.
    for (const mode of collection.modes) {
      const tokens: TokenCollection = {};

      for (const id of collection.variableIds) {
        const record = index.get(id);
        if (!record) continue;

        const token = buildToken(record, mode.modeId, mode.name, index);
        if (token) setNestedToken(tokens, record.variable.name, token);
      }

      tokens.$extensions = { 'com.figma.modeName': mode.name } as unknown as TokenCollection;

      files.push({
        collectionName: collection.name,
        modeName: mode.name,
        fileName: `${collection.name}.${mode.name}.tokens.json`,
        tokens,
      });
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
    },
    files,
    effectStyles: await extractEffectStyles(),
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

  const documentedKeys = new Set(['r', 'g', 'b', 'a', 'type', 'id']);
  const undocumented = new Set<string>();
  const shapeCounts: Record<string, number> = {};
  const probes: VariableProbe[] = [];

  function classify(value: VariableValue): string {
    if (isVariableAlias(value)) return 'VariableAlias';
    if (isRgb(value)) {
      const alpha = 'a' in value ? (value as RGBA).a : 1;
      return alpha < 1 ? 'RGBA (alpha < 1)' : 'RGB/RGBA (opaque)';
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
        }

        if (raw && typeof raw === 'object') {
          for (const key of Object.keys(raw)) {
            if (!documentedKeys.has(key)) undocumented.add(key);
          }
        }
      }

      if (COMPOSED_PROBE_TARGETS.indexOf(variable.name) !== -1) {
        const values: RawValueProbe[] = collection.modes.map((mode) => {
          const raw = variable.valuesByMode[mode.modeId];
          return {
            modeName: mode.name,
            jsType: typeof raw,
            objectKeys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
            json: JSON.stringify(raw),
          };
        });

        probes.push({
          collectionName: collection.name,
          variableName: variable.name,
          resolvedType: variable.resolvedType,
          values,
        });
      }
    }
  }

  const sawComposedField = undocumented.size > 0;
  const verdict = sawComposedField
    ? `Undocumented field(s) present on raw values: ${Array.from(undocumented).join(', ')} — the runtime API may expose composition the typings don't declare. Inspect the probes below.`
    : 'No fields beyond the documented RGB/RGBA/VariableAlias shape. If the probes show plain RGBA with alpha < 1, the Plugin API has flattened alias+opacity and the base-variable link is NOT readable from a plugin.';

  const report: DiagnosticReport = {
    figmaFileName: figma.root.name,
    pluginApiVerdict: verdict,
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
