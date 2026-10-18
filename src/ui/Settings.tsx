import { useState } from 'react';
import { useStore } from '../store/store';
import { ENV_API_BASE_URL } from '../config';
import { Modal } from './common';

export function Settings() {
  const s = useStore();
  const [url, setUrl] = useState(s.settings.apiBaseUrl);
  const close = () => s.setUI({ settingsOpen: false });
  return (
    <Modal title="Settings" onClose={close}>
      <div className="form">
        <label>
          Backend URL for Real mode
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://agents.example.com" inputMode="url" />
        </label>
        <p className="hint">
          The backend runs the AI work and keeps provider keys on the server. It must implement the endpoints listed in the README.
          {ENV_API_BASE_URL ? ` Build default: ${ENV_API_BASE_URL}` : ' No build default is set (VITE_API_BASE_URL).'}
        </p>
        <div className="form-actions">
          <button className="btn" onClick={() => { s.setApiBaseUrl(url); s.toast('success', 'Backend URL saved'); }}>Save URL</button>
          {url && s.settings.mode === 'demo' && (
            <button className="btn primary" onClick={() => { s.setApiBaseUrl(url); close(); s.setMode('real'); }}>Save and switch to Real</button>
          )}
        </div>
        <hr />
        <p className="hint">Demo data (agents, tasks, activity) is stored in this browser.</p>
        <div className="form-actions start">
          <button className="btn danger" disabled={s.settings.mode !== 'demo'} onClick={() => { s.resetDemo(); close(); }}>Reset demo office</button>
        </div>
      </div>
    </Modal>
  );
}
