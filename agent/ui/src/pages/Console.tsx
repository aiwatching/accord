import React, { useState, useRef, useEffect, useCallback } from 'react';

interface HistoryEntry {
  command: string;
  output: string;
  success: boolean;
  timestamp: string;
}

// Lightweight markdown renderer for command output
function renderMarkdown(text: string): React.ReactNode[] {
  const lines = text.split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Heading: ## ...
    if (line.startsWith('## ')) {
      nodes.push(
        <div key={i} style={{ fontWeight: 700, fontSize: 14, color: '#f1f5f9', margin: '8px 0 4px' }}>
          {applyInline(line.slice(3))}
        </div>
      );
      i++;
      continue;
    }

    // Table: detect | ... | lines
    if (line.includes('|') && line.trim().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      nodes.push(renderTable(tableLines, nodes.length));
      continue;
    }

    // Bullet: - ...
    if (line.startsWith('- ')) {
      nodes.push(
        <div key={i} style={{ paddingLeft: 16, color: '#cbd5e1' }}>
          {'  '}{applyInline(line.slice(2))}
        </div>
      );
      i++;
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      nodes.push(<div key={i} style={{ height: 6 }} />);
      i++;
      continue;
    }

    // Plain line
    nodes.push(
      <div key={i} style={{ color: '#cbd5e1' }}>{applyInline(line)}</div>
    );
    i++;
  }

  return nodes;
}

function applyInline(text: string): React.ReactNode {
  // Bold: **...**
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

  // Inline code: `...`
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
  // Filter out separator rows (|---|---|)
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

export function Console() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [executing, setExecuting] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [history]);

  // Auto-focus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const execute = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || executing) return;

    setInput('');
    setHistoryIdx(-1);
    setCmdHistory(prev => [...prev, cmd]);
    setExecuting(true);

    try {
      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await res.json();
      setHistory(prev => [...prev, {
        command: cmd,
        output: data.output ?? data.error ?? 'No output',
        success: data.success ?? false,
        timestamp: data.timestamp ?? new Date().toISOString(),
      }]);
    } catch (err) {
      setHistory(prev => [...prev, {
        command: cmd,
        output: `Network error: ${err}`,
        success: false,
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setExecuting(false);
      inputRef.current?.focus();
    }
  }, [input, executing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      execute();
      return;
    }
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

  return (
    <div>
      <h2 style={{ color: '#f1f5f9', fontSize: 22, marginBottom: 24 }}>Console</h2>

      {/* Output area */}
      <div
        ref={outputRef}
        style={{
          background: '#0f172a',
          border: '1px solid #334155',
          borderRadius: 8,
          padding: 16,
          minHeight: 300,
          maxHeight: 'calc(100vh - 220px)',
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 12,
        }}
      >
        {/* Welcome message */}
        <div style={{ color: '#64748b', marginBottom: 8 }}>
          Welcome to Accord Console. Type 'help' for available commands.
        </div>

        {history.map((entry, i) => (
          <div key={i} style={{ marginBottom: 12 }}>
            {/* Command line */}
            <div style={{ color: '#4ade80' }}>
              $ {entry.command}
            </div>
            {/* Output */}
            <div style={{ color: entry.success ? '#cbd5e1' : '#f87171', marginTop: 2 }}>
              {renderMarkdown(entry.output)}
            </div>
          </div>
        ))}

        {executing && (
          <div style={{ color: '#64748b' }}>Executing...</div>
        )}
      </div>

      {/* Input area */}
      <div style={{ display: 'flex', gap: 8 }}>
        <span style={{
          color: '#4ade80',
          fontFamily: 'monospace',
          fontSize: 14,
          lineHeight: '36px',
          flexShrink: 0,
        }}>$</span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder="Type a command..."
          style={{
            flex: 1,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '8px 12px',
            color: '#f1f5f9',
            fontFamily: 'monospace',
            fontSize: 14,
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
          }}
        >
          Run
        </button>
      </div>
    </div>
  );
}
