import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket, type WireMessage } from '../hooks/useWebSocket';
import { useApi } from '../hooks/useApi';

// ── Types ──────────────────────────────────────────────────────────────────

interface RequestItem {
  id: string;
  to: string;
  service: string;
  status: string;
  priority: string;
  type: string;
}

interface LogEntry {
  requestId: string;
  service: string;
  size: number;
  modified: string;
}

interface LogDetail {
  requestId: string;
  content: string;
}

interface ServiceItem {
  name: string;
  type?: string;
  language?: string;
  maintainer?: string;
  description?: string;
  status?: string;
  pendingRequests?: number;
}

interface HubInfo {
  project: string;
}

// ── Inline event types appended to the output view ─────────────────────────

interface OutputLine {
  key: string;
  type: 'chunk' | 'event' | 'log' | 'command-result';
  requestId?: string;
  service?: string;
  text: string;
  timestamp: number;
  success?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export function Console() {
  // -- Data fetching --
  const { data: requests, refresh: refreshRequests } = useApi<RequestItem[]>('/api/requests');
  const { data: logs } = useApi<LogEntry[]>('/api/logs');
  const { data: hub } = useApi<HubInfo>('/api/hub/status');
  const { data: serviceList } = useApi<ServiceItem[]>('/api/services');
  const { events } = useWebSocket();

  // -- Output lines (session output + inline events + command results) --
  const [outputLines, setOutputLines] = useState<OutputLine[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string>('all');

  // -- Console input --
  const [input, setInput] = useState('');
  const [selectedService, setSelectedService] = useState('orchestrator');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [executing, setExecuting] = useState(false);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastEventIdx = useRef(0);

  // -- Derive service list --
  const services = useMemo(() => {
    const names = serviceList?.map(s => s.name) ?? [];
    // Always include orchestrator at the top
    if (!names.includes('orchestrator')) {
      names.unshift('orchestrator');
    }
    return names;
  }, [serviceList]);

  // -- Poll requests every 10s --
  useEffect(() => {
    const interval = setInterval(refreshRequests, 10000);
    return () => clearInterval(interval);
  }, [refreshRequests]);

  // -- Load initial logs on mount --
  useEffect(() => {
    if (!logs || logs.length === 0) return;
    // Load the most recent log files (up to 5)
    const recent = logs.slice(0, 5);
    Promise.all(
      recent.map(async (l) => {
        const res = await fetch(`/api/logs/${l.requestId}`);
        if (!res.ok) return null;
        const data: LogDetail = await res.json();
        return data;
      })
    ).then(results => {
      const lines: OutputLine[] = [];
      for (const r of results) {
        if (!r) continue;
        const entry = logs.find(l => l.requestId === r.requestId);
        lines.push({
          key: `log-${r.requestId}`,
          type: 'log',
          requestId: r.requestId,
          service: entry?.service ?? 'unknown',
          text: r.content,
          timestamp: entry ? new Date(entry.modified).getTime() : Date.now(),
        });
      }
      setOutputLines(prev => [...lines, ...prev]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs?.length]);

  // -- Process new WebSocket events --
  useEffect(() => {
    if (events.length <= lastEventIdx.current) return;
    const newEvents = events.slice(lastEventIdx.current);
    lastEventIdx.current = events.length;

    const newLines: OutputLine[] = [];
    for (const ev of newEvents) {
      const d = ev.data as Record<string, unknown>;
      const reqId = d.requestId as string | undefined;
      const svc = d.service as string | undefined;

      if (ev.type === 'worker:output' || ev.type === 'session:output') {
        newLines.push({
          key: `ws-${Date.now()}-${Math.random()}`,
          type: 'chunk',
          requestId: reqId,
          service: svc,
          text: d.chunk as string,
          timestamp: Date.now(),
        });
      } else if (ev.type === 'session:start') {
        newLines.push({
          key: `ev-${Date.now()}-${Math.random()}`,
          type: 'event',
          service: svc,
          text: `[SESSION] ${svc}: ${(d.message as string) ?? ''}`,
          timestamp: Date.now(),
        });
      } else if (ev.type === 'session:complete') {
        const cost = d.costUsd as number | undefined;
        const turns = d.numTurns as number | undefined;
        newLines.push({
          key: `ev-${Date.now()}-${Math.random()}`,
          type: 'event',
          service: svc,
          text: `[DONE] ${svc} — ${turns ?? '?'} turns, $${cost?.toFixed(4) ?? '?'}`,
          timestamp: Date.now(),
        });
      } else if (ev.type === 'session:error') {
        newLines.push({
          key: `ev-${Date.now()}-${Math.random()}`,
          type: 'event',
          service: svc,
          text: `[ERROR] ${svc}: ${d.error as string}`,
          timestamp: Date.now(),
        });
      } else if (ev.type === 'request:claimed' || ev.type === 'request:completed' || ev.type === 'request:failed') {
        const label = ev.type === 'request:claimed' ? 'CLAIMED'
          : ev.type === 'request:completed' ? 'COMPLETED' : 'FAILED';
        newLines.push({
          key: `ev-${Date.now()}-${Math.random()}`,
          type: 'event',
          requestId: reqId,
          service: svc,
          text: `[${label}] ${reqId} (${svc})`,
          timestamp: Date.now(),
        });
      }
    }

    if (newLines.length > 0) {
      setOutputLines(prev => [...prev, ...newLines].slice(-500));
    }
  }, [events]);

  // -- Auto-scroll --
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputLines]);

  // -- Auto-focus --
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // -- Execute command --
  const execute = useCallback(async () => {
    const raw = input.trim();
    if (!raw || executing) return;

    setInput('');
    setHistoryIdx(-1);
    setCmdHistory(prev => [...prev, raw]);
    setExecuting(true);

    // Determine if this is a built-in command or a message to an agent
    const firstWord = raw.split(/\s+/)[0];
    const isCommand = raw.startsWith('/') || ['status', 'scan', 'check-inbox', 'validate', 'sync', 'services', 'requests', 'help'].includes(firstWord);

    if (isCommand) {
      // Execute as a built-in command
      const command = raw.startsWith('/') ? raw.slice(1) : raw;
      try {
        const res = await fetch('/api/commands/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        });
        const data = await res.json();
        setOutputLines(prev => [...prev, {
          key: `cmd-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\n${data.output ?? data.error ?? 'No output'}`,
          timestamp: Date.now(),
          success: data.success ?? false,
        }]);
      } catch (err) {
        setOutputLines(prev => [...prev, {
          key: `cmd-err-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\nNetwork error: ${err}`,
          timestamp: Date.now(),
          success: false,
        }]);
      }
    } else if (selectedService === 'orchestrator') {
      // Direct session interaction with orchestrator
      // Output streams via WebSocket session:output events — just fire and forget
      setOutputLines(prev => [...prev, {
        key: `msg-${Date.now()}`,
        type: 'event',
        service: 'orchestrator',
        text: `[YOU] ${raw}`,
        timestamp: Date.now(),
      }]);
      try {
        const res = await fetch('/api/session/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: raw }),
        });
        if (!res.ok) {
          const data = await res.json();
          setOutputLines(prev => [...prev, {
            key: `err-${Date.now()}`,
            type: 'event',
            service: 'orchestrator',
            text: `[ERROR] ${data.error ?? res.statusText}`,
            timestamp: Date.now(),
          }]);
        }
      } catch (err) {
        setOutputLines(prev => [...prev, {
          key: `err-${Date.now()}`,
          type: 'event',
          service: 'orchestrator',
          text: `[ERROR] Network error: ${err}`,
          timestamp: Date.now(),
        }]);
      }
    } else {
      // Send as request to other services (via file-based protocol)
      const command = `send ${selectedService} ${raw}`;
      try {
        const res = await fetch('/api/commands/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        });
        const data = await res.json();
        setOutputLines(prev => [...prev, {
          key: `cmd-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\n${data.output ?? data.error ?? 'No output'}`,
          timestamp: Date.now(),
          success: data.success ?? false,
        }]);
        refreshRequests();
      } catch (err) {
        setOutputLines(prev => [...prev, {
          key: `cmd-err-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\nNetwork error: ${err}`,
          timestamp: Date.now(),
          success: false,
        }]);
      }
    }

    setExecuting(false);
    inputRef.current?.focus();
  }, [input, executing, selectedService, refreshRequests]);

  // -- Key handling --
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const newIdx = historyIdx === -1 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(cmdHistory[newIdx]);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx === -1) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= cmdHistory.length) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    }
  }, [execute, cmdHistory, historyIdx]);

  // -- Compute request badges --
  const badges = useMemo(() => {
    if (!requests) return [];
    const groups: Record<string, { pending: number; active: number }> = {};
    for (const r of requests) {
      const svc = r.service;
      if (!groups[svc]) groups[svc] = { pending: 0, active: 0 };
      if (r.status === 'pending' || r.status === 'approved') {
        groups[svc].pending++;
      } else if (r.status === 'in-progress') {
        groups[svc].active++;
      }
    }
    return Object.entries(groups)
      .filter(([, v]) => v.pending > 0 || v.active > 0)
      .map(([name, v]) => ({ name, ...v }));
  }, [requests]);

  // -- Filter output lines --
  const filteredLines = useMemo(() => {
    if (serviceFilter === 'all') return outputLines;
    return outputLines.filter(l => !l.service || l.service === serviceFilter);
  }, [outputLines, serviceFilter]);

  // -- Unique services seen in output (for filter tabs) --
  const seenServices = useMemo(() => {
    const set = new Set<string>();
    for (const l of outputLines) {
      if (l.service) set.add(l.service);
    }
    return Array.from(set);
  }, [outputLines]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Section 1: Services overview */}
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
      </div>

      {/* Section 2: Session output (main area) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Filter tabs */}
        <div style={{
          padding: '4px 16px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          gap: 4,
          flexShrink: 0,
        }}>
          {['all', ...seenServices].map(s => (
            <button
              key={s}
              onClick={() => setServiceFilter(s)}
              style={{
                background: serviceFilter === s ? '#334155' : 'transparent',
                border: '1px solid',
                borderColor: serviceFilter === s ? '#475569' : 'transparent',
                borderRadius: 4,
                padding: '2px 8px',
                fontSize: 11,
                color: serviceFilter === s ? '#f1f5f9' : '#64748b',
                cursor: 'pointer',
              }}
            >
              {s === 'all' ? 'All' : s}
            </button>
          ))}
        </div>

        {/* Output area */}
        <div
          ref={outputRef}
          style={{
            flex: 1,
            background: '#0f172a',
            padding: 16,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          {filteredLines.length === 0 && (
            <div style={{ color: '#64748b' }}>
              Waiting for activity... Type a message below to send to a service.
            </div>
          )}
          {filteredLines.map(line => (
            <div key={line.key} style={{ marginBottom: 2 }}>
              {line.type === 'event' && (
                <div style={{
                  color: line.text.includes('COMPLETED') ? '#4ade80'
                    : line.text.includes('FAILED') ? '#f87171'
                    : '#fbbf24',
                  fontSize: 12,
                  padding: '2px 0',
                }}>
                  {line.text}
                </div>
              )}
              {line.type === 'chunk' && (
                <span style={{ color: '#cbd5e1' }}>
                  {line.text}
                </span>
              )}
              {line.type === 'log' && (
                <LogBlock requestId={line.requestId!} service={line.service!} text={line.text} />
              )}
              {line.type === 'command-result' && (
                <CommandResult text={line.text} success={line.success} />
              )}
            </div>
          ))}
          {executing && (
            <div style={{ color: '#64748b' }}>Executing...</div>
          )}
        </div>
      </div>

      {/* Section 3: Console input (fixed bottom) */}
      <div style={{
        padding: '8px 16px',
        borderTop: '1px solid #334155',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexShrink: 0,
        background: '#1e293b',
      }}>
        <select
          value={selectedService}
          onChange={e => setSelectedService(e.target.value)}
          style={{
            background: '#0f172a',
            color: '#e2e8f0',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '7px 8px',
            fontSize: 13,
            fontFamily: 'monospace',
            outline: 'none',
            flexShrink: 0,
          }}
        >
          {services.length === 0 && <option value="orchestrator">orchestrator</option>}
          {services.map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder="Type a message or command (status, help, /scan...)"
          style={{
            flex: 1,
            background: '#0f172a',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '8px 12px',
            color: '#f1f5f9',
            fontFamily: 'monospace',
            fontSize: 13,
            outline: 'none',
          }}
        />
        <button
          onClick={execute}
          disabled={executing || !input.trim()}
          style={{
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 13,
            fontWeight: 600,
            cursor: executing || !input.trim() ? 'not-allowed' : 'pointer',
            opacity: executing || !input.trim() ? 0.5 : 1,
            flexShrink: 0,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function LogBlock({ requestId, service, text }: { requestId: string; service: string; text: string }) {
  const [collapsed, setCollapsed] = useState(true);
  const preview = text.split('\n').slice(1, 4).join(' ').slice(0, 120);

  return (
    <div style={{ margin: '4px 0' }}>
      <div
        onClick={() => setCollapsed(!collapsed)}
        style={{
          cursor: 'pointer',
          color: '#94a3b8',
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <span>{collapsed ? '\u25B8' : '\u25BE'}</span>
        <span style={{ color: '#64748b' }}>[{service}]</span>
        <span style={{ color: '#e2e8f0', fontWeight: 500 }}>{requestId}</span>
        {collapsed && (
          <span style={{ color: '#475569', marginLeft: 4 }}>{preview}...</span>
        )}
      </div>
      {!collapsed && (
        <pre style={{
          color: '#cbd5e1',
          fontSize: 12,
          whiteSpace: 'pre-wrap',
          marginLeft: 16,
          marginTop: 4,
          padding: 8,
          background: '#1e293b',
          borderRadius: 4,
          maxHeight: 400,
          overflow: 'auto',
        }}>
          {text}
        </pre>
      )}
    </div>
  );
}

function CommandResult({ text, success }: { text: string; success?: boolean }) {
  const lines = text.split('\n');
  const cmdLine = lines[0] ?? '';
  const output = lines.slice(1).join('\n');

  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ color: '#4ade80', fontSize: 13 }}>{cmdLine}</div>
      <div style={{ color: success === false ? '#f87171' : '#cbd5e1', marginTop: 2, whiteSpace: 'pre-wrap' }}>
        {renderMarkdown(output)}
      </div>
    </div>
  );
}

// ── Lightweight markdown renderer (reused from old Console) ─────────────────

function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('## ')) {
      nodes.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', margin: '8px 0 4px' }}>
          {applyInline(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }

    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      nodes.push(renderTable(tableLines, nodes.length));
      continue;
    }

    if (line.startsWith('- ')) {
      nodes.push(
        <div key={i} style={{ paddingLeft: 16, color: '#cbd5e1' }}>
          {'  '}{applyInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: 6 }} />);
      i++;
      continue;
    }

    nodes.push(
      <div key={i} style={{ color: '#cbd5e1' }}>{applyInline(line)}</div>
    );
    i++;
  }

  return nodes;
}

function applyInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    parts.push(<strong key={key++} style={{ color: '#f1f5f9' }}>{match[1]}</strong>);
    last = match.index + match[0].length;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }

  if (parts.length === 1 && typeof parts[0] === 'string') {
    const codeRe = /`(.+?)`/g;
    const codeParts: React.ReactNode[] = [];
    let codeLast = 0;
    let codeMatch: RegExpExecArray | null;
    let codeKey = 0;
    const str = parts[0];

    while ((codeMatch = codeRe.exec(str)) !== null) {
      if (codeMatch.index > codeLast) {
        codeParts.push(str.slice(codeLast, codeMatch.index));
      }
      codeParts.push(
        <code key={codeKey++} style={{ background: '#334155', padding: '1px 4px', borderRadius: 3, fontSize: 12 }}>
          {codeMatch[1]}
        </code>
      );
      codeLast = codeMatch.index + codeMatch[0].length;
    }

    if (codeLast > 0) {
      if (codeLast < str.length) {
        codeParts.push(str.slice(codeLast));
      }
      return <>{codeParts}</>;
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

function renderTable(lines: string[], baseKey: number): React.ReactNode {
  const dataLines = lines.filter(l => !/^\|[\s\-|]+\|$/.test(l.trim()));
  if (dataLines.length === 0) return null;

  const parseRow = (line: string) =>
    line.split('|').slice(1, -1).map(c => c.trim());

  const header = parseRow(dataLines[0]);
  const rows = dataLines.slice(1).map(parseRow);

  return (
    <table key={baseKey} style={{ borderCollapse: 'collapse', margin: '4px 0', fontSize: 12, width: '100%' }}>
      <thead>
        <tr>
          {header.map((h, i) => (
            <th key={i} style={{
              textAlign: 'left', padding: '4px 8px', color: '#94a3b8',
              borderBottom: '1px solid #334155', fontWeight: 600,
            }}>
              {applyInline(h)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={ri}>
            {row.map((cell, ci) => (
              <td key={ci} style={{
                padding: '3px 8px', color: '#cbd5e1',
                borderBottom: '1px solid #1e293b',
              }}>
                {applyInline(cell)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
