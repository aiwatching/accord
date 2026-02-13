import React from 'react';
import { useApi } from '../hooks/useApi';
import { ServiceCard } from '../components/ServiceCard';

interface ServiceItem {
  name: string;
  type: string;
  maintainer: string;
  status: string;
  pendingRequests: number;
  description?: string | null;
}

export function Services() {
  const { data: services, loading, error, refresh } = useApi<ServiceItem[]>('/api/services');

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ color: '#f1f5f9', fontSize: 22 }}>Services</h2>
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

      {services && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {services.map(svc => (
            <ServiceCard key={svc.name} {...svc} />
          ))}
        </div>
      )}
    </div>
  );
}
