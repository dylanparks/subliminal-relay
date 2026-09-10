import React from 'react';
import { DiagnosticReport } from '../../types';

interface Props {
  report: DiagnosticReport | null;
  loading: boolean;
  onRun: () => void;
}

/**
 * Reports what `valuesByMode` actually returns, shape by shape. It was written to settle whether
 * the Plugin API exposes "alias + opacity" at all — it does, as VARIABLE_EXPRESSION /
 * COMPOSE_COLOR — and it stays useful as a way to spot a value shape Relay doesn't yet handle
 * after Figma ships something new or the file gets restructured.
 */
export function Diagnostics({ report, loading, onRun }: Props) {
  const handleCopy = () => {
    if (report) navigator.clipboard.writeText(JSON.stringify(report, null, 2));
  };

  return (
    <div className="panel">
      <p className="panel-description">
        Inspects the raw value shapes the Plugin API returns for this file’s variables — including
        alias-plus-opacity colours, and any collection that is subscribed from another library
        rather than owned here. Run it whenever an export looks incomplete.
      </p>

      {!report ? (
        <div className="empty-state">
          <p>No diagnostic run yet.</p>
          <button className="btn primary" onClick={onRun} disabled={loading}>
            {loading ? 'Inspecting…' : 'Run Diagnostic'}
          </button>
        </div>
      ) : (
        <>
          <div className="diagnostic-verdict">
            <strong>Verdict</strong>
            <p>{report.pluginApiVerdict}</p>
          </div>

          <div className="diagnostic-section">
            <strong>Collections</strong>
            <ul>
              {report.collections.map((c) => (
                <li key={c.id}>
                  {c.name} — {c.variableCount} variables, modes:{' '}
                  {c.modes.map((m) => m.name).join(', ')}
                  {c.isRemote ? ' (remote/library)' : ''}
                </li>
              ))}
            </ul>
          </div>

          <div className="diagnostic-section">
            <strong>Library collections (published from other files)</strong>
            {report.libraryLookupError ? (
              <p className="panel-description">Lookup failed: {report.libraryLookupError}</p>
            ) : report.libraryCollections.length === 0 ? (
              <p className="panel-description">
                None — every collection is local, so nothing is being missed this way.
              </p>
            ) : (
              <ul>
                {report.libraryCollections.map((c) => (
                  <li key={c.key}>
                    {c.name} — from “{c.libraryName}”
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="diagnostic-section">
            <strong>Raw value shapes across all colour variables</strong>
            <ul>
              {Object.keys(report.valueShapeCounts).map((shape) => (
                <li key={shape}>
                  {shape}: {report.valueShapeCounts[shape]}
                </li>
              ))}
            </ul>
          </div>

          <div className="diagnostic-section">
            <strong>Probes (a sample of each value shape, dumped raw)</strong>
            <div className="token-preview">
              <pre>{JSON.stringify(report.probes, null, 2)}</pre>
            </div>
          </div>

          <div className="action-row">
            <button className="btn primary" onClick={handleCopy}>
              Copy Report
            </button>
            <button className="btn ghost" onClick={onRun} disabled={loading}>
              {loading ? 'Re-running…' : 'Re-run'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
