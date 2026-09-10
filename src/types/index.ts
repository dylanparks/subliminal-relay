// ─── W3C / Figma-native token shapes ────────────────────────────────────────
//
// Relay emits Figma's *native* variable-export shape rather than inventing its own, so a
// Relay export and a hand-made "Export variables" download from Figma are interchangeable —
// the SDS pipeline only ever needs one parser.

/** A color as Figma emits it: components are 0–1 floats, `hex` excludes alpha. */
export interface ColorValue {
  colorSpace: 'srgb';
  components: [number, number, number];
  alpha: number;
  hex: string;
}

export type TokenValue = ColorValue | string | number | boolean;

/** Records the source variable when a token aliases *across* collections. */
export interface AliasData {
  targetVariableId: string;
  targetVariableName: string;
  targetVariableSetId: string;
  targetVariableSetName: string;
}

/** Records "alias + opacity" composition, when Figma exposes it. See DIAGNOSTIC notes. */
export interface ComposedColor {
  colorArg: { type: 'alias'; alias: { targetVariableName: string } } | { type: 'color'; value: ColorValue };
  opacityArg: { type: 'number'; value: number };
}

export interface DesignToken {
  $type: string;
  $value: TokenValue;
  $description?: string;
  $extensions?: {
    'com.figma.variableId'?: string;
    'com.figma.scopes'?: string[];
    'com.figma.aliasData'?: AliasData;
    'com.figma.composedColor'?: ComposedColor;
  };
}

export interface TokenCollection {
  [groupOrName: string]: DesignToken | TokenCollection;
}

// ─── Export payload ─────────────────────────────────────────────────────────

/** One emitted file: a single collection in a single mode. */
export interface TokenFile {
  collectionName: string;
  modeName: string;
  fileName: string;
  tokens: TokenCollection;
}

export interface SubliminalTokenExport {
  meta: {
    exportedAt: string;
    pluginVersion: string;
    figmaFileName: string;
    collections: { name: string; modes: string[]; variableCount: number }[];
  };
  files: TokenFile[];
  /** Effect styles carry real CSS, not just their names — SDS consumes `css.boxShadow`. */
  effectStyles: TokenCollection;
}

// ─── Diagnostic ─────────────────────────────────────────────────────────────
//
// Answers the open question: does the Plugin API expose alias+opacity ("composed color")
// at all? The published typings say VariableValue is only
// boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias — but typings lag
// the runtime, so this reports the *actual* runtime shape (including undocumented keys)
// rather than trusting the type.

export interface RawValueProbe {
  modeName: string;
  jsType: string;
  /** Real runtime keys — this is what reveals an undocumented composed-color field. */
  objectKeys: string[] | null;
  json: string;
}

export interface VariableProbe {
  collectionName: string;
  variableName: string;
  resolvedType: string;
  values: RawValueProbe[];
}

export interface DiagnosticReport {
  figmaFileName: string;
  pluginApiVerdict: string;
  collections: {
    name: string;
    id: string;
    modes: { name: string; id: string }[];
    variableCount: number;
    isRemote: boolean;
  }[];
  /**
   * Collections published from *other* files. `getLocalVariableCollectionsAsync()` cannot see
   * these, so if a collection is missing from `collections` above it will show up here.
   */
  libraryCollections: { name: string; libraryName: string; key: string }[];
  /** Populated instead of `libraryCollections` when the team-library lookup isn't permitted. */
  libraryLookupError: string | null;
  /** Distribution of raw value shapes across every color variable and mode. */
  valueShapeCounts: Record<string, number>;
  /** Full raw dumps for variables known to be alias+opacity in the Figma file. */
  probes: VariableProbe[];
  /** Keys seen on raw values that the published typings don't document. */
  undocumentedKeys: string[];
}

// ─── GitHub config ──────────────────────────────────────────────────────────

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

// ─── Plugin messages ────────────────────────────────────────────────────────

export type PluginToUIMessage =
  | { type: 'TOKENS_EXTRACTED'; payload: SubliminalTokenExport }
  | { type: 'DIAGNOSTIC_COMPLETE'; payload: DiagnosticReport }
  | { type: 'EXPORT_ERROR'; message: string };

export type UIToPluginMessage =
  | { type: 'EXTRACT_TOKENS' }
  | { type: 'RUN_DIAGNOSTIC' }
  | { type: 'CLOSE_PLUGIN' };
