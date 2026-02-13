import React from 'react';

interface ServiceCardProps {
  name: string;
  type: string;
  maintainer: string;
  status: string;
  pendingRequests: number;
  description?: string | null;
}

const statusColors: Record<string, string> = {
  idle: '#4ade80',
  pending: '#facc15',
  working: '#3b82f6',
  error: '#f87171',
};

export function ServiceCard({ name, type, maintainer, status, pendingRequests, description }: ServiceCardProps) {
  return (
    <div style={{
      background: '#1e293b',
      borderRadius: 8,
      padding: 20,
      border: '1px solid #334155',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, color: '#f1f5f9' }}>{name}</h3>
        <span style={{
          fontSize: 12,
          padding: '2px 8px',
          borderRadius: 12,
          background: `${statusColors[status] ?? '#94a3b8'}22`,
          color: statusColors[status] ?? '#94a3b8',
          fontWeight: 600,
        }}>
          {status}
        </span>
      </div>
      {description && (
        <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 8px 0' }}>{description}</p>
      )}
      <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#64748b' }}>
        <span>Type: {type}</span>
        <span>Maintainer: {maintainer}</span>
        {pendingRequests > 0 && (
          <span style={{ color: '#facc15' }}>{pendingRequests} pending</span>
        )}
      </div>
    </div>
  );
}
