import React from 'react';
import { SubliminalTokenExport } from '../../types';

interface Props {
  tokens: SubliminalTokenExport | null;
  loading: boolean;
  onExtract: () => void;
}

export function ManualExport({ tokens, loading, onExtract }: Props) {
  const handleDownload = () => {
    if (!tokens) return;

    const json = JSON.stringify(tokens, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `subliminal-tokens-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = () => {
    if (!tokens) return;
    navigator.clipboard.writeText(JSON.stringify(tokens, null, 2));
  };

  return (
    <div className="panel">
      <p className="panel-description">
        Extract your Subliminal design tokens and download or copy the JSON directly —
        no GitHub connection required.
      </p>

      {!tokens ? (
        <div className="empty-state">
          <p>No tokens extracted yet.</p>
          <button className="btn primary" onClick={onExtract} disabled={loading}>
            {loading ? 'Extracting…' : 'Extract Tokens'}
          </button>
        </div>
      ) : (
        <>
          <div className="token-preview">
            <pre>{JSON.stringify(tokens, null, 2)}</pre>
          </div>
          <div className="action-row">
            <button className="btn primary" onClick={handleDownload}>
              Download JSON
            </button>
            <button className="btn secondary" onClick={handleCopy}>
              Copy to Clipboard
            </button>
            <button className="btn ghost" onClick={onExtract} disabled={loading}>
              {loading ? 'Re-extracting…' : 'Re-extract'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
