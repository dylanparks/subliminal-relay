/**
 * code.ts — Subliminal Relay
 *
 * Runs inside Figma's plugin sandbox. Responsible for reading variables,
 * local styles, and dispatching extracted token data to the plugin UI.
 */

import { SubliminalTokenExport, TokenCollection, UIToPluginMessage } from './types';

const PLUGIN_VERSION = '0.1.0';

// ─── Plugin Initialization ───────────────────────────────────────────────────

figma.showUI(__html__, { width: 480, height: 580, title: 'Subliminal Relay' });

figma.ui.onmessage = (msg: UIToPluginMessage) => {
  switch (msg.type) {
    case 'EXTRACT_TOKENS':
      extractAndSendTokens();
      break;
    case 'CLOSE_PLUGIN':
      figma.closePlugin();
      break;
  }
};

// ─── Token Extraction ────────────────────────────────────────────────────────

async function extractAndSendTokens(): Promise<void> {
  try {
    const variables = await extractVariables();
    const styles = await extractStyles();

    const payload: SubliminalTokenExport = {
      meta: {
        exportedAt: new Date().toISOString(),
        pluginVersion: PLUGIN_VERSION,
        figmaFileName: figma.root.name,
      },
      variables,
      styles,
    };

    figma.ui.postMessage({ type: 'TOKENS_EXTRACTED', payload });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during extraction.';
    figma.ui.postMessage({ type: 'EXPORT_ERROR', message });
  }
}

// ─── Variable Extraction ─────────────────────────────────────────────────────

async function extractVariables(): Promise<TokenCollection> {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const result: TokenCollection = {};

  for (const collection of collections) {
    const collectionTokens: TokenCollection = {};

    for (const variableId of collection.variableIds) {
      const variable = await figma.variables.getVariableByIdAsync(variableId);
      if (!variable) continue;

      // Use the default mode value (first mode)
      const defaultModeId = collection.defaultModeId;
      const rawValue = variable.valuesByMode[defaultModeId];

      const resolvedValue = resolveVariableValue(rawValue);
      if (resolvedValue === null) continue;

      // Nest tokens by their Figma group path (e.g. "colors/brand/primary")
      setNestedToken(collectionTokens, variable.name, {
        $value: resolvedValue,
        $type: mapVariableType(variable.resolvedType),
        $description: variable.description || undefined,
      });
    }

    result[collection.name] = collectionTokens;
  }

  return result;
}

function resolveVariableValue(value: VariableValue): string | number | boolean | null {
  if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }

  // RGBA color
  if (isRgba(value)) {
    return rgbaToHex(value);
  }

  // Alias — return the variable ID as a reference placeholder
  if (isVariableAlias(value)) {
    return `{alias:${value.id}}`;
  }

  return null;
}

function isRgba(value: unknown): value is RGBA {
  return typeof value === 'object' && value !== null && 'r' in value && 'a' in value;
}

function isVariableAlias(value: unknown): value is VariableAlias {
  return typeof value === 'object' && value !== null && 'type' in value && (value as VariableAlias).type === 'VARIABLE_ALIAS';
}

function rgbaToHex({ r, g, b, a }: RGBA): string {
  const toHex = (n: number) => Math.round(n * 255).toString(16).padStart(2, '0');
  const alpha = a < 1 ? toHex(a) : '';
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${alpha}`;
}

function mapVariableType(type: VariableResolvedDataType): string {
  switch (type) {
    case 'COLOR': return 'color';
    case 'FLOAT': return 'number';
    case 'STRING': return 'string';
    case 'BOOLEAN': return 'boolean';
    default: return 'unknown';
  }
}

// ─── Style Extraction ────────────────────────────────────────────────────────

async function extractStyles(): Promise<SubliminalTokenExport['styles']> {
  const [paintStyles, textStyles, effectStyles] = await Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
  ]);

  const colors: TokenCollection = {};
  for (const style of paintStyles) {
    const paint = style.paints[0];
    if (paint?.type === 'SOLID') {
      setNestedToken(colors, style.name, {
        $value: rgbaToHex({ ...paint.color, a: paint.opacity ?? 1 }),
        $type: 'color',
        $description: style.description || undefined,
      });
    }
  }

  const text: TokenCollection = {};
  for (const style of textStyles) {
    setNestedToken(text, style.name, {
      $value: style.name,
      $type: 'typography',
      $description: style.description || undefined,
    });
  }

  const effects: TokenCollection = {};
  for (const style of effectStyles) {
    setNestedToken(effects, style.name, {
      $value: style.name,
      $type: 'effect',
      $description: style.description || undefined,
    });
  }

  return { colors, text, effects };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * Splits a Figma variable name like "colors/brand/primary" into a
 * nested object path and sets the token value at that location.
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
