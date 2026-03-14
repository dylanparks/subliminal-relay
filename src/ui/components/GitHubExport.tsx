import React, { useState } from 'react';
import { GitHubConfig, SubliminalTokenExport } from '../../types';
import { pushToGitHub } from '../lib/github';

interface Props {
  tokens: SubliminalTokenExport | null;
  loading: boolean;
  onExtract: () => void;
}

const STORAGE_KEY = 'subliminal-relay-gh-config';

function loadSavedConfig(): Partial<GitHubConfig> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function GitHubExport({ tokens, loading, onExtract }: Props) {
  const saved = loadSavedConfig();

  const [config, setConfig] = useState<GitHubConfig>({
    token: saved.token || '',
    owner: saved.owner || '',
    repo: saved.repo || '',
    branch: saved.branch || 'main',
    filePath: saved.filePath || 'tokens/subliminal.json',
  });

  const [status, setStatus] = useState<'idle' | 'pushing' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');

  const updateConfig = (field: keyof GitHubConfig, value: string) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
  };

  const saveConfig = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  };

  const handlePush = async () => {
    if (!tokens) {
      onExtract();
      return;
    }

    setStatus('pushing');
    setStatusMessage('');
    saveConfig();

    try {
      await pushToGitHub(config, tokens);
      setStatus('success');
      setStatusMessage(`Successfully pushed to ${config.owner}/${config.repo} on branch "${config.branch}".`);
    } catch (err) {
      setStatus('error');
      setStatusMessage(err instanceof Error ? err.message : 'Push failed.');
    }
  };

  const isConfigValid = config.token && config.owner && config.repo && config.branch && config.filePath;

  return (
    <div className="panel">
      <p className="panel-description">
        Connect to a GitHub repository and push your Subliminal design tokens as a JSON file.
        Your Personal Access Token is stored locally in your browser and never sent to any server
        other than the GitHub API.
      </p>

      <div className="form">
        <label className="field">
          <span>Personal Access Token</span>
          <input
            type="password"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            value={config.token}
            onChange={(e) => updateConfig('token', e.target.value)}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Owner</span>
            <input
              type="text"
              placeholder="username or org"
              value={config.owner}
              onChange={(e) => updateConfig('owner', e.target.value)}
            />
          </label>
          <label className="field">
            <span>Repository</span>
            <input
              type="text"
              placeholder="my-design-tokens"
              value={config.repo}
              onChange={(e) => updateConfig('repo', e.target.value)}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Branch</span>
            <input
              type="text"
              placeholder="main"
              value={config.branch}
              onChange={(e) => updateConfig('branch', e.target.value)}
            />
          </label>
          <label className="field">
            <span>File Path</span>
            <input
              type="text"
              placeholder="tokens/subliminal.json"
              value={config.filePath}
              onChange={(e) => updateConfig('filePath', e.target.value)}
            />
          </label>
        </div>
      </div>

      {status === 'success' && <div className="status-banner success">{statusMessage}</div>}
      {status === 'error' && <div className="status-banner error">{statusMessage}</div>}

      <div className="action-row">
        {!tokens && (
          <button className="btn secondary" onClick={onExtract} disabled={loading}>
            {loading ? 'Extracting…' : 'Extract Tokens First'}
          </button>
        )}
        {tokens && (
          <button
            className="btn primary"
            onClick={handlePush}
            disabled={!isConfigValid || status === 'pushing'}
          >
            {status === 'pushing' ? 'Pushing…' : 'Push to GitHub'}
          </button>
        )}
        {tokens && (
          <span className="token-ready-badge">Tokens ready</span>
        )}
      </div>
    </div>
  );
}
