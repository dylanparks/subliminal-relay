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

// ─── Exported Payload ───────────────────────────────────────────────────────

export interface SubliminalTokenExport {
  meta: {
    exportedAt: string;
    pluginVersion: string;
    figmaFileName: string;
  };
  variables: TokenCollection;
  styles: {
    colors: TokenCollection;
    text: TokenCollection;
    effects: TokenCollection;
  };
}

// ─── GitHub Config ──────────────────────────────────────────────────────────

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
}

// ─── Plugin Messages ─────────────────────────────────────────────────────────

export type PluginToUIMessage =
  | { type: 'TOKENS_EXTRACTED'; payload: SubliminalTokenExport }
  | { type: 'EXPORT_ERROR'; message: string };

export type UIToPluginMessage =
  | { type: 'EXTRACT_TOKENS' }
  | { type: 'CLOSE_PLUGIN' };
