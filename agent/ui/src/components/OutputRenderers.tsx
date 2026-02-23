import React, { useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────

export interface OutputLine {
  key: string;
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'event' | 'log' | 'command-result';
  requestId?: string;
  service?: string;
  text: string;
  timestamp: number;
  success?: boolean;
  /** Tool name (for tool_use and tool_result types). */
  tool?: string;
  /** Whether a tool result is an error (for tool_result type). */
  isError?: boolean;
}

// ── Utility ────────────────────────────────────────────────────────────────

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const timestampStyle: React.CSSProperties = {
  color: '#475569',
  fontSize: 11,
  fontFamily: 'monospace',
  marginRight: 8,
  flexShrink: 0,
  userSelect: 'none',
};

// ── Tool colors ────────────────────────────────────────────────────────────

export const TOOL_COLORS: Record<string, { bg: string; fg: string }> = {
  Read:    { bg: '#1e3a5f', fg: '#7dd3fc' },
  Write:   { bg: '#3b1f2b', fg: '#f9a8d4' },
  Edit:    { bg: '#3b2f1e', fg: '#fbbf24' },
  Bash:    { bg: '#1a2e1a', fg: '#86efac' },
  Glob:    { bg: '#2e1a3b', fg: '#c4b5fd' },
  Grep:    { bg: '#2e1a3b', fg: '#c4b5fd' },
  WebFetch:    { bg: '#1e3a5f', fg: '#7dd3fc' },
  WebSearch:   { bg: '#1e3a5f', fg: '#7dd3fc' },
  NotebookEdit: { bg: '#3b2f1e', fg: '#fbbf24' },
};
export const DEFAULT_TOOL_COLOR = { bg: '#1e293b', fg: '#94a3b8' };

// ── Render blocks ──────────────────────────────────────────────────────────

export function ToolUseBlock({ tool, input }: { tool: string; input: string }) {
  const color = TOOL_COLORS[tool] ?? DEFAULT_TOOL_COLOR;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0' }}>
      <span style={{
        background: color.bg,
        color: color.fg,
        padding: '1px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'monospace',
        flexShrink: 0,
        lineHeight: '18px',
      }}>{tool}</span>
      <span style={{
        color: '#94a3b8',
        fontSize: 12,
        fontFamily: 'monospace',
        wordBreak: 'break-all',
        lineHeight: '18px',
      }}>{input}</span>
    </div>
  );
}

export function ToolResultBlock({ tool, output, isError }: { tool?: string; output: string; isError?: boolean }) {
  const [collapsed, setCollapsed] = useState(true);
  const lines = output.split('\n');
  const preview = lines.slice(0, 3).join('\n');
  const hasMore = lines.length > 3;

  return (
    <div style={{
      margin: '1px 0',
      borderLeft: `2px solid ${isError ? '#ef4444' : '#334155'}`,
      paddingLeft: 10,
    }}>
      <div
        onClick={() => hasMore && setCollapsed(!collapsed)}
        style={{ cursor: hasMore ? 'pointer' : 'default', position: 'relative' }}
      >
        {hasMore && (
          <span style={{
            position: 'absolute',
            right: 0,
            top: 0,
            color: '#475569',
            fontSize: 10,
            userSelect: 'none',
          }}>
            {collapsed ? `${lines.length} lines \u25B8` : '\u25BE'}
          </span>
        )}
        <pre style={{
          color: isError ? '#fca5a5' : '#64748b',
          fontSize: 11,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          maxHeight: collapsed ? 65 : 400,
          overflow: collapsed ? 'hidden' : 'auto',
        }}>
          {collapsed ? preview : output}
        </pre>
      </div>
    </div>
  );
}

export function ThinkingBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const preview = text.slice(0, 80).replace(/\n/g, ' ');

  return (
    <div style={{ margin: '2px 0' }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          cursor: 'pointer',
          color: '#6b7280',
          fontSize: 11,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '\u25BE' : '\u25B8'}</span>
        <span style={{ fontStyle: 'italic' }}>thinking{!open && `: ${preview}...`}</span>
      </div>
      {open && (
        <pre style={{
          color: '#6b7280',
          fontSize: 11,
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginLeft: 14,
          marginTop: 2,
          maxHeight: 300,
          overflow: 'auto',
        }}>
          {text}
        </pre>
      )}
    </div>
  );
}

export function LogBlock({ requestId, service, text, defaultExpanded = false }: { requestId: string; service: string; text: string; defaultExpanded?: boolean }) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);
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

export function CommandResult({ text, success }: { text: string; success?: boolean }) {
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

// ── Lightweight markdown renderer ──────────────────────────────────────────

export function renderMarkdown(text: string): React.ReactNode[] {
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

export function applyInline(text: string): React.ReactNode {
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

export function renderTable(lines: string[], baseKey: number): React.ReactNode {
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
