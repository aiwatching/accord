import React from 'react';
import { ConsolePane } from './ConsolePane';
import { PlanReviewModal } from './PlanReviewModal';
import { QuestionPanel } from './QuestionPanel';
import type { OutputLine } from './OutputRenderers';

interface OrchestratorPaneProps {
  lines: OutputLine[];
  executing: boolean;
  onSubmit: (text: string) => void;
  pendingPlan: string | null;
  onPlanApprove: (editedPlan?: string) => void;
  onPlanCancel: () => void;
  pendingQuestions: unknown | null;
  onAnswerQuestion: (answers: Record<string, string>) => void;
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
  pendingQuestions,
  onAnswerQuestion,
  logsExpanded,
  logsGeneration,
  onToggleLogs,
}: OrchestratorPaneProps) {
  const overlay = pendingPlan ? (
    <PlanReviewModal
      plan={pendingPlan}
      onApprove={onPlanApprove}
      onCancel={onPlanCancel}
    />
  ) : pendingQuestions ? (
    <QuestionPanel
      questions={pendingQuestions}
      onAnswer={onAnswerQuestion}
    />
  ) : undefined;

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
      overlayContent={overlay}
    />
  );
}
