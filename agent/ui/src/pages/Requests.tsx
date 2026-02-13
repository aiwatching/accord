import React, { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { RequestList } from '../components/RequestList';

interface RequestItem {
  id: string;
  service: string;
  type: string;
  priority: string;
  status: string;
  from: string;
  created: string;
}

export function Requests() {
  const [statusFilter, setStatusFilter] = useState('');
  const url = statusFilter ? `/api/requests?status=${statusFilter}` : '/api/requests';
  const { data: requests, loading, error, refresh } = useApi<RequestItem[]>(url, [statusFilter]);

  const statuses = ['', 'pending', 'approved', 'in-progress', 'completed', 'failed'];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: '#f1f5f9', fontSize: 22 }}>Requests</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{
              background: '#334155',
              color: '#e2e8f0',
              border: '1px solid #475569',
              padding: '6px 12px',
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {statuses.map(s => (
              <option key={s} value={s}>{s || 'All statuses'}</option>
            ))}
          </select>
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
      </div>

      {loading && <p style={{ color: '#94a3b8' }}>Loading...</p>}
      {error && <p style={{ color: '#f87171' }}>Error: {error}</p>}

      {requests && <RequestList requests={requests} />}
    </div>
  );
}
