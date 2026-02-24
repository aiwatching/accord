import React, { useState, useCallback } from 'react';

interface QuestionOption {
  label: string;
  description?: string;
}

interface QuestionItem {
  question: string;
  header?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

interface QuestionPanelProps {
  questions: unknown;
  onAnswer: (answers: Record<string, string>) => void;
}

/** Parse the AskUserQuestion input format into a structured list. */
function parseQuestions(raw: unknown): QuestionItem[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as Record<string, unknown>;
  const list = obj.questions;
  if (!Array.isArray(list)) return [];
  return list.map((q: Record<string, unknown>) => ({
    question: String(q.question ?? ''),
    header: q.header ? String(q.header) : undefined,
    options: Array.isArray(q.options)
      ? q.options.map((o: Record<string, unknown>) => ({
          label: String(o.label ?? ''),
          description: o.description ? String(o.description) : undefined,
        }))
      : [],
    multiSelect: q.multiSelect === true,
  }));
}

export function QuestionPanel({ questions, onAnswer }: QuestionPanelProps) {
  const items = parseQuestions(questions);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const handleSelect = useCallback((question: string, label: string) => {
    setSelected(prev => ({ ...prev, [question]: label }));
  }, []);

  const handleSubmit = useCallback(() => {
    onAnswer(selected);
  }, [selected, onAnswer]);

  const allAnswered = items.length > 0 && items.every(q => selected[q.question]);

  if (items.length === 0) {
    return (
      <div style={{
        padding: 16,
        background: '#1e293b',
        borderRadius: 6,
        margin: 8,
        color: '#94a3b8',
        fontSize: 12,
        fontFamily: 'monospace',
      }}>
        Orchestrator asked a question but the format could not be parsed.
        Please type your answer in the input below.
      </div>
    );
  }

  return (
    <div style={{
      padding: 16,
      background: '#1e293b',
      borderRadius: 6,
      margin: 8,
      fontFamily: 'monospace',
      maxHeight: '60%',
      overflow: 'auto',
    }}>
      <div style={{ color: '#60a5fa', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        Orchestrator needs your input
      </div>

      {items.map((q, qi) => (
        <div key={qi} style={{ marginBottom: 16 }}>
          {q.header && (
            <div style={{
              color: '#94a3b8',
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom: 4,
            }}>
              {q.header}
            </div>
          )}
          <div style={{ color: '#e2e8f0', fontSize: 12, marginBottom: 8 }}>
            {q.question}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {q.options.map((opt, oi) => {
              const isSelected = selected[q.question] === opt.label;
              return (
                <button
                  key={oi}
                  onClick={() => handleSelect(q.question, opt.label)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    padding: '8px 12px',
                    background: isSelected ? '#334155' : '#0f172a',
                    border: isSelected ? '1px solid #60a5fa' : '1px solid #334155',
                    borderRadius: 4,
                    cursor: 'pointer',
                    textAlign: 'left',
                    width: '100%',
                  }}
                >
                  <span style={{ color: isSelected ? '#60a5fa' : '#e2e8f0', fontSize: 12 }}>
                    {opt.label}
                  </span>
                  {opt.description && (
                    <span style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
                      {opt.description}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          style={{
            padding: '6px 16px',
            background: allAnswered ? '#2563eb' : '#334155',
            border: 'none',
            borderRadius: 4,
            color: allAnswered ? '#fff' : '#64748b',
            fontSize: 12,
            fontFamily: 'monospace',
            cursor: allAnswered ? 'pointer' : 'not-allowed',
          }}
        >
          Submit
        </button>
      </div>
    </div>
  );
}
