'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { onGameEvent } from '@/lib/events/game-events';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useGameStore } from '@/lib/store/game-store';
import { useStoryStore } from '@/lib/store/story-store';
import {
  firstMyTurnInterrupt,
  liveFinishHint,
  objectiveHudLines,
  pendingInterrupt,
  practicePrompt,
} from '@/lib/story/story-live-rules';
import { liveMissionCutIn, type StoryCutInData } from '@/lib/story/story-cut-ins';
import StoryCutIn from './StoryCutIn';
import DecisionReviewSheet from './live/DecisionReviewSheet';
import InterruptScene from './live/InterruptScene';
import LiveHoldPanel from './live/LiveHoldPanel';
import ObjectiveHud from './live/ObjectiveHud';
import PracticePromptBanner from './live/PracticePromptBanner';
import { useStoryLive } from './live/use-story-live';

/**
 * 인룸 스토리 오버레이 — 라이브 스텝('연습' 프리셋 / '대결' 스파링) 동안 테이블 위에 얹힌다.
 * GameRoomView의 중앙 컨테이너(max-w-[1100px], `relative isolate`) 안에서만 렌더하므로
 * 좌표는 전부 그 컨테이너 기준이고, TopBar/ActionBar 같은 바깥 크롬은 덮지 않는다.
 *
 * 담당:
 * - '연습'/'대결' 배지 + 진행 핸드 수 + 행동 목표 HUD (ObjectiveHud)
 * - '연습' 스텝 안내 배너 (스텝당 1회, 닫기 가능)
 * - 서버 hold 해제 UI: 'timeout'은 [계속하기] 카드, 'scene'은 인터럽트 씬 재생 후 resume
 * - 서버가 hold하지 않는 `first-my-turn` 인터럽트는 클라가 첫 내 턴에 직접 1회 재생 (resume 없음)
 * - 핸드 후 결정 리뷰 하단 시트
 *
 * hold 'room-lost'는 방이 이미 사라진 상태(roomId null)라 이 컴포넌트가 아니라
 * 로비의 StoryStage가 [이어하기]를 그린다.
 */
