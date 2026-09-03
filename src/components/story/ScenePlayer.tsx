'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import VideoCutscene from '@/components/characters/VideoCutscene';
import { getCharacterById } from '@/lib/characters';
import { getStoryBackground } from '@/lib/assets/story-backgrounds';
import { getSceneCg } from '@/lib/assets/story-cgs';
import { getStoryVideo, sceneCgVideoId } from '@/lib/assets/story-video';
import { useOutfitId } from '@/lib/hooks/use-outfit';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import { playEffect } from '@/lib/sound/effects';
import { setMusicScene } from '@/lib/sound/music-manager';
import {
  advanceScene,
  chooseSceneOption,
  collectSceneFlags,
  createSceneCursor,
  cursorView,
  effectiveBackground,
  sceneLog,
  skipScene,
  type SceneCursor,
} from '@/lib/story/scene-cursor';
import type { Scene, SceneSpeaker, StoryHeroineId } from '@/lib/story/types';

interface ScenePlayerProps {
  scene: Scene;
  /** 'partner' 화자 해석 */
  partnerId: StoryHeroineId | null;
  /** 씬이 끝나면 (선택 플래그, 선택 기록) */
  onFinish: (result: { flags: Record<string, string>; chosen: Record<string, string> }) => void;
  /** 씬 전체 건너뛰기 허용 (기본 true — '스킵 불가 연출 금지') */
  allowSkip?: boolean;
  compact?: boolean;
}

const AUTO_DELAY_MS = 1_800;

export function resolveSpeaker(speaker: SceneSpeaker, partnerId: StoryHeroineId | null): { artId: string | null; name: string; color: string | null } {
  if (speaker === 'narrator') return { artId: null, name: '', color: null };
  if (speaker === 'player') return { artId: null, name: '나', color: null };
  const id = speaker === 'partner' ? partnerId : speaker;
  if (!id) return { artId: null, name: '파트너', color: null };
  const artId = id === 'miyako' ? 'dealer' : id;
  const profile = getCharacterById(artId) ?? getCharacterById(id);
  return { artId, name: id === 'miyako' ? '미야코' : (profile?.name ?? id), color: profile?.color ?? null };
}

/**
 * VN 씬 플레이어 — 배경/스프라이트/대사창/선택지/[자동][건너뛰기][로그].
 * 커서 상태 머신은 scene-cursor.ts(순수). 탭 1회: 타이핑 중이면 완성, 아니면 다음 라인.
 */
