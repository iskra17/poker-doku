'use client';

import { useEffect, useRef, useState } from 'react';
import { onGameEvent } from '@/lib/events/game-events';
import { useGameStore } from '@/lib/store/game-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import { THROWABLE_MAP, THROWABLES } from '@/lib/throwables/catalog';
import { getLayout, toDisplayIndex, TablePos } from './table-layout';
import ThrowablePicker from './ThrowablePicker';

/**
 * 새총(드래그백) 투척 발사대.
 * 히어로 좌석 위 아이템 아이콘을 홀드 → 뒤로 당기면 당긴 반대 방향과 각도차가 가장 작은
 * 착석 좌석이 스냅 하이라이트되고, 놓으면 그 좌석으로 발사한다 (방향 스냅 자동명중).
 * 당김이 MIN_DRAG_PX 미만이면 취소 — 아이콘 근처로 되돌리면 자연 취소. 짧은 탭은 아이템 피커.
 *
 * 발사 연출은 서버 에코(throwable-thrown)로만 — 낙관적 실행 없음.
 * 내 턴 시작 시 조준을 강제 해제한다 (쇼케이스 모달의 my-turn 자동 닫힘과 같은 안전장치).
 */

// 히어로 좌석({50%,88%})과 히어로 베팅 칩({50%,71%}) 사이 밴드 — table-layout 인접 좌표 근거
const LAUNCHER_POS: TablePos = { x: '50%', y: '79%' };
const MIN_DRAG_PX = 28;
const TRAJECTORY_TS = [0.22, 0.4, 0.58, 0.76, 0.9] as const;

interface AimState {
  /** 컨테이너 기준 px — 당겨진 아이콘 위치 */
  pointerX: number;
  pointerY: number;
  /** 발사대 앵커의 px 좌표 (렌더에서 ref를 읽지 않도록 조준 시점에 스냅샷) */
  anchorX: number;
  anchorY: number;
  targetPlayerId: string | null;
  /** 스냅 대상 좌석의 디스플레이 % 좌표 (하이라이트 링) */
  targetPos: TablePos | null;
  /** 스냅 대상 좌석의 px 좌표 (궤적 점 보간) */
  targetX: number;
  targetY: number;
}

