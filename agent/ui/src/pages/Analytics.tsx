import React, { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';

// ── Types (mirror server AnalyticsData) ─────────────────────────────────────

interface AnalyticsRequestEntry {
  requestId: string;
  service: string;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  timestamp: string;
  status: string;
}

interface AnalyticsServiceAggregate {
  service: string;
  requestCount: number;
  totalCost: number;
  avgCost: number;
  totalTurns: number;
  avgTurns: number;
  completed: number;
  failed: number;
}

interface AnalyticsDayEntry {
  date: string;
  totalCost: number;
  requestCount: number;
  avgCost: number;
}

interface AnalyticsData {
  totals: {
    totalRequests: number;
    totalCost: number;
    avgCost: number;
    avgTurns: number;
    successRate: number;
  };
  byService: AnalyticsServiceAggregate[];
  byDay: AnalyticsDayEntry[];
  requests: AnalyticsRequestEntry[];
}

// ── Styles ──────────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: '16px 20px',
  flex: '1 1 0',
  minWidth: 140,
};

const cardLabel: React.CSSProperties = {
  color: '#94a3b8',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  marginBottom: 4,
};

const cardValue: React.CSSProperties = {
  color: '#f1f5f9',
  fontSize: 24,
  fontWeight: 700,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  color: '#94a3b8',
  borderBottom: '1px solid #334155',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  userSelect: 'none',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 12px',
  color: '#cbd5e1',
  borderBottom: '1px solid #1e293b',
  fontSize: 13,
};

