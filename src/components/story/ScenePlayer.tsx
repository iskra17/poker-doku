'use client';

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { getCharacterById } from '@/lib/characters';
import { useTypewriter } from '@/lib/hooks/use-typewriter';
import {
  advanceScene,
  chooseSceneOption,
  collectSceneFlags,
  createSceneCursor,
  cursorView,
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
const BACKGROUND_CLASS: Record<string, string> = {
  'dojo-table': 'from-abyss via-panel to-mystic/30',
  'dojo-garden-night': 'from-abyss via-mystic/30 to-blossom/20',
  'dojo-office': 'from-abyss via-panel to-gilded/20',
};

export function resolveSpeaker(speaker: SceneSpeaker, partnerId: StoryHeroineId | null): { artId: string | null; name: string; color: string | null } {
  if (speaker === 'narrator') return { artId: null, name: '', color: null };
  if (speaker === 'player') return { artId: null, name: '나', color: null };
  const id = speaker === 'partner' ? partnerId : speaker;
  if (!id) return { artId: null, name: '파트너', color: null };
  const artId = id === 'miyako' ? 'dealer' : id;
  const profile = getCharacterById(artId) ?? getCharacterById(id);
  return { artId, name: profile?.name ?? (id === 'miyako' ? '미야코' : id), color: profile?.color ?? null };
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

  const bgClass = BACKGROUND_CLASS[line?.bg ?? ''] ?? 'from-abyss via-panel to-mystic/20';
  const log = sceneLog(scene, cursor);

  return (
    <div className={`relative flex w-full flex-col overflow-hidden rounded-2xl border border-mystic/25 bg-gradient-to-b ${bgClass} ${compact ? 'h-[52dvh]' : 'h-[68dvh]'} max-h-[640px]`} aria-label="장면">
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
          {speaker?.artId && (
            <motion.div
              key={`${speaker.artId}-${line?.expression ?? 'neutral'}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: [0, -4, 0] }}
              exit={{ opacity: 0 }}
              transition={{ y: { duration: 0.45 }, opacity: { duration: 0.25 } }}
              className={`overflow-hidden rounded-t-3xl ${compact ? 'h-40 w-40' : 'h-56 w-56'}`}
            >
              <CharacterImage characterId={speaker.artId} expression={line?.expression ?? 'neutral'} round={false} className="h-full w-full text-6xl" />
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
