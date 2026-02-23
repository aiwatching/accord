import React, { useState, useMemo } from 'react';
import { useConsoleState } from '../hooks/useConsoleState';
import { ServiceCards } from '../components/ServiceCards';
import { OrchestratorPane } from '../components/OrchestratorPane';
import { ServicePane } from '../components/ServicePane';
import { AddServiceModal } from '../components/AddServiceModal';
import { RequestsPage } from './Requests';

interface ConsoleProps {
  renderRequestsPage?: boolean;
  onViewHistory?: () => void;
}

export function Console({ renderRequestsPage, onViewHistory }: ConsoleProps) {
  const {
    serviceList,
    services,
    badges,
    orchestratorLines,
    serviceBuffers,
    pendingPlan,
    handlePlanApprove,
    handlePlanCancel,
    orchestratorExecuting,
    serviceExecuting,
    allRequests,
    serviceRequests,
    handleCancelRequest,
    handleRetryRequest,
    handleOrchestratorCommand,
    handleServiceMessage,
    refreshServices,
    logsExpanded,
    logsGeneration,
    toggleLogs,
  } = useConsoleState();

  const [showAddService, setShowAddService] = useState(false);

  const historyCount = useMemo(() => {
    return allRequests.filter(r =>
      r.status === 'completed' || r.status === 'failed' || r.status === 'rejected'
    ).length;
  }, [allRequests]);

  // Requests page mode
  if (renderRequestsPage) {
    return (
      <RequestsPage
        requests={allRequests}
        services={services}
        onRetry={handleRetryRequest}
        onCancel={handleCancelRequest}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      {/* Top: Service cards */}
      <ServiceCards
        serviceList={serviceList}
        badges={badges}
        onAddService={() => setShowAddService(true)}
      />

      {/* Main: Split panes */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: Orchestrator (40%, min 300px) */}
        <div style={{
          width: '40%',
          minWidth: 300,
          borderRight: '1px solid #334155',
          display: 'flex',
          flexDirection: 'column',
        }}>
          <OrchestratorPane
            lines={orchestratorLines}
            executing={orchestratorExecuting}
            onSubmit={handleOrchestratorCommand}
            pendingPlan={pendingPlan}
            onPlanApprove={handlePlanApprove}
            onPlanCancel={handlePlanCancel}
            logsExpanded={logsExpanded}
            logsGeneration={logsGeneration}
            onToggleLogs={toggleLogs}
          />
        </div>

        {/* Right: Service console (60%) */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <ServicePane
            services={services}
            serviceBuffers={serviceBuffers}
            executing={serviceExecuting}
            onSendMessage={handleServiceMessage}
            logsExpanded={logsExpanded}
            logsGeneration={logsGeneration}
            onToggleLogs={toggleLogs}
            serviceRequests={serviceRequests}
            onCancelRequest={handleCancelRequest}
            onRetryRequest={handleRetryRequest}
            historyCount={historyCount}
            onViewHistory={onViewHistory ?? (() => {})}
          />
        </div>
      </div>

      {/* Modal: Add service */}
      {showAddService && (
        <AddServiceModal
          onClose={() => setShowAddService(false)}
          onAdded={() => { setShowAddService(false); refreshServices(); }}
        />
      )}
    </div>
  );
}
