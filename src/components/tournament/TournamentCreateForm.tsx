'use client';

import { useMemo, useState } from 'react';
import { MTT_WALLET_BUY_IN, MTT_WALLET_ENTRY_FEE } from '@/lib/economy/mtt-entry';
import { MTT_STRUCTURES, type MttSpeed } from '@/lib/poker/mtt-structure';
import { CURRENT_PAYOUT_TABLE_VERSION } from '@/lib/poker/payout-table';
import type { CreatePersistentTournamentRequest } from '@/lib/realtime/protocol';
import type {
  TournamentPayoutPolicy,
  TournamentRecurrence,
  TournamentStructure,
  TournamentStructureSegment,
} from '@/lib/tournament/tournament-config';
import Button from '@/components/ui/Button';
import {
  TOURNAMENT_FIELD_LIMITS,
  fieldPolicyError,
  isFixedSizeField,
  kstDateTimeLabel,
  kstInputValue,
  leadTimeExample,
  normalizeFieldPolicy,
  recurrenceEndError,
  recurrenceSummary,
  type FieldBoundMode,
} from './tournament-create-policy';

const MINUTE = 60_000;
const STAGES = [
  '기본 정보',
  '일정과 반복',
  '필드와 봇',
  '게임 속도와 커스텀 구조',
  '상금',
  '레이트 레지',
  '최종 검토',
] as const;

const SPEED_LABELS: Record<MttSpeed, string> = {
  standard: '스탠다드',
  turbo: '터보',
  hyper: '하이퍼',
};

// 신규 개설은 항상 v3 — 2~5인 소필드에서 준우승이 빈손이 되지 않는다.
// 이미 정산된 토너먼트는 각자의 config에 얼어 있는 버전을 그대로 쓴다.
const PAYOUTS: TournamentPayoutPolicy[] = [
  {
    tableVersion: CURRENT_PAYOUT_TABLE_VERSION,
    presetId: 'top-heavy',
    paidFieldPercent: 10,
  },
  {
    tableVersion: CURRENT_PAYOUT_TABLE_VERSION,
    presetId: 'standard',
    paidFieldPercent: 15,
  },
  {
    tableVersion: CURRENT_PAYOUT_TABLE_VERSION,
    presetId: 'flat',
    paidFieldPercent: 20,
  },
];
export type TournamentCreateDraft = CreatePersistentTournamentRequest;

interface TournamentCreateFormProps {
  serverNow: number;
  onCancel: () => void;
  onSubmit: (draft: TournamentCreateDraft) => Promise<boolean>;
  submitLabel?: string;
  promotionAvailableBalance?: number | null;
  allowRecurrence?: boolean;
}

const toLocalInput = kstInputValue;

function parseKstInput(value: string): number {
  return Date.parse(`${value}:00+09:00`);
}

/** 입력 도중의 미완성 값(NaN)에도 던지지 않는다 — 폼 언마운트 방지 */
const formatKst = kstDateTimeLabel;

function materializeStructure(
  speed: MttSpeed,
  custom: boolean,
  startingStack: number,
  levelMinutes: number,
): TournamentStructure {
  const preset = MTT_STRUCTURES[speed];
  const segments: TournamentStructureSegment[] = [];
  for (const [index, level] of preset.levels.entries()) {
    segments.push({
      kind: 'level',
      durationMs: (custom ? levelMinutes : preset.levelDurationMs / MINUTE) * MINUTE,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
      bigBlindAnte: level.ante,
    });
    if (
      preset.breakEveryLevels > 0 &&
      (index + 1) % preset.breakEveryLevels === 0 &&
      index < preset.levels.length - 1
    ) {
      segments.push({ kind: 'break', durationMs: preset.breakDurationMs });
    }
  }
  return {
    sourcePresetId: custom ? null : speed,
    startingStack: custom ? startingStack : preset.startingStack,
    segments,
  };
}

