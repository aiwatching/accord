import React from 'react';
import { useWebSocket } from '../hooks/useWebSocket';
import { useApi } from '../hooks/useApi';

export function Layout({ children }: { children: React.ReactNode }) {
  const { connected } = useWebSocket();
  const { data: hub } = useApi<{ project: string }>('/api/hub');

  const projectName = hub?.project ?? 'Accord Hub';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* Top bar */}
      <header style={{
        height: 48,
        background: '#1e293b',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 20px',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>
          Accord Hub — {projectName}
        </div>
        <div style={{
          fontSize: 12,
          color: connected ? '#4ade80' : '#f87171',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            background: connected ? '#4ade80' : '#f87171',
            display: 'inline-block',
          }} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
      </header>

      {/* Main content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {children}
      </main>
    </div>
  );
}
