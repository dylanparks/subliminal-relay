import React, { useEffect, useState } from 'react';
import { GitHubExport } from './components/GitHubExport';
import { ManualExport } from './components/ManualExport';
import { Diagnostics } from './components/Diagnostics';
import { DiagnosticReport, PluginToUIMessage, SubliminalTokenExport } from '../types';
import './styles/App.css';

type Tab = 'github' | 'manual' | 'diagnostics';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('github');
  const [tokens, setTokens] = useState<SubliminalTokenExport | null>(null);
  const [diagnostic, setDiagnostic] = useState<DiagnosticReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Listen for messages from the Figma sandbox
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data.pluginMessage as PluginToUIMessage;
      if (!msg) return;

      switch (msg.type) {
        case 'TOKENS_EXTRACTED':
          setTokens(msg.payload);
          setLoading(false);
          break;
        case 'DIAGNOSTIC_COMPLETE':
          setDiagnostic(msg.payload);
          setLoading(false);
          break;
        case 'EXPORT_ERROR':
          setError(msg.message);
          setLoading(false);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const send = (type: 'EXTRACT_TOKENS' | 'RUN_DIAGNOSTIC') => {
    setError(null);
    setLoading(true);
    parent.postMessage({ pluginMessage: { type } }, '*');
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">Subliminal Relay</span>
      </header>

      <div className="tab-bar">
        <button
          className={`tab-btn${activeTab === 'github' ? ' active' : ''}`}
          onClick={() => setActiveTab('github')}
        >
          GitHub Export
        </button>
        <button
          className={`tab-btn${activeTab === 'manual' ? ' active' : ''}`}
          onClick={() => setActiveTab('manual')}
        >
          Manual Export
        </button>
        <button
          className={`tab-btn${activeTab === 'diagnostics' ? ' active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          Diagnostics
        </button>
      </div>

      <main className="app-content">
        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'github' && (
          <GitHubExport
            tokens={tokens}
            loading={loading}
            onExtract={() => send('EXTRACT_TOKENS')}
          />
        )}

        {activeTab === 'manual' && (
          <ManualExport
            tokens={tokens}
            loading={loading}
            onExtract={() => send('EXTRACT_TOKENS')}
          />
        )}

        {activeTab === 'diagnostics' && (
          <Diagnostics
            report={diagnostic}
            loading={loading}
            onRun={() => send('RUN_DIAGNOSTIC')}
          />
        )}
      </main>
    </div>
  );
}
