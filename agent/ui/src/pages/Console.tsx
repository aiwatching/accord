import React, { useState } from 'react';
import { useConsoleState } from '../hooks/useConsoleState';
import { ServiceCards } from '../components/ServiceCards';
import { OrchestratorPane } from '../components/OrchestratorPane';
import { ServicePane } from '../components/ServicePane';
import { AddServiceModal } from '../components/AddServiceModal';

export function Console() {
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
    handleOrchestratorCommand,
    handleServiceMessage,
    refreshServices,
    logsExpanded,
    logsGeneration,
    toggleLogs,
  } = useConsoleState();

  const [showAddService, setShowAddService] = useState(false);

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