export default function TournamentCreateForm({
  serverNow,
  onCancel,
  onSubmit,
  submitLabel = '토너먼트 개설',
  promotionAvailableBalance = null,
  allowRecurrence = true,
}: TournamentCreateFormProps) {
  const [stage, setStage] = useState(0);
  const [name, setName] = useState('정기 프리롤');
  const [economyMode, setEconomyMode] = useState<'freeroll' | 'wallet'>('freeroll');
  const [automatic, setAutomatic] = useState(true);
  const [startInput, setStartInput] = useState(() => toLocalInput(serverNow + 60 * MINUTE));
  const [visibleLeadMinutes, setVisibleLeadMinutes] = useState(30);
  const [registrationLeadMinutes, setRegistrationLeadMinutes] = useState(20);
  const [manualWindowMinutes, setManualWindowMinutes] = useState(20);
  const [recurrenceKind, setRecurrenceKind] = useState<'none' | 'hourly' | 'daily' | 'weekly'>('none');
  const [recurrenceEndInput, setRecurrenceEndInput] = useState(
    () => toLocalInput(serverNow + 8 * 24 * 60 * MINUTE),
  );
  const [minimumMode, setMinimumMode] = useState<FieldBoundMode>('custom');
  const [minimumValue, setMinimumValue] = useState<number>(
    TOURNAMENT_FIELD_LIMITS.defaultMinimum,
  );
  const [maximumMode, setMaximumMode] = useState<FieldBoundMode>('unlimited');
  const [maximumValue, setMaximumValue] = useState<number>(
    TOURNAMENT_FIELD_LIMITS.serviceMaximum,
  );
  const [botFill, setBotFill] = useState(true);
  const [speed, setSpeed] = useState<MttSpeed>('standard');
  const [customStructure, setCustomStructure] = useState(false);
  const [startingStack, setStartingStack] = useState(10_000);
  const [levelMinutes, setLevelMinutes] = useState(8);
  const [turnTime, setTurnTime] = useState<8 | 15 | 30>(15);
  const [payout, setPayout] = useState<TournamentPayoutPolicy>(PAYOUTS[1]);
  const [totalPrize, setTotalPrize] = useState(180_000);
  // 기본값 '사용 안 함' — 지각 등록은 아직 착석까지 가지 않고 마감 시 취소·환불된다.
  // 운영자가 그 동작을 알고 의식적으로 켤 때만 쓰이게 한다.
  const [lateLevels, setLateLevels] = useState<0 | 1 | 2 | 3>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startsAt = parseKstInput(startInput);
  const schedule = useMemo(() => {
    if (!automatic) {
      return {
        visibleAt: serverNow,
        registrationOpensAt: serverNow,
        startsAt: null,
        manualStartExpiresAt: serverNow + manualWindowMinutes * MINUTE,
      };
    }
    return {
      visibleAt: startsAt - visibleLeadMinutes * MINUTE,
      registrationOpensAt: startsAt - registrationLeadMinutes * MINUTE,
      startsAt,
      manualStartExpiresAt: null,
    };
  }, [
    automatic,
    manualWindowMinutes,
    registrationLeadMinutes,
    serverNow,
    startsAt,
    visibleLeadMinutes,
  ]);

  const recurrence = useMemo<TournamentRecurrence | null>(() => {
    if (!automatic || recurrenceKind === 'none') return null;
    const date = new Date(startsAt + 9 * 60 * MINUTE);
    if (recurrenceKind === 'hourly') {
      return { kind: 'hourly', minute: date.getUTCMinutes() };
    }
    if (recurrenceKind === 'daily') {
      return {
        kind: 'daily',
        hour: date.getUTCHours(),
        minute: date.getUTCMinutes(),
      };
    }
    return {
      kind: 'weekly',
      weekday: date.getUTCDay() as 0 | 1 | 2 | 3 | 4 | 5 | 6,
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
    };
  }, [automatic, recurrenceKind, startsAt]);

  const structure = useMemo(
    () => materializeStructure(speed, customStructure, startingStack, levelMinutes),
    [customStructure, levelMinutes, speed, startingStack],
  );
  const recurrenceEndsAt = recurrence
    ? parseKstInput(recurrenceEndInput)
    : null;
  const summary = useMemo(
    () => recurrenceSummary({
      recurrence,
      firstStartsAt: startsAt,
      recurrenceEndsAt,
    }),
    [recurrence, recurrenceEndsAt, startsAt],
  );
  const fieldInput = useMemo(
    () => ({ minimumMode, minimumValue, maximumMode, maximumValue }),
    [maximumMode, maximumValue, minimumMode, minimumValue],
  );
  const field = useMemo(
    () => normalizeFieldPolicy(fieldInput),
    [fieldInput],
  );
  const fixedSize = isFixedSizeField(field);
  const leadExample = useMemo(
    () => leadTimeExample(
      Date.parse('2026-01-01T20:00:00+09:00'),
      60 * MINUTE,
      20 * MINUTE,
    ),
    [],
  );

  const draft = (): TournamentCreateDraft => ({
    requestId: crypto.randomUUID(),
    name: name.trim(),
    economyMode,
    minEntrants: field.minEntrants,
    maxEntrants: field.maxEntrants,
    botFillToMinimum: economyMode === 'freeroll' && botFill,
    prizePool: economyMode === 'freeroll'
      ? { kind: 'promotion-funded', totalPrize }
      : { kind: 'entry-pool' },
    schedule,
    recurrence,
    firstStartsAt: recurrence ? startsAt : null,
    recurrenceEndsAt: recurrence ? recurrenceEndsAt : null,
    visibleLeadMs: recurrence ? visibleLeadMinutes * MINUTE : null,
    registrationLeadMs: recurrence ? registrationLeadMinutes * MINUTE : null,
    turnTimeSeconds: turnTime,
    structure,
    payout,
    lateRegistration: lateLevels === 0
      ? { enabled: false, durationLevels: 0, minStartingStackBb: 20 }
      : { enabled: true, durationLevels: lateLevels, minStartingStackBb: 20 },
  });

  const submit = async () => {
    if (busy) return;
    if (!name.trim()) {
      setError('토너먼트 이름을 입력해 주세요.');
      return;
    }
    if (automatic && (!Number.isFinite(startsAt) || startsAt <= serverNow)) {
      setError('시작 시각은 서버 현재 시각보다 뒤여야 합니다.');
      return;
    }
    if (visibleLeadMinutes < registrationLeadMinutes) {
      setError('로비 노출은 등록 시작보다 빠르거나 같아야 합니다.');
      return;
    }
    const fieldError = fieldPolicyError(fieldInput);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    const endError = recurrenceEndError(recurrence, startsAt, recurrenceEndsAt);
    if (endError) {
      setError(endError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ok = await onSubmit(draft());
      if (!ok) {
        setError('개설하지 못했습니다. 입력과 운영 자금 잔액을 확인해 주세요.');
      }
    } catch {
      setError('서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-3 rounded-lg border border-cyber/25 bg-cyber/5 px-3 py-2 text-xs text-ink">
        서버 현재 시각(KST) · {formatKst(serverNow)}
      </div>
      <ol className="mb-4 grid grid-cols-7 gap-1" aria-label="개설 단계">
        {STAGES.map((label, index) => (
          <li key={label}>
            <button
              type="button"
              onClick={() => setStage(index)}
              className={`w-full rounded-md border px-1 py-1.5 text-[9px] ${
                index === stage
                  ? 'border-blossom/60 bg-blossom/15 text-ink'
                  : 'border-mystic/20 text-ink-dim'
              }`}
            >
              <span className="block font-bold">{index + 1}</span>
              <span className="hidden md:block">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="max-h-[58vh] min-h-72 overflow-y-auto pr-1 scrollbar-thin">
        <h3 className="mb-3 text-sm font-bold text-ink">
          {stage + 1}. {STAGES[stage]}
        </h3>

        {stage === 0 && (
          <div className="space-y-3">
            <Field label="토너먼트 이름">
              <input value={name} onChange={event => setName(event.target.value.slice(0, 30))} className="form-input" />
            </Field>
            <ChoiceGrid>
              <Choice active={economyMode === 'freeroll'} onClick={() => setEconomyMode('freeroll')}>
                프리롤<span>바이인 없음</span>
              </Choice>
              <Choice active={economyMode === 'wallet'} onClick={() => setEconomyMode('wallet')}>
                유료 토너먼트<span>바이인 {MTT_WALLET_BUY_IN.toLocaleString()} + 수수료 {MTT_WALLET_ENTRY_FEE}</span>
              </Choice>
            </ChoiceGrid>
          </div>
        )}

        {stage === 1 && (
          <div className="space-y-3">
            <ChoiceGrid>
              <Choice active={automatic} onClick={() => setAutomatic(true)}>자동 시작</Choice>
              <Choice active={!automatic} onClick={() => setAutomatic(false)}>수동 시작</Choice>
            </ChoiceGrid>
            {automatic ? (
              <>
                <Field label="시작 일시">
                  <input type="datetime-local" value={startInput} onChange={event => setStartInput(event.target.value)} className="form-input" />
                </Field>
                {!Number.isFinite(startsAt) && (
                  <p className="text-[11px] leading-5 text-blossom">
                    시작 일시를 끝까지 입력해 주세요. 완성되기 전에는 아래 시각이
                    계산되지 않습니다.
                  </p>
                )}
                <NumberField
                  label="로비 노출 리드(분)"
                  help="예정 시작 몇 분 전부터 로비에 토너먼트 카드가 보이기 시작할지."
                  value={visibleLeadMinutes}
                  min={1}
                  max={10_080}
                  onChange={setVisibleLeadMinutes}
                />
                <NumberField
                  label="등록 시작 리드(분)"
                  help="예정 시작 몇 분 전부터 참가 등록을 받을지. 로비 노출보다 늦거나 같아야 합니다."
                  value={registrationLeadMinutes}
                  min={1}
                  max={10_080}
                  onChange={setRegistrationLeadMinutes}
                />
                <p className="rounded-lg border border-cyber/25 bg-cyber/5 p-2 text-[11px] leading-5 text-ink-dim">
                  예시(KST) · {leadExample.sentence}
                </p>
                <p className="rounded-lg bg-panel/70 p-2 text-xs leading-5 text-ink-dim">
                  {formatKst(schedule.startsAt!)} 시작 · {formatKst(schedule.visibleAt)} 로비 노출 · {formatKst(schedule.registrationOpensAt)} 등록 시작
                </p>
                <Field label="반복">
                  <select
                    value={recurrenceKind}
                    disabled={!allowRecurrence}
                    onChange={event => setRecurrenceKind(event.target.value as typeof recurrenceKind)}
                    className="form-input"
                  >
                    <option value="none">반복 없음</option>
                    {allowRecurrence && <option value="hourly">매시간</option>}
                    {allowRecurrence && <option value="daily">매일</option>}
                    {allowRecurrence && <option value="weekly">매주</option>}
                  </select>
                </Field>
                {!allowRecurrence && (
                  <p className="text-[10px] text-ink-dim">
                    반복 템플릿은 운영 백오피스에서 개설할 수 있습니다.
                  </p>
                )}
                {recurrence && (
                  <>
                    <Field label="반복 마감 (마지막 회차, 포함)">
                      <input
                        type="datetime-local"
                        required
                        value={recurrenceEndInput}
                        onChange={event => setRecurrenceEndInput(event.target.value)}
                        className="form-input"
                      />
                    </Field>
                    {summary && summary.totalOccurrences > 0 ? (
                      <div className="rounded-lg bg-panel/70 p-2 text-[11px] leading-5 text-ink-dim">
                        <p>
                          총 {summary.totalOccurrences}회 · 마지막 회차{' '}
                          {summary.lastStartsAt !== null
                            ? formatKst(summary.lastStartsAt)
                            : '-'}
                        </p>
                        <p>
                          처음 {summary.previewStarts.length}회 ·{' '}
                          {summary.previewStarts.map(formatKst).join(' · ')}
                        </p>
                        <p>
                          로비에는 한 번에 최대 {summary.materializedLimit}회차까지만
                          만들어지고 노출됩니다. 앞 회차가 끝나면 다음 회차가 채워집니다.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[11px] leading-5 text-blossom">
                        {recurrenceEndError(recurrence, startsAt, recurrenceEndsAt)
                          ?? '이 구간에는 회차가 하나도 없습니다. 마감 시각을 확인해 주세요.'}
                      </p>
                    )}
                  </>
                )}
              </>
            ) : (
              <>
                <NumberField label="수동 시작 등록 창(분)" value={manualWindowMinutes} min={1} max={economyMode === 'wallet' ? 20 : 360} onChange={setManualWindowMinutes} />
                <p className="text-xs text-ink-dim">등록은 즉시 열리고 {formatKst(schedule.manualStartExpiresAt!)}에 자동 취소됩니다.</p>
              </>
            )}
          </div>
        )}

        {stage === 2 && (
          <div className="space-y-3">
            <BoundField
              label="최소 인원"
              unlimitedLabel={
                `제한 없음(${TOURNAMENT_FIELD_LIMITS.unlimitedMinimum}명부터 개시)`
              }
              mode={minimumMode}
              value={minimumValue}
              onModeChange={setMinimumMode}
              onValueChange={setMinimumValue}
            />
            <BoundField
              label="최대 인원"
              unlimitedLabel={
                `제한 없음(현재 서비스 상한 ${TOURNAMENT_FIELD_LIMITS.serviceMaximum}명)`
              }
              mode={maximumMode}
              value={maximumValue}
              onModeChange={setMaximumMode}
              onValueChange={setMaximumValue}
            />
            <p className="rounded-lg bg-panel/70 p-2 text-[11px] leading-5 text-ink-dim">
              저장되는 값 · 최소 {field.minEntrants}명 / 최대 {field.maxEntrants}명
              {fixedSize && ' · 최소와 최대가 같아 정원 고정 토너먼트입니다.'}
              <br />
              예약 토너먼트는 최소 인원을 채워도 일찍 시작하지 않고 예정 시각에 시작합니다.
            </p>
            {economyMode === 'freeroll' ? (
              <>
                <label className="flex items-center gap-2 rounded-lg border border-mystic/20 p-3 text-xs text-ink">
                  <input type="checkbox" checked={botFill} onChange={event => setBotFill(event.target.checked)} />
                  최소 인원까지 봇 충원
                </label>
                <p className="rounded-lg border border-cyber/25 bg-cyber/5 p-2 text-[11px] leading-5 text-ink-dim">
                  프리롤의 최소 인원은 사람과 충원 봇을 합친 전체 필드 기준입니다.
                  다만 사람이 한 명도 없으면 시작하지 않습니다.
                </p>
              </>
            ) : (
              <p className="rounded-lg border border-gilded/25 bg-gilded/5 p-3 text-xs leading-5 text-ink">
                유료 토너먼트는 사람만 참가합니다(봇은 바이인을 낼 수 없습니다).
                <br />최소 인원 미달 시 자동 취소 및 전액 환불
              </p>
            )}
          </div>
        )}

        {stage === 3 && (
          <div className="space-y-3">
            <ChoiceGrid>
              {(Object.keys(SPEED_LABELS) as MttSpeed[]).map(value => (
                <Choice key={value} active={speed === value} onClick={() => setSpeed(value)}>
                  {SPEED_LABELS[value]}<span>{Math.round(MTT_STRUCTURES[value].levelDurationMs / MINUTE)}분 레벨</span>
                </Choice>
              ))}
            </ChoiceGrid>
            <ChoiceGrid>
              {([8, 15, 30] as const).map(value => (
                <Choice key={value} active={turnTime === value} onClick={() => setTurnTime(value)}>{value}초 액션</Choice>
              ))}
            </ChoiceGrid>
            <label className="flex items-center gap-2 text-xs text-ink">
              <input type="checkbox" checked={customStructure} onChange={event => setCustomStructure(event.target.checked)} />
              커스텀 구조 사용
            </label>
            {customStructure && (
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="시작 스택" value={startingStack} min={1_000} max={1_000_000} onChange={setStartingStack} />
                <NumberField label="레벨 시간(분)" value={levelMinutes} min={1} max={60} onChange={setLevelMinutes} />
              </div>
            )}
          </div>
        )}

        {stage === 4 && (
          <div className="space-y-3">
            {economyMode === 'freeroll' ? (
              <>
                <NumberField label="보장 총상금" value={totalPrize} min={1} max={2_000_000_000} onChange={setTotalPrize} />
                <p className="rounded-lg border border-gilded/25 bg-gilded/5 p-3 text-xs leading-5 text-ink">
                  운영 기금에서 총상금을 예약합니다.
                  {promotionAvailableBalance !== null && (
                    <> 사용 가능 {promotionAvailableBalance.toLocaleString()}</>
                  )}
                  <br />봇 입상 상금은 운영 기금으로 반환됩니다
                </p>
              </>
            ) : (
              <p className="rounded-lg border border-mystic/20 p-3 text-xs leading-5 text-ink">
                바이인 {MTT_WALLET_BUY_IN.toLocaleString()} + 수수료 {MTT_WALLET_ENTRY_FEE.toLocaleString()}<br />
                사람만 참가 · 최소 인원 미달 시 자동 취소 및 전액 환불
              </p>
            )}
            <ChoiceGrid>
              {PAYOUTS.map(value => (
                <Choice key={value.presetId} active={payout.presetId === value.presetId} onClick={() => setPayout(value)}>
                  {value.presetId === 'top-heavy' ? '상위 집중형' : value.presetId === 'flat' ? '플랫형' : '표준형'}
                  <span>약 {value.paidFieldPercent}% 입상</span>
                </Choice>
              ))}
            </ChoiceGrid>
          </div>
        )}

        {stage === 5 && (
          <div className="space-y-3">
            <ChoiceGrid>
              {([0, 1, 2, 3] as const).map(value => (
                <Choice key={value} active={lateLevels === value} onClick={() => setLateLevels(value)}>
                  {value === 0 ? '사용 안 함' : `${value}레벨까지`}
                </Choice>
              ))}
            </ChoiceGrid>
            <p className="rounded-lg bg-panel/70 p-3 text-xs leading-5 text-ink-dim">
              시작 스택이 현재 블라인드 기준 20BB 미만이 되거나 버블·파이널 테이블에 도달하면 조기 마감됩니다.
            </p>
          </div>
        )}

        {stage === 6 && (
          <div className="space-y-2 rounded-xl border border-mystic/25 bg-panel/60 p-3 text-xs leading-5 text-ink">
            <p>{automatic ? `${formatKst(schedule.startsAt!)} 시작 · ${formatKst(schedule.visibleAt)} 로비 노출 · ${formatKst(schedule.registrationOpensAt)} 등록 시작` : `수동 시작 · ${formatKst(schedule.manualStartExpiresAt!)} 자동 취소`}</p>
            <p>최소 {field.minEntrants}명 / 최대 {field.maxEntrants}명{fixedSize && ' (정원 고정)'} · {economyMode === 'freeroll' ? '프리롤' : '유료 토너먼트'} · {economyMode === 'freeroll' && botFill ? '최소 인원까지 봇 충원' : '사람만 참가'}</p>
            <p>{SPEED_LABELS[speed]} {Math.round(structure.segments.find(segment => segment.kind === 'level')?.durationMs ?? 0) / MINUTE}분 · {turnTime}초 액션 · {payout.presetId === 'standard' ? '표준형' : payout.presetId === 'flat' ? '플랫형' : '상위 집중형'} 약 {payout.paidFieldPercent}% 입상</p>
            <p>{economyMode === 'freeroll' ? `총상금 ${totalPrize.toLocaleString()} 프리롤 상금 · 운영 자금 예약` : `바이인 ${MTT_WALLET_BUY_IN.toLocaleString()} + 수수료 ${MTT_WALLET_ENTRY_FEE}`} · 레이트 레지 {lateLevels === 0 ? '없음' : `${lateLevels}레벨`}</p>
            <p>{recurrence && summary ? `${recurrence.kind === 'hourly' ? '매시간' : recurrence.kind === 'daily' ? '매일' : '매주'} 반복 · 총 ${summary.totalOccurrences}회 · 마지막 회차 ${summary.lastStartsAt !== null ? formatKst(summary.lastStartsAt) : '-'} · 동시 노출 최대 ${summary.materializedLimit}회차` : '반복 없음'}</p>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-blossom">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" size="sm" onClick={stage === 0 ? onCancel : () => setStage(value => value - 1)} className="flex-1">
          {stage === 0 ? '취소' : '이전'}
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={stage === STAGES.length - 1 ? () => void submit() : () => setStage(value => value + 1)}
          className="flex-1"
        >
          {stage === STAGES.length - 1 ? (busy ? '개설 중…' : submitLabel) : '다음'}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block text-xs text-ink-dim">{label}<span className="mt-1 block">{children}</span></label>;
}

function NumberField({ label, value, min, max, onChange, help }: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  help?: string;
}) {
  return (
    <div>
      <span className="flex items-center gap-1 text-xs text-ink-dim">
        {label}
        {help && <HelpHint label={label} text={help} />}
      </span>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        value={value}
        onChange={event => onChange(Number(event.target.value))}
        className="form-input mt-1"
      />
    </div>
  );
}

/**
 * 키보드·터치에서도 열리는 도움말. title 속성만 쓰면 호버 전용이라
 * 모바일과 키보드 사용자가 설명을 볼 방법이 없다.
 */
function HelpHint({ label, text }: { label: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`${label} 설명`}
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-cyber/40 text-[9px] font-bold text-cyber"
      >
        ?
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-5 top-0 z-10 w-56 rounded-lg border border-cyber/30 bg-panel p-2 text-[10px] leading-4 text-ink shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}

function BoundField({
  label,
  unlimitedLabel,
  mode,
  value,
  onModeChange,
  onValueChange,
}: {
  label: string;
  unlimitedLabel: string;
  mode: FieldBoundMode;
  value: number;
  onModeChange: (mode: FieldBoundMode) => void;
  onValueChange: (value: number) => void;
}) {
  return (
    <div className="rounded-lg border border-mystic/20 p-2">
      <span className="block text-xs text-ink-dim">{label}</span>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <Choice active={mode === 'unlimited'} onClick={() => onModeChange('unlimited')}>
          {unlimitedLabel}
        </Choice>
        <Choice active={mode === 'custom'} onClick={() => onModeChange('custom')}>
          직접 설정
        </Choice>
      </div>
      {mode === 'custom' && (
        <input
          type="number"
          aria-label={`${label} 직접 설정`}
          min={TOURNAMENT_FIELD_LIMITS.unlimitedMinimum}
          max={TOURNAMENT_FIELD_LIMITS.serviceMaximum}
          value={value}
          onChange={event => onValueChange(Number(event.target.value))}
          className="form-input mt-2"
        />
      )}
    </div>
  );
}

function ChoiceGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{children}</div>;
}

function Choice({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-lg border p-2 text-xs font-bold ${
        active
          ? 'border-blossom/60 bg-blossom/15 text-ink'
          : 'border-mystic/20 bg-panel/60 text-ink-dim'
      }`}
    >
      {children}
    </button>
  );
}
