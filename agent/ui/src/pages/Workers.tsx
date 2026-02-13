import React from 'react';
import { useApi } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import { WorkerStatus } from '../components/WorkerStatus';
import { StreamingOutput } from '../components/StreamingOutput';

interface WorkerData {
  totalWorkers: number;
  activeWorkers: number;
  idleWorkers: number;
  totalProcessed: number;
  totalFailed: number;
  pendingQueue: number;
  workers: Array<{ id: number; state: string; currentRequest: string | null }>;
}

export function Workers() {
  const { data, loading, error, refresh } = useApi<WorkerData>('/api/workers');
  const { events } = useWebSocket();

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: '#f1f5f9', fontSize: 22 }}>Workers</h2>
        <button
          onClick={refresh}
          style={{
            background: '#334155',
            color: '#e2e8f0',
            border: 'none',
            padding: '6px 16px',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Refresh
        </button>
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading...</p>}
      {error && <p style={{ color: '#f87171' }}>Error: {error}</p>}

      {data && (
        <>
          {/* Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}>
            {[
              { label: 'Total', value: data.totalWorkers },
              { label: 'Active', value: data.activeWorkers },
              { label: 'Idle', value: data.idleWorkers },
              { label: 'Processed', value: data.totalProcessed },
              { label: 'Failed', value: data.totalFailed },
              { label: 'Queue', value: data.pendingQueue },
            ].map(s => (
              <div key={s.label} style={{
                background: '#1e293b',
                borderRadius: 8,
                padding: '12px 16px',
                border: '1px solid #334155',
              }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>{s.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#f1f5f9' }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Worker pool */}
          <h3 style={{ color: '#f1f5f9', fontSize: 14, marginBottom: 12 }}>Worker Pool</h3>
          <WorkerStatus workers={data.workers} />

          {/* Streaming output */}
          <div style={{ marginTop: 24 }}>
            <h3 style={{ color: '#f1f5f9', fontSize: 14, marginBottom: 12 }}>Live Output</h3>
            <StreamingOutput events={events} />
          </div>
        </>
      )}
    </div>
  );
}
