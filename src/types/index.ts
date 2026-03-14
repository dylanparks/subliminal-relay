// ─── Token Types ────────────────────────────────────────────────────────────

export type TokenValue = string | number | boolean;

export interface DesignToken {
  $value: TokenValue;
  $type: string;
  $description?: string;
}

export interface TokenCollection {
  [groupOrName: string]: DesignToken | TokenCollection;
}

// ─── Per-Collection Export ───────────────────────────────────────────────────

export interface CollectionFile {
  /** The exact Figma collection name (e.g. "Global Colors") */
  collectionName: string;
  /** The output filename in the ZIP (e.g. "global-colors.json", "intent-colors-dark.json") */
  fileName: string;
  /** Number of variables resolved from this collection mode */
  tokenCount: number;
  /** Nested token tree */
  tokens: TokenCollection;
  /**
   * The Figma mode name this file represents (e.g. "Lightmode", "Darkmode", "LG").
   * Omitted for single-mode collections.
   */
  modeName?: string;
}

export interface ScanResult {
  exportedAt: string;
  pluginVersion: string;
  figmaFileName: string;
  /** Collections that were found and scanned */
  collections: CollectionFile[];
  /** Target collection names not found in the file */
  missing: string[];
}

// ─── Plugin Messages ─────────────────────────────────────────────────────────

export type PluginToUIMessage =
  | { type: 'SCAN_COMPLETE'; payload: ScanResult }
  | { type: 'EXPORT_ERROR'; message: string };

export type UIToPluginMessage =
  | { type: 'SCAN_COLLECTIONS' }
  | { type: 'CLOSE_PLUGIN' };
