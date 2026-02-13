import { useEffect, useRef, useState, useCallback } from 'react';

export interface WireMessage {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket(url?: string) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WireMessage[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    const wsUrl = url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as WireMessage;
        setEvents(prev => [...prev.slice(-199), msg]); // Keep last 200
      } catch { /* ignore malformed */ }
    };

    wsRef.current = ws;
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { connected, events, clearEvents };
}
