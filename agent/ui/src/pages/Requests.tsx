import React, { useState, useMemo } from 'react';
import type { RequestItem } from '../hooks/useConsoleState';

interface RequestsPageProps {
  requests: RequestItem[];
  services: string[];
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}

const statusConfig: Record<string, { icon: string; color: string; label: string }> = {
  pending:       { icon: '\u25CF', color: '#fbbf24', label: 'Pending' },
  approved:      { icon: '\u25CF', color: '#fbbf24', label: 'Approved' },
  'in-progress': { icon: '\u25D0', color: '#60a5fa', label: 'In Progress' },
  completed:     { icon: '\u2713', color: '#4ade80', label: 'Completed' },
  failed:        { icon: '\u2717', color: '#f87171', label: 'Failed' },
  rejected:      { icon: '\u2298', color: '#94a3b8', label: 'Rejected' },
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString();
}

const selectStyle: React.CSSProperties = {
  background: '#0f172a',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
  fontFamily: 'monospace',
  outline: 'none',
};

export function RequestsPage({ requests, services, onRetry, onCancel }: RequestsPageProps) {
  const [filterService, setFilterService] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const filtered = useMemo(() => {
    let result = requests;
    if (filterService !== 'all') {
      result = result.filter(r => r.service === filterService);
    }
    if (filterStatus !== 'all') {
      result = result.filter(r => r.status === filterStatus);
    }
    return result;
  }, [requests, filterService, filterStatus]);

  // Count by status for summary
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of requests) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
    return counts;
  }, [requests]);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: '#0f172a',
      fontFamily: 'monospace',
    }}>
      {/* Summary bar */}
      <div style={{
        padding: '8px 16px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
        flexWrap: 'wrap',
      }}>
        <span style={{ color: '#e2e8f0', fontSize: 14, fontWeight: 600 }}>
          Requests
        </span>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {filtered.length} of {requests.length}
        </span>
        <span style={{ flex: 1 }} />
        {Object.entries(statusCounts).map(([status, count]) => {
          const cfg = statusConfig[status];
          if (!cfg) return null;
          return (
            <span key={status} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: cfg.color }}>
              <span>{cfg.icon}</span>
              <span>{count}</span>
            </span>
          );
        })}
      </div>

      {/* Filters */}
      <div style={{
        padding: '6px 16px',
        borderBottom: '1px solid #1e293b',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <label style={{ color: '#94a3b8', fontSize: 11 }}>
          Service:
          <select value={filterService} onChange={e => setFilterService(e.target.value)} style={{ ...selectStyle, marginLeft: 4 }}>
            <option value="all">All</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label style={{ color: '#94a3b8', fontSize: 11 }}>
          Status:
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...selectStyle, marginLeft: 4 }}>
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="in-progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="rejected">Rejected</option>
          </select>
        </label>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 16px' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
              <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>ID</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Service</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>From</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Type</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Priority</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Created</th>
              <th style={{ padding: '8px 0', fontWeight: 500 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} style={{ padding: 20, color: '#64748b', textAlign: 'center' }}>
                  No requests match the current filters.
                </td>
              </tr>
            )}
            {filtered.map(r => {
              const cfg = statusConfig[r.status] ?? { icon: '?', color: '#94a3b8', label: r.status };
              const canRetry = r.status === 'failed' || r.status === 'rejected';
              const canCancel = r.status === 'pending';

              return (
                <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
                  <td style={{ padding: '6px 8px 6px 0' }}>
                    <span style={{ color: cfg.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span>{cfg.icon}</span>
                      <span style={{
                        background: `${cfg.color}18`,
                        border: `1px solid ${cfg.color}40`,
                        borderRadius: 3,
                        padding: '0 5px',
                        fontSize: 10,
                      }}>
                        {r.status}
                      </span>
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px', color: '#e2e8f0', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.id}>
                    {r.id}
                  </td>
                  <td style={{ padding: '6px 8px', color: '#cbd5e1' }}>{r.service}</td>
                  <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{r.from}</td>
                  <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{r.type}</td>
                  <td style={{ padding: '6px 8px', color: '#94a3b8' }}>{r.priority}</td>
                  <td style={{ padding: '6px 8px', color: '#64748b', fontSize: 11 }}>{formatTime(r.created)}</td>
                  <td style={{ padding: '6px 0' }}>
                    {canCancel && (
                      <button
                        onClick={() => onCancel(r.id)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #f8717140',
                          borderRadius: 3,
                          padding: '2px 8px',
                          fontSize: 10,
                          color: '#f87171',
                          cursor: 'pointer',
                          marginRight: 4,
                        }}
                      >
                        Cancel
                      </button>
                    )}
                    {canRetry && (
                      <button
                        onClick={() => onRetry(r.id)}
                        style={{
                          background: 'transparent',
                          border: '1px solid #60a5fa40',
                          borderRadius: 3,
                          padding: '2px 8px',
                          fontSize: 10,
                          color: '#60a5fa',
                          cursor: 'pointer',
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
