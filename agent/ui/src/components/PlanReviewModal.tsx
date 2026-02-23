import React, { useState } from 'react';

interface PlanReviewModalProps {
  plan: string;
  onApprove: (editedPlan?: string) => void;
  onCancel: () => void;
}

export function PlanReviewModal({ plan, onApprove, onCancel }: PlanReviewModalProps) {
  const [editing, setEditing] = useState(false);
  const [editedText, setEditedText] = useState(plan);

  return (
    <div style={{
      position: 'absolute',
      bottom: 60,
      left: 16,
      right: 16,
      background: '#1e293b',
      border: '1px solid #475569',
      borderRadius: 8,
      padding: 16,
      zIndex: 10,
      maxHeight: '60%',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: 14, marginBottom: 8 }}>
        Review Execution Plan
      </div>
      <div style={{ flex: 1, overflow: 'auto', marginBottom: 12 }}>
        {editing ? (
          <textarea
            value={editedText}
            onChange={e => setEditedText(e.target.value)}
            style={{
              width: '100%',
              minHeight: 150,
              background: '#0f172a',
              color: '#cbd5e1',
              border: '1px solid #334155',
              borderRadius: 4,
              padding: 8,
              fontFamily: 'monospace',
              fontSize: 12,
              resize: 'vertical',
              outline: 'none',
            }}
          />
        ) : (
          <pre style={{
            color: '#cbd5e1',
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0,
            padding: 8,
            background: '#0f172a',
            borderRadius: 4,
          }}>
            {plan}
          </pre>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={onCancel}
          style={{
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => setEditing(!editing)}
          style={{
            background: 'transparent',
            color: '#94a3b8',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          {editing ? 'Preview' : 'Edit'}
        </button>
        <button
          onClick={() => onApprove(editing ? editedText : undefined)}
          style={{
            background: '#22c55e',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            padding: '6px 14px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Approve
        </button>
      </div>
    </div>
  );
}
