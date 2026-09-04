'use client';

import { useState } from 'react';
import CardComponent from '@/components/table/Card';
import VerticalSlider from '@/components/ui/VerticalSlider';
import { formatCard, sameCard } from '@/lib/poker/card-notation';
import { actionLabel, clampNumeric, numericUnitLabel, toggleCard, toggleIndex } from '@/lib/story/drill-input';
import type { DrillAnswer, DrillAnswerSpec, DrillAnswerSpecPublic } from '@/lib/story/drills/types';

interface DrillAnswerInputProps {
  spec: DrillAnswerSpecPublic | DrillAnswerSpec;
  value: DrillAnswer | null;
  onChange: (answer: DrillAnswer | null) => void;
  disabled?: boolean;
  /** 채점 후 정답/오답 강조용 — 선택지 인덱스 기준 */
  reveal?: { correctIndices?: number[]; chosenIndex?: number | null } | null;
}

const KEYPAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

/**
 * 드릴 입력 4종(+다중선택) — 선택지 그리드 / 숫자 키패드+슬라이더 / 카드 그리드 / 미니 액션 바.
 * 값은 상위(DrillCard·LessonPage)가 들고 있고, 여기선 그리기와 정규화만 한다.
 */
export default function DrillAnswerInput({ spec, value, onChange, disabled = false, reveal = null }: DrillAnswerInputProps) {
  switch (spec.kind) {
    case 'multiple-choice':
      return (
        <div className="grid gap-2" role="radiogroup" aria-label="보기">
          {spec.options.map((option, index) => {
            const chosen = value?.kind === 'multiple-choice' && value.index === index;
            const correct = reveal?.correctIndices?.includes(index);
            const wrongChosen = reveal && reveal.chosenIndex === index && !correct;
            return (
              <button
                key={index}
                type="button"
                role="radio"
                aria-checked={chosen}
                disabled={disabled}
                onClick={() => onChange({ kind: 'multiple-choice', index })}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  correct
                    ? 'border-cyber/70 bg-cyber/15 text-ink'
                    : wrongChosen
                      ? 'border-blossom/70 bg-blossom/15 text-ink'
                      : chosen
                        ? 'border-mystic bg-mystic/20 text-ink'
                        : 'border-mystic/25 bg-elevated/50 text-ink hover:border-mystic/50'
                } disabled:cursor-default`}
              >
                <span className="mr-2 text-[10px] font-bold text-ink-dim">{String.fromCharCode(65 + index)}</span>
                {option}
              </button>
            );
          })}
        </div>
      );

    case 'multi-select':
      return (
        <div className="grid gap-2" role="group" aria-label="복수 선택">
          {spec.options.map((option, index) => {
            const chosen = value?.kind === 'multi-select' && value.indices.includes(index);
            const correct = reveal?.correctIndices?.includes(index);
            return (
              <button
                key={index}
                type="button"
                role="checkbox"
                aria-checked={chosen}
                disabled={disabled}
                onClick={() => onChange({ kind: 'multi-select', indices: toggleIndex(value?.kind === 'multi-select' ? value.indices : [], index) })}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm ${
                  correct ? 'border-cyber/70 bg-cyber/15' : chosen ? 'border-mystic bg-mystic/20' : 'border-mystic/25 bg-elevated/50'
                }`}
              >
                <span className="mr-2">{chosen ? '☑' : '☐'}</span>{option}
              </button>
            );
          })}
        </div>
      );

    case 'numeric':
      return <NumericInput spec={spec} value={value?.kind === 'numeric' ? value.value : null} onChange={v => onChange(v === null ? null : { kind: 'numeric', value: v })} disabled={disabled} />;

    case 'card-pick': {
      const selected = value?.kind === 'card-pick' ? value.cards : [];
      return (
        <div>
          <p className="mb-1 text-[11px] text-ink-dim">{selected.length}/{spec.pickCount}장 선택</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="카드 선택">
            {spec.candidates.map(card => {
              const chosen = selected.some(candidate => sameCard(candidate, card));
              return (
                <button
                  key={formatCard(card)}
                  type="button"
                  aria-pressed={chosen}
                  disabled={disabled}
                  onClick={() => onChange({ kind: 'card-pick', cards: toggleCard(selected, card, spec.pickCount) })}
                  className={`rounded-lg p-0.5 transition ${chosen ? 'ring-2 ring-mystic' : 'opacity-80 hover:opacity-100'}`}
                >
                  <CardComponent card={card} size="sm" highlight={chosen} />
                </button>
              );
            })}
          </div>
        </div>
      );
    }

    case 'action-pick':
      return <ActionPickInput spec={spec} value={value?.kind === 'action-pick' ? value : null} onChange={onChange} disabled={disabled} />;
  }
}

