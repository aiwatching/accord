import React from 'react';
import { useApi } from '../hooks/useApi';
import { useWebSocket, type WireMessage } from '../hooks/useWebSocket';
import { StreamingOutput } from '../components/StreamingOutput';

interface HubStatus {
  project: string;
  version: string;
  repoModel: string;
  role: string;
  branch: string;
  lastCommit: string;
  scheduler: { running: boolean; lastTickTime: string | null; intervalSec: number };
  metrics: {
    totalRequests: number;
    completedRequests: number;
    failedRequests: number;
    successRate: number;
    avgLatencyMs: number;
    totalCostUsd: number;
  };
}

interface WorkerData {
  totalWorkers: number;
  activeWorkers: number;
  pendingQueue: number;
}

interface ServiceItem {
  name: string;
  status: string;
  pendingRequests: number;
}

function Card({ title, value, subtitle }: { title: string; value: string | number; subtitle?: string }) {
  return (
    <div style={{
      background: '#1e293b',
      borderRadius: 8,
      padding: 20,
      border: '1px solid #334155',
    }}>
      <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{subtitle}</div>}
    </div>
  );
}

export function Dashboard() {
  const { data: hub } = useApi<HubStatus>('/api/hub/status');
  const { data: workers } = useApi<WorkerData>('/api/workers');
  const { data: services } = useApi<ServiceItem[]>('/api/services');
  const { events } = useWebSocket();

  const totalPending = services?.reduce((sum, s) => sum + s.pendingRequests, 0) ?? 0;
  const recentEvents = events.slice(-20);

  return (
    <div>
      <h2 style={{ color: '#f1f5f9', fontSize: 22, marginBottom: 24 }}>
        {hub?.project ?? 'Accord'} Dashboard
      </h2>

      {/* Overview cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
        <Card title="Services" value={services?.length ?? 0} />
        <Card title="Active Workers" value={workers?.activeWorkers ?? 0} subtitle={`of ${workers?.totalWorkers ?? 0}`} />
        <Card title="Pending Requests" value={totalPending} />
        <Card
          title="Completed"
          value={hub?.metrics.completedRequests ?? 0}
          subtitle={hub ? `${(hub.metrics.successRate * 100).toFixed(0)}% success rate` : undefined}
        />
        <Card title="Total Cost" value={hub ? `$${hub.metrics.totalCostUsd}` : '$0'} />
      </div>

      {/* Hub info */}
      {hub && (
        <div style={{ background: '#1e293b', borderRadius: 8, padding: 20, border: '1px solid #334155', marginBottom: 24 }}>
          <h3 style={{ color: '#f1f5f9', fontSize: 14, marginBottom: 12 }}>Hub Info</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13 }}>
            <div><span style={{ color: '#94a3b8' }}>Branch:</span> <span style={{ color: '#e2e8f0' }}>{hub.branch}</span></div>
            <div><span style={{ color: '#94a3b8' }}>Model:</span> <span style={{ color: '#e2e8f0' }}>{hub.repoModel}</span></div>
            <div><span style={{ color: '#94a3b8' }}>Scheduler:</span> <span style={{ color: hub.scheduler.running ? '#4ade80' : '#f87171' }}>{hub.scheduler.running ? 'Running' : 'Stopped'}</span></div>
            <div><span style={{ color: '#94a3b8' }}>Last Tick:</span> <span style={{ color: '#e2e8f0' }}>{hub.scheduler.lastTickTime ? new Date(hub.scheduler.lastTickTime).toLocaleTimeString() : 'Never'}</span></div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={{ color: '#94a3b8' }}>Last Commit:</span> <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>{hub.lastCommit}</span>
            </div>
          </div>
        </div>
      )}

      {/* Live event feed */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ color: '#f1f5f9', fontSize: 14, marginBottom: 12 }}>Live Events</h3>
        {recentEvents.length === 0 ? (
          <p style={{ color: '#64748b', fontSize: 13 }}>No events yet. Events will appear when the scheduler processes requests.</p>
        ) : (
          <div style={{
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 12,
            maxHeight: 200,
            overflow: 'auto',
            fontSize: 12,
            fontFamily: 'monospace',
          }}>
            {recentEvents.map((e, i) => (
              <div key={i} style={{ padding: '2px 0', color: '#cbd5e1' }}>
                <span style={{ color: '#64748b' }}>{new Date(e.timestamp).toLocaleTimeString()}</span>{' '}
                <span style={{ color: '#3b82f6' }}>{e.type}</span>{' '}
                <span style={{ color: '#94a3b8' }}>{JSON.stringify(e.data)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Streaming output */}
      <div>
        <h3 style={{ color: '#f1f5f9', fontSize: 14, marginBottom: 12 }}>Agent Output</h3>
        <StreamingOutput events={events} />
      </div>
    </div>
  );
}
