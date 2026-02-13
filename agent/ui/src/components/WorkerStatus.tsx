import React from 'react';

interface WorkerInfo {
  id: number;
  state: string;
  currentRequest: string | null;
}

export function WorkerStatus({ workers }: { workers: WorkerInfo[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
      {workers.map(w => (
        <div key={w.id} style={{
          background: '#1e293b',
          borderRadius: 8,
          padding: 16,
          border: `1px solid ${w.state === 'busy' ? '#3b82f6' : '#334155'}`,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 14 }}>Worker {w.id}</span>
            <span style={{
              width: 10, height: 10, borderRadius: '50%',
              background: w.state === 'busy' ? '#3b82f6' : '#4ade80',
              display: 'inline-block',
            }} />
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
            {w.state === 'busy' && w.currentRequest
              ? <span style={{ color: '#93c5fd' }}>Processing: {w.currentRequest.slice(0, 20)}...</span>
              : 'Idle'
            }
          </div>
        </div>
      ))}
    </div>
  );
}
