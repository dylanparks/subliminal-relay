import React, { useEffect, useState } from 'react';
import { ZipExport } from './components/ZipExport';
import { PluginToUIMessage, ScanResult } from '../types';
import './styles/global.css';
import './styles/App.css';

export default function App() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data.pluginMessage as PluginToUIMessage;
      if (!msg) return;

      switch (msg.type) {
        case 'SCAN_COMPLETE':
          setScanResult(msg.payload);
          setScanning(false);
          break;
        case 'EXPORT_ERROR':
          setError(msg.message);
          setScanning(false);
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleScan = () => {
    setError(null);
    setScanning(true);
    parent.postMessage({ pluginMessage: { type: 'SCAN_COLLECTIONS' } }, '*');
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-logo">Subliminal Relay</span>
        <span className="app-subtitle">Variable Exporter</span>
      </header>

      <main className="app-content">
        {error && <div className="error-banner">{error}</div>}
        <ZipExport result={scanResult} scanning={scanning} onScan={handleScan} />
      </main>
    </div>
  );
}
