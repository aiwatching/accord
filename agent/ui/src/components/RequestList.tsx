import React, { useState } from 'react';
import type { RequestItem } from '../hooks/useConsoleState';

interface RequestListProps {
  requests: RequestItem[];
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onViewHistory?: () => void;
  historyCount?: number;
}

const statusConfig: Record<string, { icon: string; color: string }> = {
  pending:       { icon: '\u25CF', color: '#fbbf24' },  // ● yellow
  approved:      { icon: '\u25CF', color: '#fbbf24' },  // ● yellow
  'in-progress': { icon: '\u25D0', color: '#60a5fa' },  // ◐ blue
  completed:     { icon: '\u2713', color: '#4ade80' },  // ✓ green
  failed:        { icon: '\u2717', color: '#f87171' },  // ✗ red
  rejected:      { icon: '\u2298', color: '#94a3b8' },  // ⊘ gray
};

function formatAge(created: string): string {
  const diff = Date.now() - new Date(created).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncateId(id: string): string {
  return id.length > 20 ? id.slice(0, 20) + '\u2026' : id;
}

export function RequestList({ requests, onCancel, onRetry, onViewHistory, historyCount }: RequestListProps) {
  const [expanded, setExpanded] = useState(false);

  const hasContent = requests.length > 0 || (historyCount && historyCount > 0);
  if (!hasContent) return null;

  return (
    <div style={{
      borderBottom: '1px solid #1e293b',
      background: '#0f172a',
      flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '4px 12px',
        gap: 6,
      }}>
        <button
          onClick={() => setExpanded(prev => !prev)}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            color: '#94a3b8',
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          <span style={{ fontSize: 10 }}>{expanded ? '\u25BC' : '\u25B6'}</span>
          <span>Active ({requests.length})</span>
        </button>

        <span style={{ flex: 1 }} />

        {onViewHistory && (
          <button
            onClick={onViewHistory}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              borderRadius: 3,
              padding: '1px 8px',
              fontSize: 10,
              color: '#94a3b8',
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
          >
            History{historyCount != null ? ` (${historyCount})` : ''}
          </button>
        )}
      </div>

      {/* Active list */}
      {expanded && requests.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: 'auto', padding: '0 12px 6px' }}>
          {requests.map(r => {
            const cfg = statusConfig[r.status] ?? { icon: '?', color: '#94a3b8' };
            const showCancel = r.status === 'pending';

            return (
              <div
                key={r.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '3px 0',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  lineHeight: 1.4,
                }}
              >
                <span style={{ color: cfg.color, width: 14, textAlign: 'center', flexShrink: 0 }}>
                  {cfg.icon}
                </span>
                <span style={{ color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.id}>
                  {truncateId(r.id)}
                </span>
                <span style={{
                  color: cfg.color,
                  background: `${cfg.color}18`,
                  border: `1px solid ${cfg.color}40`,
                  borderRadius: 3,
                  padding: '0 5px',
                  fontSize: 10,
                  flexShrink: 0,
                }}>
                  {r.status}
                </span>
                <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0 }}>
                  {formatAge(r.created)}
                </span>
                <span style={{ flex: 1 }} />
                {showCancel && (
                  <button
                    onClick={e => { e.stopPropagation(); onCancel(r.id); }}
                    style={{
                      background: 'transparent',
                      border: '1px solid #f8717140',
                      borderRadius: 3,
                      padding: '1px 6px',
                      fontSize: 10,
                      color: '#f87171',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {expanded && requests.length === 0 && (
        <div style={{ padding: '4px 12px 8px', color: '#64748b', fontSize: 11, fontFamily: 'monospace' }}>
          No active requests.
        </div>
      )}
    </div>
  );
}
