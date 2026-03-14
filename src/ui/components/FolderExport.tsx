import React, { useState } from 'react';
import { ScanResult } from '../../types';

const TARGET_COLLECTIONS = [
  'Global Colors',
  'Intent Colors',
  'Typography',
  'Shape',
  'Viewport',
];

// Output path written inside the user's chosen project root
const RELAY_PATH = ['tokens', 'relay'];

interface Props {
  result: ScanResult | null;
  scanning: boolean;
  onScan: () => void;
}

type ExportState = 'idle' | 'exporting' | 'success' | 'error';

export function FolderExport({ result, scanning, onScan }: Props) {
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportedFiles, setExportedFiles] = useState<string[]>([]);

  const handleExportToFolder = async () => {
    if (!result || result.collections.length === 0) return;

    let dirHandle: FileSystemDirectoryHandle;

    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (err) {
      // User dismissed the picker — not an error
      if (err instanceof Error && err.name === 'AbortError') return;
      setExportError('Could not open folder picker.');
      setExportState('error');
      return;
    }

    setExportState('exporting');
    setExportError(null);

    try {
      // Navigate to tokens/relay/, creating directories as needed
      let handle: FileSystemDirectoryHandle = dirHandle;
      for (const segment of RELAY_PATH) {
        handle = await handle.getDirectoryHandle(segment, { create: true });
      }

      const written: string[] = [];
      for (const col of result.collections) {
        const fileHandle = await handle.getFileHandle(col.fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(col.tokens, null, 2));
        await writable.close();
        written.push(col.fileName);
      }

      setExportedFiles(written);
      setExportState('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error during export.';
      setExportError(message);
      setExportState('error');
    }
  };

  const handleReset = () => {
    setExportState('idle');
    setExportError(null);
    setExportedFiles([]);
    onScan();
  };

  // ── Initial / idle state ──────────────────────────────────────────────────
  if (!result) {
    return (
      <div className="panel">
        <p className="panel-description">
          Scans your Figma file for the following variable collections and
          exports each as a JSON file directly into your project's{' '}
          <code>tokens/relay/</code> folder.
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

  // ── Success state ─────────────────────────────────────────────────────────
  if (exportState === 'success') {
    return (
      <div className="panel">
        <div className="success-banner">
          {exportedFiles.length} file{exportedFiles.length !== 1 ? 's' : ''} written
          to <code>tokens/relay/</code>
        </div>

        <ul className="collection-checklist">
          {exportedFiles.map(fileName => (
            <li key={fileName} className="collection-item found">
              <span className="dot found" />
              <span className="collection-file">{fileName}</span>
            </li>
          ))}
        </ul>

        <div className="action-row">
          <button className="btn ghost" onClick={handleReset}>
            Re-scan
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

      {exportState === 'error' && exportError && (
        <div className="error-banner">{exportError}</div>
      )}

      <div className="action-row">
        <button
          className="btn primary"
          onClick={handleExportToFolder}
          disabled={exportState === 'exporting' || result.collections.length === 0}
        >
          {exportState === 'exporting' ? 'Exporting…' : 'Export to Project'}
        </button>
        <button className="btn ghost" onClick={onScan} disabled={scanning || exportState === 'exporting'}>
          {scanning ? 'Scanning…' : 'Re-scan'}
        </button>
      </div>
    </div>
  );
}
