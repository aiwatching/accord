import React, { useState } from 'react';

interface AddServiceModalProps {
  onClose: () => void;
  onAdded: () => void;
}

export function AddServiceModal({ onClose, onAdded }: AddServiceModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'service' | 'module'>('service');
  const [language, setLanguage] = useState('');
  const [directory, setDirectory] = useState('');
  const [repo, setRepo] = useState('');
  const [description, setDescription] = useState('');
  const [maintainer, setMaintainer] = useState<string>('ai');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) { setError('Name is required'); return; }
    setError('');
    setSubmitting(true);
    try {
      const body: Record<string, string> = { name: name.trim(), type, maintainer };
      if (language.trim()) body.language = language.trim();
      if (directory.trim()) body.directory = directory.trim();
      if (repo.trim()) body.repo = repo.trim();
      if (description.trim()) body.description = description.trim();
      const res = await fetch('/api/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? `Error ${res.status}`);
        setSubmitting(false);
        return;
      }
      onAdded();
    } catch (err) {
      setError(`Network error: ${err}`);
      setSubmitting(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    background: '#0f172a',
    color: '#f1f5f9',
    border: '1px solid #334155',
    borderRadius: 4,
    padding: '6px 8px',
    fontSize: 13,
    fontFamily: 'monospace',
    outline: 'none',
    boxSizing: 'border-box',
  };
  const labelStyle: React.CSSProperties = { color: '#94a3b8', fontSize: 12, marginBottom: 2 };

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 20,
    }}>
      <div style={{
        background: '#1e293b',
        border: '1px solid #475569',
        borderRadius: 8,
        padding: 20,
        width: 400,
        maxHeight: '80%',
        overflow: 'auto',
        boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      }}>
        <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 15, marginBottom: 16 }}>
          Add Service
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={labelStyle}>Name *</div>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="my-service" />
          </div>
          <div>
            <div style={labelStyle}>Type</div>
            <select value={type} onChange={e => setType(e.target.value as 'service' | 'module')}
              style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="service">service</option>
              <option value="module">module</option>
            </select>
          </div>
          <div>
            <div style={labelStyle}>Language</div>
            <input value={language} onChange={e => setLanguage(e.target.value)} style={inputStyle} placeholder="typescript" />
          </div>
          <div>
            <div style={labelStyle}>Directory</div>
            <input value={directory} onChange={e => setDirectory(e.target.value)} style={inputStyle} placeholder="(optional)" />
          </div>
          <div>
            <div style={labelStyle}>Repo URL</div>
            <input value={repo} onChange={e => setRepo(e.target.value)} style={inputStyle} placeholder="https://github.com/..." />
          </div>
          <div>
            <div style={labelStyle}>Description</div>
            <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} placeholder="(optional)" />
          </div>
          <div>
            <div style={labelStyle}>Maintainer</div>
            <select value={maintainer} onChange={e => setMaintainer(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="ai">ai</option>
              <option value="human">human</option>
              <option value="hybrid">hybrid</option>
              <option value="external">external</option>
            </select>
          </div>
        </div>
        {error && (
          <div style={{ color: '#f87171', fontSize: 12, marginTop: 8 }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button onClick={onClose} style={{
            background: 'transparent', color: '#94a3b8', border: '1px solid #475569',
            borderRadius: 6, padding: '6px 14px', fontSize: 13, cursor: 'pointer',
          }}>Cancel</button>
          <button onClick={handleSubmit} disabled={submitting} style={{
            background: '#3b82f6', color: '#fff', border: 'none',
            borderRadius: 6, padding: '6px 14px', fontSize: 13, fontWeight: 600,
            cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.5 : 1,
          }}>
            {submitting ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
