import React from 'react';

interface RequestItem {
  id: string;
  service: string;
  type: string;
  priority: string;
  status: string;
  from: string;
  created: string;
}

const statusColors: Record<string, string> = {
  pending: '#facc15',
  approved: '#a78bfa',
  'in-progress': '#3b82f6',
  completed: '#4ade80',
  failed: '#f87171',
  rejected: '#94a3b8',
};

const priorityColors: Record<string, string> = {
  critical: '#f87171',
  high: '#fb923c',
  medium: '#facc15',
  low: '#94a3b8',
};

export function RequestList({ requests }: { requests: RequestItem[] }) {
  if (requests.length === 0) {
    return <p style={{ color: '#64748b', fontSize: 14 }}>No requests found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #334155', color: '#94a3b8', textAlign: 'left' }}>
            <th style={{ padding: '8px 12px' }}>ID</th>
            <th style={{ padding: '8px 12px' }}>Service</th>
            <th style={{ padding: '8px 12px' }}>Type</th>
            <th style={{ padding: '8px 12px' }}>Priority</th>
            <th style={{ padding: '8px 12px' }}>Status</th>
            <th style={{ padding: '8px 12px' }}>From</th>
            <th style={{ padding: '8px 12px' }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {requests.map(r => (
            <tr key={r.id} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '8px 12px', color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>
                {r.id.length > 30 ? `${r.id.slice(0, 30)}...` : r.id}
              </td>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{r.service}</td>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{r.type}</td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{ color: priorityColors[r.priority] ?? '#94a3b8' }}>{r.priority}</span>
              </td>
              <td style={{ padding: '8px 12px' }}>
                <span style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: `${statusColors[r.status] ?? '#94a3b8'}22`,
                  color: statusColors[r.status] ?? '#94a3b8',
                  fontWeight: 600,
                }}>
                  {r.status}
                </span>
              </td>
              <td style={{ padding: '8px 12px', color: '#cbd5e1' }}>{r.from}</td>
              <td style={{ padding: '8px 12px', color: '#64748b', fontSize: 12 }}>
                {new Date(r.created).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