function NumericInput({ spec, value, onChange, disabled }: {
  spec: { unit: string; min: number; max: number };
  value: number | null;
  onChange: (value: number | null) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  const commit = (next: string) => {
    setText(next);
    const parsed = Number(next);
    onChange(next === '' || Number.isNaN(parsed) ? null : clampNumeric(parsed, spec));
  };
  const integerOnly = spec.unit === 'outs' || spec.unit === 'combos';
  return (
    <div className="flex gap-3">
      <div className="flex-1">
        <div className="mb-2 flex items-baseline justify-between rounded-xl border border-mystic/30 bg-abyss/60 px-3 py-2">
          <span className="text-2xl font-black tabular-nums text-ink" aria-live="polite">{text === '' ? '—' : text}</span>
          <span className="text-xs text-ink-dim">{numericUnitLabel(spec.unit)}</span>
        </div>
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="숫자 키패드">
          {KEYPAD.map(key => (
            <button
              key={key}
              type="button"
              disabled={disabled || (key === '.' && (integerOnly || text.includes('.')))}
              onClick={() => {
                if (key === '⌫') commit(text.slice(0, -1));
                else if (text.replace('.', '').length >= 5) return;
                else commit(text + key);
              }}
              className="rounded-lg border border-mystic/25 bg-elevated/50 py-2 text-sm font-bold text-ink disabled:opacity-30"
            >
              {key}
            </button>
          ))}
        </div>
      </div>
      <div className="flex w-12 flex-col items-center" aria-label={`${numericUnitLabel(spec.unit)} 슬라이더`}>
        <VerticalSlider
          value={value ?? spec.min}
          min={spec.min}
          max={spec.max}
          step={1}
          height={168}
          onChange={next => commit(String(Math.round(next)))}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

function ActionPickInput({ spec, value, onChange, disabled }: {
  spec: { options: readonly string[]; sizingBB?: { min: number; max: number } };
  value: Extract<DrillAnswer, { kind: 'action-pick' }> | null;
  onChange: (answer: DrillAnswer | null) => void;
  disabled: boolean;
}) {
  const needsSizing = (action: string) => !!spec.sizingBB && (action === 'raise' || action === 'all-in');
  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="액션">
        {spec.options.map(option => {
          const action = option as Extract<DrillAnswer, { kind: 'action-pick' }>['action'];
          const chosen = value?.action === action;
          return (
            <button
              key={action}
              type="button"
              role="radio"
              aria-checked={chosen}
              disabled={disabled}
              onClick={() => onChange({
                kind: 'action-pick',
                action,
                ...(needsSizing(action) ? { sizingBB: value?.sizingBB ?? spec.sizingBB!.min } : {}),
              })}
              className={`rounded-xl border py-2.5 text-sm font-bold ${
                chosen
                  ? action === 'fold' ? 'border-blossom bg-blossom/20' : 'border-cyber bg-cyber/20'
                  : 'border-mystic/25 bg-elevated/50'
              }`}
            >
              {actionLabel(action)}
            </button>
          );
        })}
      </div>
      {value && needsSizing(value.action) && spec.sizingBB && (
        <label className="mt-2 flex items-center gap-2 text-xs text-ink-dim">
          <span>사이즈</span>
          <input
            type="range"
            min={Math.max(0, spec.sizingBB.min - 1)}
            max={spec.sizingBB.max + 2}
            step={0.5}
            value={value.sizingBB ?? spec.sizingBB.min}
            disabled={disabled}
            onChange={event => onChange({ kind: 'action-pick', action: value.action, sizingBB: Number(event.target.value) })}
            className="flex-1 accent-mystic"
            aria-label="레이즈 사이즈 (BB)"
          />
          <span className="w-12 text-right font-bold text-ink">{value.sizingBB ?? spec.sizingBB.min}BB</span>
        </label>
      )}
    </div>
  );
}
