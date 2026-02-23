import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useWebSocket } from './useWebSocket';
import { useApi } from './useApi';
import type { OutputLine } from '../components/OutputRenderers';

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

export interface ServiceItem {
  name: string;
  type?: string;
  language?: string;
  maintainer?: string;
  description?: string;
  status?: string;
  pendingRequests?: number;
  a2a_url?: string | null;
}

interface HubInfo {
  project: string;
}

export interface Badge {
  name: string;
  pending: number;
  active: number;
}

const MAX_BUFFER = 500;

// ── Event routing helpers ──────────────────────────────────────────────────

function isOrchestratorEvent(type: string, service?: string): boolean {
  // session:plan-* always goes to orchestrator
  if (type.startsWith('session:plan-')) return true;
  // service:added/removed are global notifications → orchestrator
  if (type === 'service:added' || type === 'service:removed') return true;
  // session:* with service=orchestrator
  if (type.startsWith('session:') && service === 'orchestrator') return true;
  return false;
}

function isServiceEvent(type: string): boolean {
  return type === 'a2a:status-update'
    || type === 'a2a:artifact-update'
    || type === 'request:claimed'
    || type === 'request:completed'
    || type === 'request:failed';
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useConsoleState() {
  // -- Data fetching --
  const { data: requests, refresh: refreshRequests } = useApi<RequestItem[]>('/api/requests');
  const { data: logs } = useApi<LogEntry[]>('/api/logs');
  const { data: hub } = useApi<HubInfo>('/api/hub/status');
  const { data: serviceList, refresh: refreshServices } = useApi<ServiceItem[]>('/api/services');
  const { events } = useWebSocket();

  // -- Orchestrator lines --
  const [orchestratorLines, setOrchestratorLines] = useState<OutputLine[]>([]);

  // -- Per-service buffers --
  const [serviceBuffers, setServiceBuffers] = useState<Record<string, OutputLine[]>>({});

  // -- Planner state --
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);

  // -- Executing flags --
  const [orchestratorExecuting, setOrchestratorExecuting] = useState(false);
  const [serviceExecuting, setServiceExecuting] = useState(false);

  // -- Logs expand/collapse --
  const [logsExpanded, setLogsExpanded] = useState(true);
  const [logsGeneration, setLogsGeneration] = useState(0);

  const lastEventIdx = useRef(0);

  // -- Derive service names --
  const services = useMemo(() => {
    return serviceList?.map(s => s.name).filter(n => n !== 'orchestrator') ?? [];
  }, [serviceList]);

  // -- Poll requests every 10s --
  useEffect(() => {
    const interval = setInterval(refreshRequests, 10000);
    return () => clearInterval(interval);
  }, [refreshRequests]);

  // -- Poll services every 15s --
  useEffect(() => {
    const interval = setInterval(refreshServices, 15000);
    return () => clearInterval(interval);
  }, [refreshServices]);

  // -- Load initial logs into orchestrator pane --
  useEffect(() => {
    if (!logs || logs.length === 0) return;
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
      setOrchestratorLines(prev => [...lines, ...prev]);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs?.length]);

  // -- Helper to append to orchestrator --
  const appendOrchestrator = useCallback((lines: OutputLine[]) => {
    setOrchestratorLines(prev => {
      const merged = [...prev];
      for (const line of lines) {
        const last = merged.length > 0 ? merged[merged.length - 1] : null;
        if (line.type === 'text' && last?.type === 'text'
            && last.requestId === line.requestId && last.service === line.service) {
          merged[merged.length - 1] = { ...last, text: last.text + line.text };
        } else {
          merged.push(line);
        }
      }
      return merged.slice(-MAX_BUFFER);
    });
  }, []);

  // -- Helper to append to a service buffer --
  const appendService = useCallback((svc: string, lines: OutputLine[]) => {
    setServiceBuffers(prev => {
      const buf = prev[svc] ?? [];
      const merged = [...buf];
      for (const line of lines) {
        const last = merged.length > 0 ? merged[merged.length - 1] : null;
        if (line.type === 'text' && last?.type === 'text'
            && last.requestId === line.requestId && last.service === line.service) {
          merged[merged.length - 1] = { ...last, text: last.text + line.text };
        } else {
          merged.push(line);
        }
      }
      return { ...prev, [svc]: merged.slice(-MAX_BUFFER) };
    });
  }, []);

  // -- Process WebSocket events --
  useEffect(() => {
    if (events.length <= lastEventIdx.current) return;
    const newEvents = events.slice(lastEventIdx.current);
    lastEventIdx.current = events.length;

    const orchLines: OutputLine[] = [];
    const svcLines: Record<string, OutputLine[]> = {};

    function addSvc(svc: string, line: OutputLine) {
      if (!svcLines[svc]) svcLines[svc] = [];
      svcLines[svc].push(line);
    }

    for (const ev of newEvents) {
      const d = ev.data as Record<string, unknown>;
      const reqId = d.requestId as string | undefined;
      const svc = d.service as string | undefined;

      // Build the output line from the event
      let line: OutputLine | null = null;

      if (ev.type === 'session:output') {
        const streamEvent = d.event as { type?: string; text?: string; tool?: string; input?: string; output?: string; isError?: boolean } | undefined;
        if (streamEvent?.type) {
          switch (streamEvent.type) {
            case 'text':
              line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'text', requestId: reqId, service: svc, text: streamEvent.text ?? '', timestamp: Date.now() };
              break;
            case 'tool_use':
              line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'tool_use', requestId: reqId, service: svc, text: streamEvent.input ?? '', tool: streamEvent.tool, timestamp: Date.now() };
              break;
            case 'tool_result':
              line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'tool_result', requestId: reqId, service: svc, text: streamEvent.output ?? '', tool: streamEvent.tool, isError: streamEvent.isError, timestamp: Date.now() };
              break;
            case 'thinking':
              line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'thinking', requestId: reqId, service: svc, text: streamEvent.text ?? '', timestamp: Date.now() };
              break;
            default:
              line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'text', requestId: reqId, service: svc, text: d.chunk as string, timestamp: Date.now() };
          }
        } else {
          line = { key: `ws-${Date.now()}-${Math.random()}`, type: 'text', requestId: reqId, service: svc, text: d.chunk as string, timestamp: Date.now() };
        }
      } else if (ev.type === 'session:start') {
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[SESSION] ${svc}: ${(d.message as string) ?? ''}`, timestamp: Date.now() };
      } else if (ev.type === 'session:complete') {
        const cost = d.costUsd as number | undefined;
        const turns = d.numTurns as number | undefined;
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[DONE] ${svc} — ${turns ?? '?'} turns, $${cost?.toFixed(4) ?? '?'}`, timestamp: Date.now() };
      } else if (ev.type === 'session:error') {
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[ERROR] ${svc}: ${d.error as string}`, timestamp: Date.now() };
      } else if (ev.type === 'session:plan-generating') {
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[PLANNING] Generating execution plan...`, timestamp: Date.now() };
      } else if (ev.type === 'session:plan-ready') {
        setPendingPlan(d.plan as string);
      } else if (ev.type === 'session:plan-canceled') {
        setPendingPlan(null);
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[CANCELED] Plan canceled`, timestamp: Date.now() };
      } else if (ev.type === 'session:plan-timeout') {
        setPendingPlan(null);
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', service: svc, text: `[TIMEOUT] Plan approval timed out`, timestamp: Date.now() };
      } else if (ev.type === 'service:added') {
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', text: `[SERVICE] Added: ${d.name as string} (${(d.type as string) ?? 'service'})`, timestamp: Date.now() };
        refreshServices();
      } else if (ev.type === 'service:removed') {
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', text: `[SERVICE] Removed: ${d.name as string}`, timestamp: Date.now() };
        refreshServices();
      } else if (ev.type === 'request:claimed' || ev.type === 'request:completed' || ev.type === 'request:failed') {
        const label = ev.type === 'request:claimed' ? 'CLAIMED'
          : ev.type === 'request:completed' ? 'COMPLETED' : 'FAILED';
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', requestId: reqId, service: svc, text: `[${label}] ${reqId} (${svc})`, timestamp: Date.now() };
      } else if (ev.type === 'a2a:status-update') {
        const state = d.state as string;
        const msg = d.message as string | undefined;
        const taskId = d.taskId as string | undefined;
        const label = state === 'working' ? 'A2A:WORKING'
          : state === 'input-required' ? 'A2A:APPROVAL'
          : state === 'completed' ? 'A2A:DONE'
          : state === 'failed' ? 'A2A:FAILED'
          : `A2A:${state.toUpperCase()}`;
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', requestId: reqId, service: svc, text: `[${label}] ${reqId} (${svc})${taskId ? ` task:${taskId}` : ''}${msg ? ` — ${msg}` : ''}`, timestamp: Date.now() };
        if (state === 'completed' || state === 'failed') {
          refreshServices();
        }
      } else if (ev.type === 'a2a:artifact-update') {
        const artifactName = d.artifactName as string;
        line = { key: `ev-${Date.now()}-${Math.random()}`, type: 'event', requestId: reqId, service: svc, text: `[A2A:ARTIFACT] ${reqId} (${svc}) — ${artifactName}`, timestamp: Date.now() };
      }

      if (!line) continue;

      // Route the line
      if (isOrchestratorEvent(ev.type, svc)) {
        orchLines.push(line);
      } else if (isServiceEvent(ev.type) && svc) {
        addSvc(svc, line);
      } else if (ev.type.startsWith('session:') && svc && svc !== 'orchestrator') {
        addSvc(svc, line);
      } else {
        // Default: orchestrator
        orchLines.push(line);
      }
    }

    if (orchLines.length > 0) appendOrchestrator(orchLines);
    for (const [svc, lines] of Object.entries(svcLines)) {
      appendService(svc, lines);
    }
  }, [events, refreshServices, appendOrchestrator, appendService]);

  // -- Compute request badges --
  const badges = useMemo<Badge[]>(() => {
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

  // -- Orchestrator command handler --
  const handleOrchestratorCommand = useCallback(async (raw: string) => {
    setOrchestratorExecuting(true);

    const firstWord = raw.split(/\s+/)[0];
    const isCommand = raw.startsWith('/') || ['status', 'scan', 'check-inbox', 'validate', 'sync', 'services', 'requests', 'help'].includes(firstWord);

    if (isCommand) {
      const command = raw.startsWith('/') ? raw.slice(1) : raw;
      try {
        const res = await fetch('/api/commands/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        });
        const data = await res.json();
        appendOrchestrator([{
          key: `cmd-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\n${data.output ?? data.error ?? 'No output'}`,
          timestamp: Date.now(),
          success: data.success ?? false,
        }]);
      } catch (err) {
        appendOrchestrator([{
          key: `cmd-err-${Date.now()}`,
          type: 'command-result',
          text: `$ ${command}\nNetwork error: ${err}`,
          timestamp: Date.now(),
          success: false,
        }]);
      }
    } else {
      // Direct session interaction with orchestrator
      appendOrchestrator([{
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
          appendOrchestrator([{
            key: `err-${Date.now()}`,
            type: 'event',
            service: 'orchestrator',
            text: `[ERROR] ${data.error ?? res.statusText}`,
            timestamp: Date.now(),
          }]);
        }
      } catch (err) {
        appendOrchestrator([{
          key: `err-${Date.now()}`,
          type: 'event',
          service: 'orchestrator',
          text: `[ERROR] Network error: ${err}`,
          timestamp: Date.now(),
        }]);
      }
    }

    setOrchestratorExecuting(false);
  }, [appendOrchestrator]);

  // -- Service message handler --
  const handleServiceMessage = useCallback(async (serviceName: string, raw: string) => {
    setServiceExecuting(true);
    const command = `send ${serviceName} ${raw}`;
    try {
      const res = await fetch('/api/commands/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      appendService(serviceName, [{
        key: `cmd-${Date.now()}`,
        type: 'command-result',
        text: `$ ${command}\n${data.output ?? data.error ?? 'No output'}`,
        timestamp: Date.now(),
        success: data.success ?? false,
      }]);
      refreshRequests();
    } catch (err) {
      appendService(serviceName, [{
        key: `cmd-err-${Date.now()}`,
        type: 'command-result',
        text: `$ ${command}\nNetwork error: ${err}`,
        timestamp: Date.now(),
        success: false,
      }]);
    }
    setServiceExecuting(false);
  }, [appendService, refreshRequests]);

  // -- Plan approval --
  const handlePlanApprove = useCallback(async (editedPlan?: string) => {
    setPendingPlan(null);
    appendOrchestrator([{
      key: `ev-${Date.now()}-${Math.random()}`,
      type: 'event',
      service: 'orchestrator',
      text: '[APPROVED] Executing orchestrator with plan...',
      timestamp: Date.now(),
    }]);

    try {
      const res = await fetch('/api/session/approve-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', editedPlan }),
      });
      if (!res.ok) {
        const data = await res.json();
        appendOrchestrator([{
          key: `err-${Date.now()}`,
          type: 'event',
          service: 'orchestrator',
          text: `[ERROR] ${data.error ?? res.statusText}`,
          timestamp: Date.now(),
        }]);
      }
    } catch (err) {
      appendOrchestrator([{
        key: `err-${Date.now()}`,
        type: 'event',
        service: 'orchestrator',
        text: `[ERROR] Network error: ${err}`,
        timestamp: Date.now(),
      }]);
    }
  }, [appendOrchestrator]);

  const handlePlanCancel = useCallback(async () => {
    setPendingPlan(null);
    try {
      await fetch('/api/session/approve-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' }),
      });
    } catch {
      // Ignore network errors on cancel
    }
  }, []);

  const toggleLogs = useCallback(() => {
    setLogsExpanded(prev => !prev);
    setLogsGeneration(prev => prev + 1);
  }, []);

  return {
    // Data
    serviceList,
    services,
    badges,
    hub,
    orchestratorLines,
    serviceBuffers,

    // Planner
    pendingPlan,
    handlePlanApprove,
    handlePlanCancel,

    // Executing
    orchestratorExecuting,
    serviceExecuting,

    // Handlers
    handleOrchestratorCommand,
    handleServiceMessage,
    refreshServices,

    // Logs
    logsExpanded,
    logsGeneration,
    toggleLogs,
  };
}
