import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ConsolePane } from './ConsolePane';
import type { OutputLine } from './OutputRenderers';

interface ServicePaneProps {
  services: string[];
  serviceBuffers: Record<string, OutputLine[]>;
  executing: boolean;
  onSendMessage: (service: string, text: string) => void;
  logsExpanded: boolean;
  logsGeneration: number;
  onToggleLogs: () => void;
}

export function ServicePane({
  services,
  serviceBuffers,
  executing,
  onSendMessage,
  logsExpanded,
  logsGeneration,
  onToggleLogs,
}: ServicePaneProps) {
  const [selectedService, setSelectedService] = useState<string>(services[0] ?? '');

  // Keep selection valid when services change
  const activeService = services.includes(selectedService) ? selectedService : (services[0] ?? '');
  useEffect(() => {
    if (activeService !== selectedService) {
      setSelectedService(activeService);
    }
  }, [activeService, selectedService]);

  const lines = useMemo(() => activeService ? (serviceBuffers[activeService] ?? []) : [], [activeService, serviceBuffers]);

  const handleSubmit = useCallback((text: string) => {
    if (activeService) {
      onSendMessage(activeService, text);
    }
  }, [activeService, onSendMessage]);

  if (services.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#64748b',
        fontSize: 13,
        fontFamily: 'monospace',
      }}>
        <div>No services registered.</div>
        <div style={{ fontSize: 11, marginTop: 4 }}>Add a service using the + button above.</div>
      </div>
    );
  }

  return (
    <ConsolePane
      lines={lines}
      executing={executing}
      onSubmit={handleSubmit}
      placeholder={activeService ? `Send a message to ${activeService}...` : 'Select a service...'}
      logsExpanded={logsExpanded}
      logsGeneration={logsGeneration}
      onToggleLogs={onToggleLogs}
      headerContent={
        <>
          <select
            value={activeService}
            onChange={e => setSelectedService(e.target.value)}
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              border: '1px solid #334155',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 12,
              fontFamily: 'monospace',
              outline: 'none',
            }}
          >
            {services.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span style={{ color: '#64748b', fontSize: 11 }}>console</span>
        </>
      }
    />
  );
}
