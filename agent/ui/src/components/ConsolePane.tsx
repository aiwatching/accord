import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  type OutputLine,
  formatTime,
  timestampStyle,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  LogBlock,
  CommandResult,
} from './OutputRenderers';

export interface ConsolePaneProps {
  lines: OutputLine[];
  executing: boolean;
  onSubmit: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  logsExpanded: boolean;
  logsGeneration: number;
  onToggleLogs: () => void;
  headerContent?: React.ReactNode;
  overlayContent?: React.ReactNode;
}

export function ConsolePane({
  lines,
  executing,
  onSubmit,
  placeholder = 'Type a message...',
  autoFocus = false,
  logsExpanded,
  logsGeneration,
  onToggleLogs,
  headerContent,
  overlayContent,
}: ConsolePaneProps) {
  const [input, setInput] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);

  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Auto-focus
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const handleSubmit = useCallback(() => {
    const raw = input.trim();
    if (!raw || executing) return;
    setInput('');
    setHistoryIdx(-1);
    setCmdHistory(prev => [...prev, raw]);
    onSubmit(raw);
    inputRef.current?.focus();
  }, [input, executing, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // Don't send on Enter — use the Send button instead
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
  }, [handleSubmit, cmdHistory, historyIdx]);

  const hasLogs = lines.some(l => l.type === 'log');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Header */}
      {headerContent && (
        <div style={{
          padding: '4px 12px',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          gap: 8,
          flexShrink: 0,
          alignItems: 'center',
          minHeight: 28,
        }}>
          {headerContent}
          {hasLogs && (
            <>
              <div style={{ flex: 1 }} />
              <button
                onClick={onToggleLogs}
                style={{
                  background: 'transparent',
                  border: '1px solid #334155',
                  borderRadius: 4,
                  padding: '2px 8px',
                  fontSize: 11,
                  color: '#94a3b8',
                  cursor: 'pointer',
                }}
              >
                {logsExpanded ? 'Collapse All' : 'Expand All'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Output area */}
      <div
        ref={outputRef}
        style={{
          flex: 1,
          background: '#0f172a',
          padding: 12,
          overflow: 'auto',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        {lines.length === 0 && (
          <div style={{ color: '#64748b' }}>
            Waiting for activity...
          </div>
        )}
        {lines.map(line => (
          <div key={line.key} style={{ marginBottom: 2, display: 'flex', alignItems: 'flex-start' }}>
            <span style={timestampStyle}>{formatTime(line.timestamp)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {line.type === 'event' && (
                <div style={{
                  color: line.text.includes('COMPLETED') || line.text.includes('DONE') ? '#4ade80'
                    : line.text.includes('FAILED') || line.text.includes('ERROR') ? '#f87171'
                    : '#fbbf24',
                  fontSize: 12,
                  padding: '2px 0',
                }}>
                  {line.text}
                </div>
              )}
              {line.type === 'text' && (
                <pre style={{ color: '#cbd5e1', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {line.text}
                </pre>
              )}
              {line.type === 'tool_use' && (
                <ToolUseBlock tool={line.tool ?? 'unknown'} input={line.text} />
              )}
              {line.type === 'tool_result' && (
                <ToolResultBlock tool={line.tool} output={line.text} isError={line.isError} />
              )}
              {line.type === 'thinking' && (
                <ThinkingBlock text={line.text} />
              )}
              {line.type === 'log' && (
                <LogBlock key={`${line.key}-g${logsGeneration}`} requestId={line.requestId!} service={line.service!} text={line.text} defaultExpanded={logsExpanded} />
              )}
              {line.type === 'command-result' && (
                <CommandResult text={line.text} success={line.success} />
              )}
            </div>
          </div>
        ))}
        {executing && (
          <div style={{ color: '#64748b' }}>Executing...</div>
        )}
      </div>

      {/* Overlay (plan modal etc.) */}
      {overlayContent}

      {/* Input bar */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid #334155',
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        flexShrink: 0,
        background: '#1e293b',
      }}>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => { setInput(e.target.value); setHistoryIdx(-1); }}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder={placeholder}
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
          onClick={handleSubmit}
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
