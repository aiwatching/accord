import React from 'react';

interface ServiceItem {
  name: string;
  type?: string;
  language?: string;
  maintainer?: string;
  description?: string;
  status?: string;
  pendingRequests?: number;
  a2a_url?: string | null;
}

interface Badge {
  name: string;
  pending: number;
  active: number;
}

interface ServiceCardsProps {
  serviceList: ServiceItem[] | null;
  badges: Badge[];
  onAddService: () => void;
}

export function ServiceCards({ serviceList, badges, onAddService }: ServiceCardsProps) {
  return (
    <div style={{
      padding: '8px 12px',
      borderBottom: '1px solid #334155',
      display: 'flex',
      gap: 8,
      flexShrink: 0,
      flexWrap: 'wrap',
      minHeight: 40,
    }}>
      {(!serviceList || serviceList.length === 0) && (
        <span style={{ color: '#64748b', fontSize: 13 }}>Loading services...</span>
      )}
      {serviceList?.map(svc => {
        const badge = badges.find(b => b.name === svc.name);
        const statusColor = svc.status === 'working' ? '#4ade80'
          : svc.status === 'pending' ? '#fbbf24' : '#64748b';
        const statusDot = svc.status === 'working' ? '\u25CF'
          : svc.status === 'pending' ? '\u25CF' : '\u25CB';
        return (
          <div key={svc.name} style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: '6px 12px',
            minWidth: 140,
            fontSize: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <span style={{ color: statusColor, fontSize: 10 }}>{statusDot}</span>
              <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>{svc.name}</span>
            </div>
            <div style={{ color: '#64748b', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {svc.maintainer && <span>{svc.maintainer}</span>}
              {svc.language && <span>{svc.language}</span>}
              {svc.type && svc.type !== 'service' && (
                <span style={{ color: '#818cf8' }}>{svc.type}</span>
              )}
              {svc.a2a_url && (
                <span style={{ color: '#38bdf8', fontWeight: 500 }} title={svc.a2a_url}>A2A</span>
              )}
            </div>
            {(badge?.pending || badge?.active) ? (
              <div style={{ marginTop: 3, display: 'flex', gap: 6 }}>
                {badge.pending > 0 && (
                  <span style={{ color: '#fbbf24' }}>{badge.pending} pending</span>
                )}
                {badge.active > 0 && (
                  <span style={{ color: '#4ade80' }}>{badge.active} active</span>
                )}
              </div>
            ) : null}
            {svc.description && (
              <div style={{ color: '#94a3b8', marginTop: 2, fontSize: 11 }}>
                {svc.description}
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={onAddService}
        title="Add service"
        style={{
          background: '#1e293b',
          border: '1px dashed #475569',
          borderRadius: 8,
          padding: '6px 16px',
          color: '#64748b',
          fontSize: 20,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 48,
          alignSelf: 'stretch',
        }}
      >
        +
      </button>
    </div>
  );
}
