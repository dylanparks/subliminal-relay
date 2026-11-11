import React, { useState } from 'react';
import { strToU8, zipSync } from 'fflate';
import { SubliminalTokenExport, TokenFile } from '../../types';
import { ExportProblems } from './ExportProblems';
import { copyToClipboard } from '../lib/clipboard';

interface Props {
  tokens: SubliminalTokenExport | null;
  loading: boolean;
  onExtract: () => void;
}

/**
 * The name SDS's `sds-build-tokens` CLI looks for when run without `--input`, so a download can
 * be dropped into a project as-is.
 */
const ZIP_NAME = 'subliminal-tokens.zip';

function download(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const json =(value: unknown) => JSON.stringify(value, null, 2);

/** Every file "Download All" produces, at the archive root — the same layout as a hand-made ZIP. */
function buildZip(tokens: SubliminalTokenExport): Blob {
  const entries: Record<string, Uint8Array> = {};
  for (const file of tokens.files) entries[file.fileName] = strToU8(json(file.tokens));
  entries['effect-styles.json'] = strToU8(json(tokens.effectStyles));
  entries['text-styles.json'] = strToU8(json(tokens.textStyles));

  const zip = zipSync(entries, { level: 6 });
  // Copy into a plain ArrayBuffer: TS's DOM typings reject a Uint8Array that might be backed by
  // a SharedArrayBuffer as a BlobPart.
  return new Blob([zip.slice().buffer as ArrayBuffer], { type: 'application/zip' });
}

export function ManualExport({ tokens, loading, onExtract }: Props) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const downloadFile = (file: TokenFile) =>
    download(file.fileName, new Blob([json(file.tokens)], { type: 'application/json' }));

  const handleCopyPayload = async () => {
    if (!tokens) return;
    const succeeded = await copyToClipboard(json(tokens));
    setCopyState(succeeded ? 'copied' : 'failed');
    setTimeout(() => setCopyState('idle'), 2000);
  };

  // One archive, one save dialog. Downloading each file separately opened a dialog per file in
  // Figma desktop — eight of them for a full export of the current file.
  const downloadAll = () => {
    if (tokens) download(ZIP_NAME, buildZip(tokens));
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
          <ExportProblems problems={tokens.meta.problems} />

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
            <p className="panel-description">
              The .zip also holds effect-styles.json and text-styles.json.
            </p>
          </div>

          <div className="action-row">
            <button className="btn primary" onClick={downloadAll}>
              Download All (.zip)
            </button>
            <button className="btn secondary" onClick={handleCopyPayload}>
              {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy Full Payload'}
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