export default function ScenePlayer({ scene, partnerId, onFinish, allowSkip = true, compact = false }: ScenePlayerProps) {
  const [cursor, setCursor] = useState<SceneCursor>(() => createSceneCursor(scene));
  const [auto, setAuto] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const view = useMemo(() => cursorView(scene, cursor), [scene, cursor]);
  const line = view.kind === 'say' ? view.line : null;
  const { display, done, skip } = useTypewriter(line?.text ?? '', 22);
  const speaker = line ? resolveSpeaker(line.speaker, partnerId) : null;
  const speakerOutfit = useOutfitId(speaker?.artId);
  const reduced = usePrefersReducedMotion();
  const stageRef = useRef<HTMLDivElement>(null);
  const flashRef = useRef<HTMLDivElement>(null);
  // 라인 CG — 이 라인에서만 풀스크린(bg처럼 누적하지 않음). 미배치 id는 null → 스프라이트 그대로.
  const sceneCg = line?.cg ? getSceneCg(line.cg) : null;
  // 씬 CG 앰비언트 루프(3차 배치) — CgStage와 같은 계약: 파일 없음/디코딩 실패/1.5초 내 canplay 미도달이면 그 CG는 정지 이미지,
  // 다른 CG 라인으로 바뀌면 다시 시도. reduced-motion은 영상을 마운트하지 않는다.
  const sceneCgVideo = sceneCg ? getStoryVideo(sceneCgVideoId(sceneCg.id)) : null;
  const [cgVideoFailedFor, setCgVideoFailedFor] = useState<string | null>(null);
  const sceneCgId = sceneCg?.id ?? null;
  const onCgVideoFallback = useCallback(() => setCgVideoFailedFor(sceneCgId), [sceneCgId]);
  const useCgVideo = !!sceneCgVideo && !reduced && cgVideoFailedFor !== sceneCgId;

  // 라인 연출 — 라인 객체(정적 데이터)가 바뀔 때 1회. 흔들림/플래시/줌은 framer `animate`로 DOM에 직접(setState 없음),
  // reduced-motion이면 효과음만. 로그/자동 토글은 라인이 안 바뀌므로 재발화하지 않는다.
  useEffect(() => {
    const effect = line?.effect;
    if (!effect) return;
    if (effect.startsWith('sfx:')) {
      playEffect(effect.slice('sfx:'.length) as Parameters<typeof playEffect>[0]);
      return;
    }
    if (reduced) return;
    const stage = stageRef.current;
    if (!stage) return;
    if (effect === 'shake') {
      const controls = animate(stage, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4, ease: 'easeInOut' });
      return () => controls.stop();
    }
    if (effect === 'zoom') {
      const controls = animate(stage, { scale: [1, 1.05, 1] }, { duration: 1.2, ease: 'easeInOut' });
      return () => controls.stop();
    }
    if (effect === 'flash' && flashRef.current) {
      const controls = animate(flashRef.current, { opacity: [0, 0.85, 0] }, { duration: 0.35, ease: 'easeOut' });
      return () => controls.stop();
    }
  }, [line, reduced]);

  // 씬이 바뀌면 커서 리셋 (렌더 중 보정 — effect setState 금지 규칙)
  const [trackedScene, setTrackedScene] = useState(scene.id);
  if (trackedScene !== scene.id) {
    setTrackedScene(scene.id);
    setCursor(createSceneCursor(scene));
  }

  // 끝나면 부모에 알림 (외부 시스템 콜백 = onFinish)
  useEffect(() => {
    if (view.kind !== 'done') return;
    onFinish({ flags: collectSceneFlags(scene, cursor), chosen: cursor.chosen });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 완료 시 1회
  }, [view.kind]);

  // 씬 BGM — 첫 say 라인이 지정한 트랙 (외부 시스템 호출; 트랙이 없으면 music-manager가 폴백)
  useEffect(() => {
    for (const entry of scene.lines) {
      if (entry.kind === 'say' && entry.music) {
        setMusicScene(entry.music);
        return;
      }
    }
  }, [scene]);

  // 자동 진행: 타이핑이 끝난 뒤 일정 시간 후 다음 라인
  useEffect(() => {
    if (!auto || view.kind !== 'say' || !done) return;
    const timer = setTimeout(() => setCursor(current => advanceScene(scene, current)), AUTO_DELAY_MS);
    return () => clearTimeout(timer);
  }, [auto, view.kind, done, scene, cursor]);

  const handleTap = () => {
    if (view.kind !== 'say') return;
    if (!done) {
      skip();
      return;
    }
    setCursor(current => advanceScene(scene, current));
  };

  // 배경은 "커서까지의 마지막 bg" — 라인마다 bg를 안 적어도 유지된다. 이미지는 매니페스트에 있을 때만, 없으면 그라디언트.
  const background = getStoryBackground(effectiveBackground(scene, cursor));
  const log = sceneLog(scene, cursor);

  return (
    <div ref={stageRef} className={`relative isolate flex w-full flex-col overflow-hidden rounded-2xl border border-mystic/25 bg-gradient-to-b ${background.gradientClass} ${compact ? 'h-[52dvh]' : 'h-[68dvh]'} max-h-[640px]`} aria-label="장면">
      {/* 배경 이미지 — 라인 전환에 크로스페이드, 대사창 가독성용 하단 그라디언트. 음수 z로 컨트롤·스프라이트 아래 */}
      <AnimatePresence initial={false}>
        {background.src && !sceneCg && (
          <motion.img
            key={background.src}
            src={background.src}
            alt=""
            aria-hidden
            draggable={false}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none object-cover"
          />
        )}
      </AnimatePresence>
      {/* 씬 CG — 이 라인에서만, 느린 숨쉬기 줌(reduced-motion 정지). 스프라이트 컬럼은 CG 동안 비운다 */}
      <AnimatePresence initial={false}>
        {sceneCg && useCgVideo && sceneCgVideo ? (
          <motion.div
            key={`${sceneCg.src}#video`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="pointer-events-none absolute inset-0 -z-10 select-none"
          >
            <VideoCutscene
              video={sceneCgVideo}
              poster={sceneCg.src}
              alt={sceneCg.title}
              onFallback={onCgVideoFallback}
              className="block h-full w-full object-cover"
            />
          </motion.div>
        ) : sceneCg ? (
          <motion.img
            key={sceneCg.src}
            src={sceneCg.src}
            alt={sceneCg.title}
            draggable={false}
            initial={{ opacity: 0, scale: reduced ? 1 : 1.02 }}
            animate={{ opacity: 1, scale: reduced ? 1 : [1.02, 1.06] }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.5 }, scale: { duration: 8, ease: 'linear' } }}
            className="pointer-events-none absolute inset-0 -z-10 h-full w-full select-none object-cover"
          />
        ) : null}
      </AnimatePresence>
      {(background.src || sceneCg) && <div className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-abyss/80 via-abyss/25 to-transparent" aria-hidden />}
      {/* 플래시 오버레이 — effect 'flash'가 opacity를 직접 애니메이션 */}
      <div ref={flashRef} className="pointer-events-none absolute inset-0 z-20 bg-white opacity-0" aria-hidden />
      {sceneCg && (
        <span className="pointer-events-none absolute left-2 top-2 rounded bg-abyss/60 px-1.5 py-0.5 text-[9px] font-bold tracking-widest text-gilded" aria-hidden>
          CG · {sceneCg.title}
        </span>
      )}
      {/* 상단 컨트롤 */}
      <div className="flex items-center justify-end gap-1 p-2 text-[10px]">
        <button type="button" onClick={() => setLogOpen(open => !open)} aria-pressed={logOpen} className="rounded-lg border border-mystic/30 bg-abyss/50 px-2 py-1 text-ink-dim">로그</button>
        <button type="button" onClick={() => setAuto(value => !value)} aria-pressed={auto} className={`rounded-lg border px-2 py-1 ${auto ? 'border-cyber bg-cyber/20 text-ink' : 'border-mystic/30 bg-abyss/50 text-ink-dim'}`}>자동</button>
        {allowSkip && (
          <button type="button" onClick={() => setCursor(current => skipScene(scene, current))} className="rounded-lg border border-mystic/30 bg-abyss/50 px-2 py-1 text-ink-dim">건너뛰기</button>
        )}
      </div>

      {/* 스프라이트 */}
      <div className="relative flex min-h-0 flex-1 items-end justify-center">
        <AnimatePresence mode="popLayout">
          {speaker?.artId && !sceneCg && (
            <motion.div
              key={`${speaker.artId}-${line?.expression ?? 'neutral'}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: [0, -4, 0] }}
              exit={{ opacity: 0 }}
              transition={{ y: { duration: 0.45 }, opacity: { duration: 0.25 } }}
              className={`overflow-hidden rounded-t-3xl ${compact ? 'h-40 w-40' : 'h-56 w-56'}`}
            >
              <CharacterImage characterId={speaker.artId} expression={line?.expression ?? 'neutral'} round={false} outfitId={speakerOutfit} className="h-full w-full text-6xl" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 대사창 / 선택지 */}
      <div className="p-2">
        {view.kind === 'choice' ? (
          <div className="rounded-2xl border border-gilded/40 bg-abyss/85 p-3" role="group" aria-label="선택지">
            {view.choice.prompt && <p className="mb-2 text-xs text-ink-dim">{view.choice.prompt}</p>}
            <div className="grid gap-2">
              {view.choice.options.map(option => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setCursor(current => chooseSceneOption(scene, current, option.id))}
                  className="rounded-xl border border-gilded/40 bg-gilded/10 px-3 py-2.5 text-left text-sm text-ink hover:bg-gilded/20"
                >
                  {option.text}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={handleTap}
            disabled={view.kind === 'done'}
            className="block w-full rounded-2xl border border-mystic/30 bg-abyss/85 p-3 text-left backdrop-blur-sm"
            aria-label={done ? '다음' : '대사 완성'}
          >
            {speaker?.name && (
              <span className="mb-1 block text-[11px] font-bold" style={{ color: speaker.color ?? undefined }}>{speaker.name}</span>
            )}
            <span className={`block min-h-[3.2em] text-sm leading-relaxed text-ink ${line?.speaker === 'narrator' ? 'italic text-ink-dim' : ''}`}>
              {display}
              {!done && <span className="ml-0.5 inline-block animate-pulse">▍</span>}
            </span>
            {done && view.kind === 'say' && <span className="mt-1 block text-right text-[10px] text-ink-dim">▼ 탭</span>}
          </button>
        )}
      </div>

      {/* 로그 */}
      <AnimatePresence>
        {logOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col bg-abyss/95 p-3"
            role="dialog"
            aria-label="대사 로그"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-ink">대사 로그</span>
              <button type="button" onClick={() => setLogOpen(false)} className="rounded-lg border border-mystic/30 px-2 py-1 text-[10px] text-ink-dim">닫기</button>
            </div>
            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto text-xs scrollbar-thin">
              {log.map((entry, index) => {
                const who = resolveSpeaker(entry.speaker, partnerId);
                return (
                  <li key={index}>
                    {who.name && <span className="mr-1 font-bold" style={{ color: who.color ?? undefined }}>{who.name}</span>}
                    <span className="text-ink">{entry.text}</span>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
