import { useEffect, useRef, useState, useCallback } from 'react';

export interface WireMessage {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket(url?: string) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WireMessage[]>([]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      if (disposed) return;
      const wsUrl = url ?? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        if (!disposed) setConnected(true);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConnected(false);
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WireMessage;
          setEvents(prev => [...prev.slice(-199), msg]);
        } catch { /* ignore malformed */ }
      };
    }

    connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [url]);

  const clearEvents = useCallback(() => setEvents([]), []);

  return { connected, events, clearEvents };
}
