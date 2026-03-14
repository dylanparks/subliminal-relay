import React, { useState } from 'react';
import JSZip from 'jszip';
import { ScanResult } from '../../types';

const TARGET_COLLECTIONS = [
  'Global Colors',
  'Intent Colors',
  'Typography',
  'Shape',
  'Viewport',
];

interface Props {
  result: ScanResult | null;
  scanning: boolean;
  onScan: () => void;
}

export function ZipExport({ result, scanning, onScan }: Props) {
  const [zipping, setZipping] = useState(false);

  const handleDownloadZip = async () => {
    if (!result || result.collections.length === 0) return;
    setZipping(true);

    try {
      const zip = new JSZip();
      const folder = zip.folder('subliminal-tokens');

      for (const col of result.collections) {
        folder!.file(col.fileName, JSON.stringify(col.tokens, null, 2));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `subliminal-tokens-${result.exportedAt.split('T')[0]}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  // ── Initial / idle state ──────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="panel">
        <p className="panel-description">
          Scans your Figma file for the following variable collections and
          exports each as a separate JSON file inside a single ZIP.
        </p>

        <ul className="collection-checklist idle">
          {TARGET_COLLECTIONS.map(name => (
            <li key={name} className="collection-item">
              <span className="dot idle" />
              {name}
            </li>
          ))}
        </ul>

        <div className="action-row">
          <button className="btn primary" onClick={onScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Scan Collections'}
          </button>
        </div>
      </div>
    );
  }

  // ── Results state ─────────────────────────────────────────────────────────
  const foundNames = new Set(result.collections.map(c => c.collectionName));
  const totalFiles = result.collections.length;

  return (
    <div className="panel">
      <p className="panel-description">
        Scanned <strong>{result.figmaFileName}</strong> — found{' '}
        <strong>{foundNames.size}</strong> of {TARGET_COLLECTIONS.length} collections
        {totalFiles > foundNames.size && <> ({totalFiles} files)</>}.
      </p>

      <ul className="collection-checklist">
        {TARGET_COLLECTIONS.map(name => {
          const files = result.collections.filter(c => c.collectionName === name);
          const found = files.length > 0;
          return (
            <li key={name} className={`collection-item ${found ? 'found' : 'missing'}`}>
              <span className={`dot ${found ? 'found' : 'missing'}`} />
              <span className="collection-name">{name}</span>
              {found && (
                <ul className="collection-files">
                  {files.map(f => (
                    <li key={f.fileName} className="collection-file-row">
                      <span className="collection-file">{f.fileName}</span>
                      <span className="collection-count">{f.tokenCount} tokens</span>
                      {f.modeName && <span className="collection-mode">{f.modeName}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {!found && <span className="collection-missing-label">not found</span>}
            </li>
          );
        })}
      </ul>

      {result.missing.length > 0 && (
        <div className="warning-banner">
          {result.missing.length === TARGET_COLLECTIONS.length
            ? 'No target collections were found in this file.'
            : `${result.missing.length} collection${result.missing.length > 1 ? 's' : ''} missing — they will be skipped in the export.`}
        </div>
      )}

      <div className="action-row">
        <button
          className="btn primary"
          onClick={handleDownloadZip}
          disabled={zipping || result.collections.length === 0}
        >
          {zipping ? 'Zipping…' : 'Download ZIP'}
        </button>
        <button className="btn ghost" onClick={onScan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Re-scan'}
        </button>
      </div>
    </div>
  );
}
