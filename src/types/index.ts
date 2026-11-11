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

/**
 * The *first* runtime shape Figma used for a colour defined as "alias + opacity" (2026-09);
 * superseded by `ComposedColorValue` in 2026-11 but still read, so older files keep exporting.
 * Also the carrier for any other expression function. The published typings declare VariableValue as
 * boolean | string | number | RGB | RGBA | MotionEasing | VariableAlias, with no member for
 * this — confirmed present at runtime (2026-09-10) by the Diagnostics tab, which reports raw
 * object keys rather than trusting the type.
 *
 *   { type: 'VARIABLE_EXPRESSION',
 *     expressionFunction: 'COMPOSE_COLOR',
 *     expressionArguments: [ { type: 'VARIABLE_ALIAS', id }, 80 ] }
 *
 * The trailing number is opacity on a 0–100 scale (fractional values occur), so
 * alpha = opacity / 100.
 */
export interface VariableExpressionValue {
  type: 'VARIABLE_EXPRESSION';
  expressionFunction: string;
  expressionArguments: unknown[];
}

/**
 * The shape Figma moved composed colours to once opacity-on-variable shipped properly —
 * observed in a live export 2026-11-07, replacing `VariableExpressionValue` for the same data:
 *
 *   { color: { type: 'VARIABLE_ALIAS', id }, opacity: 80 }
 *
 * Opacity is still 0–100. Also undocumented in `@figma/plugin-typings` at the time of writing.
 * Relay reads both shapes; see `readComposedColor` in code.ts.
 */
export interface ComposedColorValue {
  color: unknown;
  opacity: number;
}

/**
 * What `valuesByMode` can actually hold. The ambient `VariableValue` omits both composed-colour
 * shapes, so reading a raw value through this type keeps the narrowing honest instead of casting
 * at every call site.
 */
export type RuntimeVariableValue = VariableValue | VariableExpressionValue | ComposedColorValue;

/**
 * Records "alias + opacity" composition, matching Figma's native export shape.
 *
 * `colorArg.alias` mirrors how `$value` treats aliases: a base in the *same* collection is
 * identified by name alone, while one in another collection carries the full `AliasData`.
 * Verified against native exports of both modes — 260 of 261 composed tokens use the short
 * form, and the one composing straight onto a Global Values variable uses the long one.
 */
export interface ComposedColor {
  colorArg:
    | { type: 'alias'; alias: { targetVariableName: string } | AliasData }
    | { type: 'color'; value: ColorValue };
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
    /**
     * Relay-only. Figma has no equivalent, because Figma understands all of its own
     * expression functions. Set when a value is a `VARIABLE_EXPRESSION` Relay can't evaluate,
     * so a new expression kind surfaces as a visible marker instead of a silently empty value.
     */
    'com.subliminal.unsupportedExpression'?: { expressionFunction: string; raw: string };
    /**
     * Relay-only. Set when `valuesByMode` held an object Relay doesn't recognise. `$value` is
     * emptied rather than carrying the raw object, so a downstream parser never mistakes an
     * API-internal shape for a colour. This is how the next Figma format change will surface.
     */
    'com.subliminal.unreadableValue'?: { raw: string };
  };
}

export interface TokenCollection {
  [groupOrName: string]: DesignToken | TokenCollection;
}

// ─── Export payload ─────────────────────────────────────────────────────────

/** A token whose emitted `$value` doesn't match its `$type`. */
export interface ExportProblem {
  fileName: string;
  tokenPath: string;
  reason: string;
}

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
    /**
     * Every token whose `$value` doesn't match its `$type`. Empty means the export is sound.
     * The UI shows these prominently: the 2026-11 export shipped 249 raw API objects as colour
     * values and still looked complete, which is exactly the failure this exists to prevent.
     */
    problems: ExportProblem[];
  };
  files: TokenFile[];
  /** Effect styles carry real CSS, not just their names — SDS consumes `css.boxShadow`. */
  effectStyles: TokenCollection;
  /**
   * Text styles, each with the variable bound to each of its fields
   * (`$extensions['com.subliminal.boundVariables']`). SDS builds its type classes from these.
   */
  textStyles: TokenCollection;
}

/** A variable named by collection and path (ids mean nothing outside the Figma file). */
export interface TextStyleVariableRef {
  collection: string;
  name: string;
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