export default function ThrowLauncher() {
  const myPlayerId = useGameStore(s => s.myPlayerId);
  const gameState = useGameStore(s => s.gameState);
  const throwItem = useGameStore(s => s.throwItem);
  const throwablesEnabled = useSettingsStore(s => s.throwablesEnabled);
  const selectedThrowableId = useSettingsStore(s => s.selectedThrowableId);
  const setSelectedThrowable = useSettingsStore(s => s.setSelectedThrowable);

  const [aim, setAim] = useState<AimState | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0); // 초 단위 카운트다운

  const wrapperRef = useRef<HTMLDivElement>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  // aim 상태의 ref 미러 — 포인터 이벤트가 한 배치로 몰리면(React 배칭) pointerup이
  // 이전 렌더의 stale aim(null)을 읽어 발사가 유실된다. 판정은 항상 ref로.
  const aimRef = useRef<AimState | null>(null);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyAim = (next: AimState | null) => {
    aimRef.current = next;
    setAim(next);
  };

  // 내 턴 시작 시 조준/피커 강제 해제 — 8초 턴 타이머 중 시야 점유 방지
  useEffect(() => {
    const unsubscribe = onGameEvent(event => {
      if (event.type !== 'my-turn-start') return;
      dragStartRef.current = null;
      aimRef.current = null;
      setAim(null);
      setPickerOpen(false);
    });
    return () => {
      unsubscribe();
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  const startCooldown = (cooldownMs: number) => {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    setCooldownRemaining(Math.ceil(cooldownMs / 1000));
    cooldownTimerRef.current = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1 && cooldownTimerRef.current) {
          clearInterval(cooldownTimerRef.current);
          cooldownTimerRef.current = null;
        }
        return Math.max(0, prev - 1);
      });
    }, 1_000);
  };

  const myPlayer = gameState?.players.find(p => p.id === myPlayerId) ?? null;
  const mySeatIndex = myPlayer?.seatIndex ?? -1;
  const tournamentFinished = gameState?.tournament?.finished ?? false;
  // 관전 상태(파산 유예/SnG 탈락) 비노출 — 서버 throw-item 거절 계약과 동일 (GameRoomView busted)
  const busted = !!myPlayer && myPlayer.chips <= 0
    && !(gameState?.isHandInProgress && (myPlayer.status === 'active' || myPlayer.status === 'all-in'));

  const selectedDef = THROWABLE_MAP[selectedThrowableId] ?? THROWABLES[0];

  if (!myPlayer || busted || myPlayer.finishPlace || tournamentFinished || !throwablesEnabled) {
    return null;
  }

  /** 컨테이너 기준 px 좌표 변환 */
  const toContainerPx = (pos: TablePos, rect: DOMRect) => ({
    x: (parseFloat(pos.x) / 100) * rect.width,
    y: (parseFloat(pos.y) / 100) * rect.height,
  });

  const updateAim = (clientX: number, clientY: number) => {
    const rect = rectRef.current;
    const start = dragStartRef.current;
    if (!rect || !start) return;
    const curX = clientX - rect.left;
    const curY = clientY - rect.top;
    const dragDist = Math.hypot(curX - start.x, curY - start.y);
    if (dragDist < MIN_DRAG_PX) {
      applyAim(null); // 취소 존 — 되돌리면 조준 해제
      return;
    }

    const layout = getLayout();
    const anchor = toContainerPx(LAUNCHER_POS, rect);
    // 발사 방향 = 당긴 반대 방향
    const shotX = anchor.x - curX;
    const shotY = anchor.y - curY;
    const shotLen = Math.hypot(shotX, shotY) || 1;

    const state = useGameStore.getState().gameState;
    let best: { playerId: string; pos: TablePos; px: { x: number; y: number }; angle: number } | null = null;
    for (const p of state?.players ?? []) {
      if (p.id === myPlayerId) continue;
      if (p.throwablesOptOut) continue; // 참여를 끈 좌석은 조준 불가 (서버도 거부)
      const pos = layout.seats[toDisplayIndex(p.seatIndex, mySeatIndex)];
      if (!pos) continue;
      const seatPx = toContainerPx(pos, rect);
      const vx = seatPx.x - anchor.x;
      const vy = seatPx.y - anchor.y;
      const vLen = Math.hypot(vx, vy) || 1;
      const cos = (shotX * vx + shotY * vy) / (shotLen * vLen);
      const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      if (!best || angle < best.angle) best = { playerId: p.id, pos, px: seatPx, angle };
    }

    applyAim({
      pointerX: curX,
      pointerY: curY,
      anchorX: anchor.x,
      anchorY: anchor.y,
      targetPlayerId: best?.playerId ?? null,
      targetPos: best?.pos ?? null,
      targetX: best?.px.x ?? anchor.x,
      targetY: best?.px.y ?? anchor.y,
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    rectRef.current = wrapperRef.current?.getBoundingClientRect() ?? null;
    const rect = rectRef.current;
    if (!rect) return;
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    dragStartRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current || cooldownRemaining > 0) return;
    updateAim(e.clientX, e.clientY);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
    const start = dragStartRef.current;
    if (!start) return;
    // 판정은 stale 가능성이 있는 state가 아니라 ref로 (배칭 대비)
    const finalAim = aimRef.current;
    dragStartRef.current = null;
    applyAim(null);
    if (finalAim?.targetPlayerId) {
      throwItem(selectedDef.id, finalAim.targetPlayerId, startCooldown);
      return;
    }
    // 짧은 탭 (취소 존에서 놓은 경우 포함 판정) — 이동량이 작을 때만 피커 토글
    const rect = rectRef.current;
    const dist = rect
      ? Math.hypot(e.clientX - rect.left - start.x, e.clientY - rect.top - start.y)
      : 0;
    if (dist < MIN_DRAG_PX) setPickerOpen(open => !open);
  };

  const handlePointerCancel = () => {
    dragStartRef.current = null;
    applyAim(null);
  };

  const aiming = !!aim;

  return (
    <div ref={wrapperRef} className="pointer-events-none absolute inset-0 z-30">
      {/* 스냅 대상 좌석 하이라이트 링 */}
      {aim?.targetPos && (
        <div
          className="absolute h-20 w-20 animate-pulse rounded-full border-2 border-gilded shadow-[0_0_16px_rgba(212,175,55,0.5)]"
          style={{
            left: aim.targetPos.x,
            top: aim.targetPos.y,
            transform: 'translate(-50%, -50%)',
          }}
        />
      )}

      {/* 조준 궤적 점 — 발사대 → 스냅 대상 보간 */}
      {aim?.targetPos && TRAJECTORY_TS.map(t => (
        <div
          key={t}
          className="absolute h-1.5 w-1.5 rounded-full bg-white/70"
          style={{
            left: aim.anchorX + (aim.targetX - aim.anchorX) * t,
            top: aim.anchorY + (aim.targetY - aim.anchorY) * t,
            transform: 'translate(-50%, -50%)',
            opacity: 0.35 + t * 0.5,
          }}
        />
      ))}

      {/* 고무줄 — 발사대와 당겨진 아이콘을 잇는 선 */}
      {aim && (
        <svg className="absolute inset-0 h-full w-full">
          <line
            x1={aim.anchorX}
            y1={aim.anchorY}
            x2={aim.pointerX}
            y2={aim.pointerY}
            stroke="rgba(212,175,55,0.55)"
            strokeWidth="2.5"
            strokeDasharray="4 3"
          />
        </svg>
      )}

      {/* 발사대 아이콘 — 조준 중엔 포인터를 따라 끌려간다 */}
      <button
        aria-label={`${selectedDef.name} 던지기 — 홀드 후 뒤로 당겨서 발사`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        className={`pointer-events-auto absolute flex h-10 w-10 select-none items-center justify-center
          rounded-full border text-xl shadow-lg transition-colors
          ${cooldownRemaining > 0
            ? 'border-gray-600/40 bg-gray-800/80 grayscale'
            : aiming
              ? 'border-gilded bg-gray-900/90 scale-110'
              : 'border-purple-500/40 bg-gray-900/80 hover:border-gilded/70'}`}
        style={{
          left: aiming && aim ? aim.pointerX : undefined,
          top: aiming && aim ? aim.pointerY : undefined,
          ...(aiming ? {} : { left: LAUNCHER_POS.x, top: LAUNCHER_POS.y }),
          transform: 'translate(-50%, -50%)',
          touchAction: 'none',
        }}
      >
        {selectedDef.sprite ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={selectedDef.sprite}
            alt={selectedDef.name}
            draggable={false}
            className={`h-7 w-7 ${cooldownRemaining > 0 ? 'opacity-40' : ''}`}
          />
        ) : (
          <span className={cooldownRemaining > 0 ? 'opacity-40' : ''}>{selectedDef.emoji}</span>
        )}
        {cooldownRemaining > 0 && (
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-white">
            {cooldownRemaining}
          </span>
        )}
      </button>

      {/* 아이템 피커 — 발사대 위 */}
      {pickerOpen && (
        <div
          className="pointer-events-auto absolute w-52"
          style={{
            left: LAUNCHER_POS.x,
            top: LAUNCHER_POS.y,
            transform: 'translate(-50%, calc(-100% - 28px))',
          }}
        >
          <ThrowablePicker
            selectedId={selectedDef.id}
            onSelect={id => {
              setSelectedThrowable(id);
              setPickerOpen(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
