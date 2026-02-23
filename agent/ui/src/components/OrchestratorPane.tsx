import React from 'react';
import { ConsolePane } from './ConsolePane';
import { PlanReviewModal } from './PlanReviewModal';
import type { OutputLine } from './OutputRenderers';

interface OrchestratorPaneProps {
  lines: OutputLine[];
  executing: boolean;
  onSubmit: (text: string) => void;
  pendingPlan: string | null;
  onPlanApprove: (editedPlan?: string) => void;
  onPlanCancel: () => void;
  logsExpanded: boolean;
  logsGeneration: number;
  onToggleLogs: () => void;
}

export function OrchestratorPane({
  lines,
  executing,
  onSubmit,
  pendingPlan,
  onPlanApprove,
  onPlanCancel,
  logsExpanded,
  logsGeneration,
  onToggleLogs,
}: OrchestratorPaneProps) {
  return (
    <ConsolePane
      lines={lines}
      executing={executing}
      onSubmit={onSubmit}
      placeholder="Type a command or message..."
      autoFocus
      logsExpanded={logsExpanded}
      logsGeneration={logsGeneration}
      onToggleLogs={onToggleLogs}
      headerContent={
        <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>Orchestrator</span>
      }
      overlayContent={
        pendingPlan ? (
          <PlanReviewModal
            plan={pendingPlan}
            onApprove={onPlanApprove}
            onCancel={onPlanCancel}
          />
        ) : undefined
      }
    />
  );
}
