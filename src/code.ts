/**
 * code.ts — Subliminal Relay
 *
 * Runs inside Figma's plugin sandbox. Scans the five target variable
 * collections and sends per-collection token data to the plugin UI.
 *
 * Alias resolution strategy:
 *   Figma stores variable aliases as opaque IDs (e.g. VariableID:75:26131).
 *   These are meaningless outside of Figma. Before scanning the target
 *   collections, we do a single pass over ALL variables in the file to build
 *   a lookup map:  variableId → { fileName, tokenPath }
 *
 *   When a variable's value is an alias we substitute the portable W3C
 *   Design Token reference format:
 *     {global-colors.Colors.Cobalt.600}
 *
 *   This makes the exported JSON self-contained and resolvable by the
 *   subliminal-build-tokens CLI without any connection back to Figma.
 */

/// <reference types="@figma/plugin-typings" />

import { CollectionFile, ScanResult, TokenCollection, UIToPluginMessage } from './types';

const PLUGIN_VERSION = '0.1.0';

/** The exact Figma collection names this plugin targets. Order is preserved in the ZIP. */
const TARGET_COLLECTIONS = [
  'Global Colors',
  'Intent Colors',
  'Typography',
  'Shape',
  'Breakpoint',
] as const;

// ─── Plugin Initialization ───────────────────────────────────────────────────

figma.showUI(__html__, { width: 420, height: 520, title: 'Subliminal Relay' });

figma.ui.onmessage = (msg: UIToPluginMessage) => {
  switch (msg.type) {
    case 'SCAN_COLLECTIONS':
      scanAndSend();
      break;
    case 'CLOSE_PLUGIN':
      figma.closePlugin();
      break;
  }
};

// ─── Scan & Send ─────────────────────────────────────────────────────────────

/** Maps a Figma variable ID to its portable token reference components. */
type AliasRef = { fileName: string; tokenPath: string };

async function scanAndSend(): Promise<void> {
  try {
    const allCollections = await figma.variables.getLocalVariableCollectionsAsync();

    // ── Phase 1: single pass over ALL variables in ALL collections ────────────
    // Builds two structures:
    //   lookup       – variableId → AliasRef, used to resolve alias values
    //   variableCache – variableId → Variable, avoids re-fetching in phase 2
    const lookup = new Map<string, AliasRef>();
    const variableCache = new Map<string, Variable>();

    for (const collection of allCollections) {
      const fileName = toFileName(collection.name).replace('.json', '');

      for (const variableId of collection.variableIds) {
        const variable = await figma.variables.getVariableByIdAsync(variableId);
        if (!variable) continue;

        variableCache.set(variableId, variable);
        lookup.set(variableId, {
          fileName,
          // "Colors/Cobalt/600" → "Colors.Cobalt.600"
          tokenPath: variable.name.replace(/\//g, '.'),
        });
      }
    }

    // ── Phase 2: extract tokens from target collections only ──────────────────
    const collections: CollectionFile[] = [];
    const missing: string[] = [];

    for (const targetName of TARGET_COLLECTIONS) {
      const collection = allCollections.find(c => c.name === targetName);

      if (!collection) {
        missing.push(targetName);
        continue;
      }

      const modeEntries = collection.modes; // { modeId: string; name: string }[]
      const isMultiMode = modeEntries.length > 1;

      for (const { modeId, name: modeName } of modeEntries) {
        const tokens: TokenCollection = {};
        let tokenCount = 0;

        for (const variableId of collection.variableIds) {
          const variable = variableCache.get(variableId);
          if (!variable) continue;

          const rawValue = variable.valuesByMode[modeId];
          const resolvedValue = resolveValue(rawValue, lookup);
          if (resolvedValue === null) continue;

          setNestedToken(tokens, variable.name, {
            $value: resolvedValue,
            $type: mapType(variable.resolvedType),
            $description: variable.description || undefined,
          });
          tokenCount++;
        }

        collections.push({
          collectionName: targetName,
          fileName: toFileNameForMode(targetName, modeId, collection.defaultModeId, modeName),
          tokenCount,
          tokens,
          modeName: isMultiMode ? modeName : undefined,
        });
      }
    }

    const payload: ScanResult = {
      exportedAt: new Date().toISOString(),
      pluginVersion: PLUGIN_VERSION,
      figmaFileName: figma.root.name,
      collections,
      missing,
    };

    figma.ui.postMessage({ type: 'SCAN_COMPLETE', payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during scan.';
    figma.ui.postMessage({ type: 'EXPORT_ERROR', message });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toFileName(collectionName: string): string {
  return collectionName.toLowerCase().replace(/\s+/g, '-') + '.json';
}

/**
 * Builds a filename for a specific collection mode.
 * The default mode always gets the base filename (e.g. "intent-colors.json").
 * Non-default modes get a kebab-case mode suffix (e.g. "intent-colors-dark.json").
 * "Lightmode" → "light", "Darkmode" → "dark", "MD" → "md", "XS" → "xs".
 */
function toFileNameForMode(
  collectionName: string,
  modeId: string,
  defaultModeId: string,
  modeName: string,
): string {
  const base = collectionName.toLowerCase().replace(/\s+/g, '-');
  if (modeId === defaultModeId) return `${base}.json`;
  const suffix = modeName
    .toLowerCase()
    .replace(/mode$/i, '')       // "Darkmode" → "dark", "Lightmode" → "light"
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base}-${suffix}.json`;
}

/**
 * Resolves a raw Figma variable value to a portable, export-safe value.
 *
 * - Primitives (string, number, boolean) → returned as-is
 * - RGBA colors → converted to hex string
 * - Variable aliases → resolved to a W3C Design Token reference:
 *     {global-colors.Colors.Cobalt.600}
 *   If the alias target is not in the lookup (e.g. external library variable),
 *   the value is dropped (returns null) rather than emitting a broken ID.
 */
function resolveValue(
  value: VariableValue,
  lookup: Map<string, AliasRef>,
): string | number | boolean | null {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (isRgba(value)) return rgbaToHex(value);
  if (isAlias(value)) {
    const ref = lookup.get(value.id);
    return ref ? `{${ref.fileName}.${ref.tokenPath}}` : null;
  }
  return null;
}

function isRgba(v: unknown): v is RGBA {
  return typeof v === 'object' && v !== null && 'r' in v && 'a' in v;
}

function isAlias(v: unknown): v is VariableAlias {
  return (
    typeof v === 'object' &&
    v !== null &&
    'type' in v &&
    (v as VariableAlias).type === 'VARIABLE_ALIAS'
  );
}

function rgbaToHex({ r, g, b, a }: RGBA): string {
  const ch = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}${a < 1 ? ch(a) : ''}`;
}

function mapType(type: VariableResolvedDataType): string {
  switch (type) {
    case 'COLOR':   return 'color';
    case 'FLOAT':   return 'number';
    case 'STRING':  return 'string';
    case 'BOOLEAN': return 'boolean';
    default:        return 'unknown';
  }
}

/**
 * Splits a Figma variable name like "Colors/Cobalt/600" into a nested object
 * path and sets the token value at that location in the target collection.
 */
function setNestedToken(
  target: TokenCollection,
  name: string,
  token: { $value: string | number | boolean; $type: string; $description?: string },
): void {
  const parts = name.split('/');
  let current = target;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== 'object' || '$value' in current[part]) {
      current[part] = {};
    }
    current = current[part] as TokenCollection;
  }

  current[parts[parts.length - 1]] = token;
}
