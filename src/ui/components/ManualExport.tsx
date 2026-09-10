import React from 'react';
import { SubliminalTokenExport, TokenFile } from '../../types';

interface Props {
  tokens: SubliminalTokenExport | null;
  loading: boolean;
  onExtract: () => void;
}

function download(fileName: string, contents: string) {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function ManualExport({ tokens, loading, onExtract }: Props) {
  const downloadFile = (file: TokenFile) =>
    download(file.fileName, JSON.stringify(file.tokens, null, 2));

  // Browsers throttle rapid successive downloads, so stagger them rather than firing all at once.
  const downloadAll = () => {
    if (!tokens) return;
    tokens.files.forEach((file, i) => {
      setTimeout(() => downloadFile(file), i * 300);
    });
    setTimeout(
      () => download('effect-styles.json', JSON.stringify(tokens.effectStyles, null, 2)),
      tokens.files.length * 300,
    );
  };

  return (
    <div className="panel">
      <p className="panel-description">
        Extract your Subliminal design tokens — one file per collection per mode, matching
        Figma's native variable-export shape.
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
          <div className="diagnostic-section">
            <strong>
              {tokens.files.length} file{tokens.files.length === 1 ? '' : 's'} from{' '}
              {tokens.meta.collections.length} collection
              {tokens.meta.collections.length === 1 ? '' : 's'}
            </strong>
            <ul>
              {tokens.files.map((file) => (
                <li key={file.fileName}>
                  <button className="btn link" onClick={() => downloadFile(file)}>
                    {file.fileName}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="action-row">
            <button className="btn primary" onClick={downloadAll}>
              Download All
            </button>
            <button
              className="btn secondary"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(tokens, null, 2))}
            >
              Copy Full Payload
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