export default function StoryOverlay() {
  const { active, run, live, step, stepKey } = useStoryLive();
  const pending = useStoryStore(state => state.pending);
  const resumeLive = useStoryStore(state => state.resumeLive);
  const gameState = useGameStore(state => state.gameState);
  const myPlayerId = useGameStore(state => state.myPlayerId);

  // 핸드 종료 시각 — 인터럽트가 승자 컷인을 덮지 않도록 5.5초 유예의 기준점.
  // 외부 시스템(이벤트 버스) 콜백이라 ref 갱신만 하고 렌더는 유발하지 않는다.
  const handEndAtRef = useRef<number | null>(null);
  useEffect(() => onGameEvent(event => {
    if (event.type === 'hand-end') handEndAtRef.current = Date.now();
    else if (event.type === 'hand-start') handEndAtRef.current = null;
  }), []);
  const lastHandEndAt = useCallback(() => handEndAtRef.current, []);

  const [promptDismissed, setPromptDismissed] = useState<string | null>(null);
  // null = 기기 기본값 (모바일은 접힘) — 사용자가 토글하면 그 의도를 고정 (ActionLog와 같은 패턴)
  const [hudUserExpanded, setHudUserExpanded] = useState<boolean | null>(null);
  const [firstTurnPlayedFor, setFirstTurnPlayedFor] = useState<string | null>(null);
  const [firstTurnOpen, setFirstTurnOpen] = useState(false);
  const [sceneDoneFor, setSceneDoneFor] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const hudExpanded = hudUserExpanded ?? !isMobile;

  // 미션 클리어/보스 격파 컷인 — 스텝당 1회, 마지막 핸드의 승자 컷인(1.6초)과 같은 타이밍에 우측에서
  const [missionData, setMissionData] = useState<StoryCutInData | null>(null);
  const [missionShownFor, setMissionShownFor] = useState<string | null>(null);
  const missionCutIn = active && run
    ? liveMissionCutIn({ step, live, teacher: run.context.teacherId, partnerId: run.context.partnerId, stepKey })
    : null;
  const missionPending = !!missionCutIn && missionShownFor !== stepKey;
  useEffect(() => {
    if (!missionPending || !missionCutIn) return;
    const timer = setTimeout(() => {
      setMissionShownFor(stepKey);
      setMissionData(missionCutIn);
    }, 1_600);
    return () => clearTimeout(timer);
    // missionCutIn은 같은 스텝에서 내용이 안 바뀐다(stepKey 기준 1회) — 객체 identity로 재예약하지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionPending, stepKey]);

  const holdInterrupt = pendingInterrupt(step, live);
  const firstTurn = firstMyTurnInterrupt(step);
  const holding = !!live?.hold && run?.phase === 'live-hold';
  const isMyTurn = !!gameState?.isHandInProgress
    && !!myPlayerId
    && gameState.players[gameState.activePlayerIndex]?.id === myPlayerId;

  // 스텝이 바뀌면 열려 있던 인터럽트를 닫는다 (렌더 중 상태 보정 패턴 — effect setState 금지)
  const [trackedStepKey, setTrackedStepKey] = useState(stepKey);
  if (trackedStepKey !== stepKey) {
    setTrackedStepKey(stepKey);
    setFirstTurnOpen(false);
  }

  // 스텝당 1회: 처음 내 턴이 오면 first-my-turn 인터럽트를 연다 (같은 보정 패턴).
  // 서버 hold가 걸린 동안에는 열지 않는다 — hold 씬과 겹치면 두 모달이 쌓인다.
  if (active && firstTurn && isMyTurn && !holding && firstTurnPlayedFor !== stepKey) {
    setFirstTurnPlayedFor(stepKey);
    setFirstTurnOpen(true);
  }

  if (!active || !run) return null;

  const prompt = practicePrompt(step);
  const hudLines = objectiveHudLines(live);
  const partnerId = run.context.partnerId;
  const holdReason = live?.holdReason ?? null;
  const sceneGate = holdInterrupt ? `${stepKey}:${holdInterrupt.id}` : '';
  // 'scene' hold인데 챕터 데이터에서 인터럽트를 못 찾거나(데이터 불일치), 씬을 다 봤는데도
  // resume이 실패해 hold가 남아 있으면 안내 카드로 폴백한다 — 조용히 멈추면 런이 갇힌다.
  const showScene = holding && holdReason === 'scene' && !!holdInterrupt && sceneDoneFor !== sceneGate;
  const showHoldPanel = holding && !showScene && holdReason !== 'room-lost';

  return (
    <>
      {prompt && promptDismissed !== stepKey && (
        <PracticePromptBanner text={prompt} onDismiss={() => setPromptDismissed(stepKey)} />
      )}

      {/* HUD는 테이블 세로 컬럼의 우상단(딜러 코너 아래)에 맞춘다 —
          컨테이너 우측 끝은 데스크탑 채팅 패널, 좌상단은 액션 로그가 쓴다 */}
      <div className="pointer-events-none absolute inset-0 z-30 flex justify-center">
        <div className="relative h-full w-full" style={{ maxWidth: 'min(440px, 60dvh)' }}>
          <div className="absolute right-1 top-[4.5rem]">
            <ObjectiveHud
              tag={live?.tag ?? '대결'}
              handsPlayed={live?.handsPlayed ?? 0}
              maxHands={live?.maxHands ?? 0}
              minHands={live?.minHands ?? null}
              finishHint={liveFinishHint(live)}
              lines={hudLines}
              expanded={hudExpanded}
              onToggle={() => setHudUserExpanded(!hudExpanded)}
            />
          </div>
        </div>
      </div>

      <DecisionReviewSheet review={live?.lastReview ?? null} />
      <StoryCutIn data={missionData} isMobile={isMobile} onDone={() => setMissionData(null)} />

      {showScene && holdInterrupt && (
        <InterruptScene
          scene={holdInterrupt.scene}
          partnerId={partnerId}
          gateKey={`${stepKey}:${holdInterrupt.id}`}
          lastHandEndAt={lastHandEndAt}
          waitForHandEnd
          onFinish={() => {
            setSceneDoneFor(sceneGate);
            void resumeLive();
          }}
        />
      )}

      {showHoldPanel && (
        <LiveHoldPanel holdReason={holdReason} pending={pending} onResume={() => void resumeLive()} />
      )}

      {firstTurnOpen && firstTurn && !holding && (
        <InterruptScene
          scene={firstTurn.scene}
          partnerId={partnerId}
          gateKey={`${stepKey}:first-my-turn`}
          lastHandEndAt={lastHandEndAt}
          onFinish={() => setFirstTurnOpen(false)}
        />
      )}
    </>
  );
}
