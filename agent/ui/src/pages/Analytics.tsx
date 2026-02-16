import React, { useState, useMemo } from 'react';
import { useApi } from '../hooks/useApi';

// ── Types (mirror server AnalyticsData) ─────────────────────────────────────

interface TokenBreakdown {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
}

interface AnalyticsRequestEntry {
  requestId: string;
  service: string;
  costUsd: number;
  numTurns: number;
  durationMs: number;
  timestamp: string;
  status: string;
  tokens?: TokenBreakdown;
  modelUsage?: ModelUsage[];
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
    tokens: TokenBreakdown;
  };
  byService: AnalyticsServiceAggregate[];
  byDay: AnalyticsDayEntry[];
  byModel: ModelUsage[];
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

const thStyleStatic: React.CSSProperties = {
  ...thStyle,
  cursor: 'default',
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

function fmtTokens(n: number): string {
  if (n === 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
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

const TOKEN_COLORS = {
  input: '#3b82f6',
  output: '#8b5cf6',
  cacheRead: '#22c55e',
  cacheCreation: '#f59e0b',
};

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

  const { totals, byDay, byModel, requests } = data;
  const { tokens } = totals;
  const totalAllTokens = tokens.inputTokens + tokens.outputTokens + tokens.cacheCreationTokens + tokens.cacheReadTokens;
  const hasTokenData = totalAllTokens > 0;

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

      {/* Section 2: Token Distribution */}
      {hasTokenData && (
        <div style={{ marginBottom: 24 }}>
          <div style={sectionTitle}>Token Distribution</div>
          <div style={{
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 8,
            padding: 16,
          }}>
            {/* Stacked bar */}
            <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
              {[
                { key: 'input', label: 'Input', value: tokens.inputTokens, color: TOKEN_COLORS.input },
                { key: 'output', label: 'Output', value: tokens.outputTokens, color: TOKEN_COLORS.output },
                { key: 'cacheRead', label: 'Cache Read', value: tokens.cacheReadTokens, color: TOKEN_COLORS.cacheRead },
                { key: 'cacheCreation', label: 'Cache Creation', value: tokens.cacheCreationTokens, color: TOKEN_COLORS.cacheCreation },
              ].filter(s => s.value > 0).map(s => (
                <div
                  key={s.key}
                  title={`${s.label}: ${fmtTokens(s.value)} (${fmtPct(s.value / totalAllTokens)})`}
                  style={{
                    width: `${(s.value / totalAllTokens) * 100}%`,
                    background: s.color,
                    minWidth: s.value > 0 ? 2 : 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    color: '#fff',
                    fontWeight: 600,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {(s.value / totalAllTokens) > 0.08 ? fmtTokens(s.value) : ''}
                </div>
              ))}
            </div>

            {/* Legend with values */}
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              {[
                { label: 'Input', value: tokens.inputTokens, color: TOKEN_COLORS.input },
                { label: 'Output', value: tokens.outputTokens, color: TOKEN_COLORS.output },
                { label: 'Cache Read', value: tokens.cacheReadTokens, color: TOKEN_COLORS.cacheRead },
                { label: 'Cache Creation', value: tokens.cacheCreationTokens, color: TOKEN_COLORS.cacheCreation },
              ].map(item => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: item.color }} />
                  <span style={{ color: '#94a3b8', fontSize: 12 }}>{item.label}:</span>
                  <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600 }}>{fmtTokens(item.value)}</span>
                  <span style={{ color: '#64748b', fontSize: 11 }}>({totalAllTokens > 0 ? fmtPct(item.value / totalAllTokens) : '0%'})</span>
                </div>
              ))}
            </div>

            {/* Cache efficiency */}
            {(tokens.cacheReadTokens > 0 || tokens.cacheCreationTokens > 0) && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #334155' }}>
                <span style={{ color: '#94a3b8', fontSize: 12 }}>Cache Hit Rate: </span>
                <span style={{ color: '#4ade80', fontSize: 14, fontWeight: 700 }}>
                  {fmtPct(tokens.cacheReadTokens / (tokens.cacheReadTokens + tokens.cacheCreationTokens + tokens.inputTokens))}
                </span>
                <span style={{ color: '#64748b', fontSize: 11, marginLeft: 8 }}>
                  ({fmtTokens(tokens.cacheReadTokens)} cached of {fmtTokens(tokens.cacheReadTokens + tokens.cacheCreationTokens + tokens.inputTokens)} input)
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Section 3: Per-model usage */}
      {byModel.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={sectionTitle}>By Model</div>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyleStatic}>Model</th>
                  <th style={thStyleStatic}>Input</th>
                  <th style={thStyleStatic}>Output</th>
                  <th style={thStyleStatic}>Cache Read</th>
                  <th style={thStyleStatic}>Cache Creation</th>
                  <th style={thStyleStatic}>Cost</th>
                </tr>
              </thead>
              <tbody>
                {byModel.map(mu => (
                  <tr key={mu.model}>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#f1f5f9' }}>{mu.model}</td>
                    <td style={tdStyle}>{fmtTokens(mu.inputTokens)}</td>
                    <td style={tdStyle}>{fmtTokens(mu.outputTokens)}</td>
                    <td style={tdStyle}>{fmtTokens(mu.cacheReadTokens)}</td>
                    <td style={tdStyle}>{fmtTokens(mu.cacheCreationTokens)}</td>
                    <td style={{ ...tdStyle, fontWeight: 600 }}>{fmt$(mu.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Section 4: Per-service table */}
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

      {/* Section 5: Daily cost chart (CSS bars) */}
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

      {/* Section 6: Request history table */}
      <div>
        <div style={sectionTitle}>Request History</div>
        <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyleStatic}>Request ID</th>
                <th style={thStyleStatic}>Service</th>
                <th style={thStyleStatic}>Status</th>
                <th style={thStyleStatic}>Cost</th>
                <th style={thStyleStatic}>Turns</th>
                <th style={thStyleStatic}>Tokens (in/out)</th>
                <th style={thStyleStatic}>Duration</th>
                <th style={thStyleStatic}>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr><td colSpan={8} style={{ ...tdStyle, color: '#64748b', textAlign: 'center' }}>No requests</td></tr>
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
                  <td style={tdStyle}>
                    {req.tokens
                      ? <span title={`Cache read: ${fmtTokens(req.tokens.cacheReadTokens)}, Cache creation: ${fmtTokens(req.tokens.cacheCreationTokens)}`}>
                          <span style={{ color: TOKEN_COLORS.input }}>{fmtTokens(req.tokens.inputTokens)}</span>
                          {' / '}
                          <span style={{ color: TOKEN_COLORS.output }}>{fmtTokens(req.tokens.outputTokens)}</span>
                        </span>
                      : '-'
                    }
                  </td>
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
