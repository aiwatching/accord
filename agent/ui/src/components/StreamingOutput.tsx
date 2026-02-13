import React, { useEffect, useRef } from 'react';
import type { WireMessage } from '../hooks/useWebSocket';

interface StreamingOutputProps {
  events: WireMessage[];
}

export function StreamingOutput({ events }: StreamingOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter to only worker:output events
  const outputEvents = events.filter(e => e.type === 'worker:output');

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
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {outputEvents.map((e, i) => {
        const data = e.data as { service?: string; requestId?: string; chunk?: string };
        return (
          <span key={i}>
            <span style={{ color: '#64748b' }}>[{data.service}] </span>
            {data.chunk}
          </span>
        );
      })}
    </div>
  );
}
