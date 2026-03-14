import React, { useEffect, useState } from 'react';
import { GitHubExport } from './components/GitHubExport';
import { ManualExport } from './components/ManualExport';
import { PluginToUIMessage, SubliminalTokenExport } from '../types';
import './styles/App.css';

type Tab = 'github' | 'manual';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('github');
  const [tokens, setTokens] = useState<SubliminalTokenExport | null>(null);
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
        case 'EXPORT_ERROR':
          setError(msg.message);
          setLoading(false);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleExtract = () => {
    setError(null);
    setLoading(true);
    parent.postMessage({ pluginMessage: { type: 'EXTRACT_TOKENS' } }, '*');
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
      </div>

      <main className="app-content">
        {error && <div className="error-banner">{error}</div>}

        {activeTab === 'github' && (
          <GitHubExport
            tokens={tokens}
            loading={loading}
            onExtract={handleExtract}
          />
        )}

        {activeTab === 'manual' && (
          <ManualExport
            tokens={tokens}
            loading={loading}
            onExtract={handleExtract}
          />
        )}
      </main>
    </div>
  );
}
