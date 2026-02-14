import React, { useEffect, useRef, useMemo } from 'react';
import type { WireMessage } from '../hooks/useWebSocket';

interface StreamingOutputProps {
  events: WireMessage[];
}

interface OutputGroup {
  requestId: string;
  service: string;
  chunks: string[];
}

export function StreamingOutput({ events }: StreamingOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const outputEvents = events.filter(e => e.type === 'worker:output');

  const groups = useMemo(() => {
    const result: OutputGroup[] = [];
    let current: OutputGroup | null = null;

    for (const e of outputEvents) {
      const data = e.data as { service?: string; requestId?: string; chunk?: string };
      const rid = data.requestId ?? 'unknown';
      const svc = data.service ?? 'unknown';

      if (current && current.requestId === rid) {
        current.chunks.push(data.chunk ?? '');
      } else {
        current = { requestId: rid, service: svc, chunks: [data.chunk ?? ''] };
        result.push(current);
      }
    }

    return result;
  }, [outputEvents.length]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [outputEvents.length]);

  if (outputEvents.length === 0) {
    return (
      <div style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: 16,
        color: '#64748b',
        fontSize: 13,
        fontFamily: 'monospace',
      }}>
        Waiting for agent output...
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 8,
        padding: 16,
        maxHeight: 400,
        overflow: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#e2e8f0',
      }}
    >
      {groups.map((group, gi) => (
        <div key={gi} style={{
          borderBottom: gi < groups.length - 1 ? '1px solid #1e293b' : undefined,
          paddingBottom: gi < groups.length - 1 ? 8 : 0,
          marginBottom: gi < groups.length - 1 ? 8 : 0,
        }}>
          <div style={{ color: '#3b82f6', fontWeight: 600, marginBottom: 4 }}>
            [{group.service}] {group.requestId}
          </div>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {group.chunks.join('')}
          </div>
        </div>
      ))}
    </div>
  );
}