const sectionTitle: React.CSSProperties = {
  color: '#f1f5f9',
  fontSize: 15,
  fontWeight: 700,
  marginBottom: 12,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function fmt$(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtDuration(ms: number): string {
  if (ms === 0) return '-';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = s / 60;
  return `${m.toFixed(1)}m`;
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function statusColor(status: string): string {
  if (status === 'completed') return '#4ade80';
  if (status === 'failed') return '#f87171';
  return '#fbbf24';
}

// ── Component ───────────────────────────────────────────────────────────────

type SortKey = 'service' | 'requestCount' | 'totalCost' | 'avgCost' | 'totalTurns' | 'avgTurns';

export function Analytics() {
  const { data, loading, error } = useApi<AnalyticsData>('/api/hub/analytics');
  const [sortKey, setSortKey] = useState<SortKey>('totalCost');
  const [sortAsc, setSortAsc] = useState(false);

  const sortedServices = useMemo(() => {
    if (!data) return [];
    const arr = [...data.byService];
    arr.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'string' && typeof bv === 'string') {
        return sortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortAsc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return arr;
  }, [data, sortKey, sortAsc]);

  const maxDailyCost = useMemo(() => {
    if (!data) return 0;
    return Math.max(...data.byDay.map(d => d.totalCost), 0.001);
  }, [data]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortAsc ? ' \u25B4' : ' \u25BE';
  };

  if (loading) {
    return (
      <div style={{ padding: 32, color: '#64748b', textAlign: 'center' }}>
        Loading analytics...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: '#f87171', textAlign: 'center' }}>
        Error loading analytics: {error}
      </div>
    );
  }

  if (!data) return null;

  const { totals, byDay, requests } = data;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 20, background: '#0f172a' }}>
      {/* Section 1: Summary cards */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={cardStyle}>
          <div style={cardLabel}>Total Cost</div>
          <div style={cardValue}>{fmt$(totals.totalCost)}</div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabel}>Total Requests</div>
          <div style={cardValue}>{totals.totalRequests}</div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabel}>Avg Cost / Request</div>
          <div style={cardValue}>{fmt$(totals.avgCost)}</div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabel}>Avg Turns / Request</div>
          <div style={cardValue}>{totals.avgTurns.toFixed(1)}</div>
        </div>
        <div style={cardStyle}>
          <div style={cardLabel}>Success Rate</div>
          <div style={{ ...cardValue, color: totals.successRate >= 0.8 ? '#4ade80' : totals.successRate >= 0.5 ? '#fbbf24' : '#f87171' }}>
            {fmtPct(totals.successRate)}
          </div>
        </div>
      </div>

      {/* Section 2: Per-service table */}
      <div style={{ marginBottom: 24 }}>
        <div style={sectionTitle}>By Service</div>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle} onClick={() => handleSort('service')}>Service{sortIndicator('service')}</th>
                <th style={thStyle} onClick={() => handleSort('requestCount')}>Requests{sortIndicator('requestCount')}</th>
                <th style={thStyle} onClick={() => handleSort('totalCost')}>Total Cost{sortIndicator('totalCost')}</th>
                <th style={thStyle} onClick={() => handleSort('avgCost')}>Avg Cost{sortIndicator('avgCost')}</th>
                <th style={thStyle} onClick={() => handleSort('totalTurns')}>Total Turns{sortIndicator('totalTurns')}</th>
                <th style={thStyle} onClick={() => handleSort('avgTurns')}>Avg Turns{sortIndicator('avgTurns')}</th>
              </tr>
            </thead>
            <tbody>
              {sortedServices.length === 0 && (
                <tr><td colSpan={6} style={{ ...tdStyle, color: '#64748b', textAlign: 'center' }}>No data</td></tr>
              )}
              {sortedServices.map(svc => (
                <tr key={svc.service}>
                  <td style={{ ...tdStyle, fontWeight: 600, color: '#f1f5f9' }}>{svc.service}</td>
                  <td style={tdStyle}>
                    {svc.requestCount}
                    <span style={{ color: '#64748b', fontSize: 11, marginLeft: 4 }}>
                      ({svc.completed}ok / {svc.failed}fail)
                    </span>
                  </td>
                  <td style={tdStyle}>{fmt$(svc.totalCost)}</td>
                  <td style={tdStyle}>{fmt$(svc.avgCost)}</td>
                  <td style={tdStyle}>{svc.totalTurns}</td>
                  <td style={tdStyle}>{svc.avgTurns.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 3: Daily cost chart (CSS bars) */}
      {byDay.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={sectionTitle}>Daily Cost</div>
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120 }}>
              {byDay.map(day => {
                const pct = (day.totalCost / maxDailyCost) * 100;
                return (
                  <div
                    key={day.date}
                    style={{
                      flex: '1 1 0',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '100%',
                      justifyContent: 'flex-end',
                    }}
                    title={`${day.date}: ${fmt$(day.totalCost)} (${day.requestCount} requests)`}
                  >
                    <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4 }}>
                      {fmt$(day.totalCost)}
                    </div>
                    <div style={{
                      width: '100%',
                      maxWidth: 40,
                      background: '#3b82f6',
                      borderRadius: '4px 4px 0 0',
                      height: `${Math.max(pct, 2)}%`,
                      minHeight: 2,
                    }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              {byDay.map(day => (
                <div
                  key={day.date}
                  style={{
                    flex: '1 1 0',
                    textAlign: 'center',
                    fontSize: 10,
                    color: '#64748b',
                  }}
                >
                  {day.date.slice(5)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Section 4: Request history table */}
      <div>
        <div style={sectionTitle}>Request History</div>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Request ID</th>
                <th style={thStyle}>Service</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Cost</th>
                <th style={thStyle}>Turns</th>
                <th style={thStyle}>Duration</th>
                <th style={thStyle}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, color: '#64748b', textAlign: 'center' }}>No requests</td></tr>
              )}
              {requests.map(req => (
                <tr key={req.requestId}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{req.requestId}</td>
                  <td style={tdStyle}>{req.service}</td>
                  <td style={{ ...tdStyle, color: statusColor(req.status), fontWeight: 600 }}>
                    {req.status}
                  </td>
                  <td style={tdStyle}>{req.costUsd > 0 ? fmt$(req.costUsd) : '-'}</td>
                  <td style={tdStyle}>{req.numTurns > 0 ? req.numTurns : '-'}</td>
                  <td style={tdStyle}>{fmtDuration(req.durationMs)}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: '#94a3b8' }}>
                    {req.timestamp ? new Date(req.timestamp).toLocaleString() : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
