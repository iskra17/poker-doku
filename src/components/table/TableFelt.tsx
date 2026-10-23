/**
 * 테이블 외형(글로우·두께·레일·펠트·베팅 라인·수련 워터마크) — 표시 전용.
 *
 * 실전 테이블(`PokerTable`)과 수련 문제 테이블(`DrillTable`)이 같은 마크업을 쓴다.
 * 스토어를 읽지 않는다: 펠트 코스메틱(`feltId`)과 테마 플래그는 호출부가 넘긴다.
 * 부모는 `position: relative` 좌표 컨테이너여야 한다 (모든 % 좌표의 기준).
 */

interface TableFeltProps {
  /** 파이널 테이블 테마 — story보다 우선한다 */
  finalTable?: boolean;
  /** 수련 스토리 「도장 테이블」(시안 계열 펠트·레일) */
  story?: boolean;
  /** 장착 펠트 코스메틱 id — story일 때만 적용 */
  feltId?: string | null;
  /** 수련 테이블 워터마크 표시 (기본 true, story일 때만) */
  watermark?: boolean;
}

export default function TableFelt({ finalTable = false, story: storyTheme = false, feltId = null, watermark = true }: TableFeltProps) {
  // 수련 스토리 방은 펠트·레일을 시안 계열 「도장 테이블」로 바꿔 실전 캐시 테이블과 한눈에 구분한다
  // (2026-09-03 피드백 ③ — 연습 게임과 실전이 헷갈린다). 파이널 테이블 테마가 우선한다.
  const story = storyTheme && !finalTable;
  // 띠 펠트(노란/파란)는 수련 테이블에만 적용 — 실전 방(story=false)은 불변
  const yellowFelt = story && feltId === 'story-felt-yellow-belt';
  const brownFelt = story && feltId === 'story-felt-brown-belt';
  const blueFelt = story && feltId === 'story-felt-blue-belt';
  const blackFelt = story && feltId === 'story-felt-black-belt';
  const storyFeltHi = blackFelt ? 'var(--color-story-felt-black-hi)' : brownFelt ? 'var(--color-story-felt-brown-hi)' : yellowFelt ? 'var(--color-story-felt-yellow-hi)' : blueFelt ? 'var(--color-story-felt-blue-hi)' : 'var(--color-story-felt-hi)';
  const storyFeltLo = blackFelt ? 'var(--color-story-felt-black-lo)' : brownFelt ? 'var(--color-story-felt-brown-lo)' : yellowFelt ? 'var(--color-story-felt-yellow-lo)' : blueFelt ? 'var(--color-story-felt-blue-lo)' : 'var(--color-story-felt-lo)';
  const storyRail = blackFelt ? 'var(--color-story-felt-black-rail)' : brownFelt ? 'var(--color-story-felt-brown-rail)' : yellowFelt ? 'var(--color-gilded)' : 'var(--color-cyber)';
  const outerGlow = finalTable
    ? 'radial-gradient(ellipse, transparent 55%, color-mix(in srgb, var(--final-accent) 38%, transparent) 100%)'
    : story
      ? `radial-gradient(ellipse, transparent 60%, color-mix(in srgb, ${storyRail} 30%, transparent) 100%)`
      : 'none';
  const railBackground = finalTable
    ? `linear-gradient(180deg,
        color-mix(in srgb, var(--final-highlight) 20%, var(--final-rail-top)) 0%,
        var(--final-rail-top) 27%,
        var(--final-rail-bottom) 100%)`
    : story
      ? `linear-gradient(180deg,
        color-mix(in srgb, ${storyRail} 22%, var(--color-elevated)) 0%,
        color-mix(in srgb, ${storyFeltLo} 40%, var(--color-elevated)) 30%,
        color-mix(in srgb, black 30%, ${storyFeltLo}) 100%)`
      : `linear-gradient(180deg,
        color-mix(in srgb, var(--color-mystic) 26%, var(--color-elevated)) 0%,
        var(--color-elevated) 30%,
        color-mix(in srgb, black 28%, var(--color-elevated)) 100%)`;
  const railShadow = finalTable
    ? 'inset 0 2px 5px color-mix(in srgb, var(--final-highlight) 42%, transparent), inset 0 -7px 14px rgba(0,0,0,0.58), 0 0 42px color-mix(in srgb, var(--final-accent) 26%, transparent)'
    : story
      ? `inset 0 2px 4px rgba(255,255,255,0.14), inset 0 -6px 12px rgba(0,0,0,0.5), 0 0 40px color-mix(in srgb, ${storyRail} 20%, transparent)`
      : 'inset 0 2px 4px rgba(255,255,255,0.08), inset 0 -6px 12px rgba(0,0,0,0.35)';
  const feltBackground = finalTable
    ? 'radial-gradient(ellipse at 50% 64%, var(--final-felt-glow) 0%, var(--final-felt) 58%, color-mix(in srgb, black 38%, var(--final-felt)) 100%)'
    : story
      ? `radial-gradient(ellipse at 50% 68%, ${storyFeltHi} 0%, ${storyFeltLo} 58%, var(--color-story-abyss) 100%)`
      : 'radial-gradient(ellipse at 50% 68%, var(--color-felt-hi) 0%, var(--color-felt-lo) 70%, var(--color-abyss) 100%)';
  const feltShadow = finalTable
    ? 'inset 0 12px 32px rgba(0,0,0,0.45), inset 0 0 34px color-mix(in srgb, var(--final-highlight) 11%, transparent)'
    : story
      ? `inset 0 12px 30px rgba(0,0,0,0.5), inset 0 0 30px color-mix(in srgb, ${storyRail} 10%, transparent)`
      : 'inset 0 10px 24px rgba(0,0,0,0.3)';

  return (
    <>
      {/* Outer glow */}
      <div
        className="absolute rounded-[9999px] opacity-30"
        style={{
          left: '4%', right: '4%', top: '11%', bottom: '5%',
          background: outerGlow,
        }}
      />

      {/* 테이블 두께 — 레일과 같은 레이스트랙을 아래로 밀어 측면(근경 가장자리)을 노출 */}
      <div
        className="absolute rounded-[9999px] border-b-2 border-gilded/20"
        style={{
          left: '4%', right: '4%', top: 'calc(11% + 14px)', bottom: 'calc(5% - 14px)',
          background: finalTable
            ? 'linear-gradient(180deg, var(--final-rail-bottom) 0%, color-mix(in srgb, black 45%, var(--final-rail-bottom)) 80%)'
            : 'linear-gradient(180deg, var(--color-elevated) 0%, var(--color-abyss) 70%)',
          boxShadow: finalTable
            ? '0 12px 30px rgba(0,0,0,0.72), 0 0 30px color-mix(in srgb, var(--final-accent) 18%, transparent)'
            : '0 10px 26px rgba(0,0,0,0.6)',
        }}
      />

      {/* 레일(쿠션) — 실제 홀덤 테이블의 패딩 레일. 상단에 하이라이트, 골드 트림 */}
      <div
        className={`absolute rounded-[9999px] border-2 ${story ? (yellowFelt ? 'border-gilded/50' : 'border-cyber/40') : 'border-gilded/30'}`}
        style={{
          left: '4%', right: '4%', top: '11%', bottom: '5%',
          background: railBackground,
          boxShadow: railShadow,
        }}
      />

      {/* 펠트 — 레일 안쪽, 하단(플레이어 쪽)이 가깝게 보이도록 광원을 아래로 */}
      <div
        className="absolute rounded-[9999px] border border-black/50"
        style={{
          left: 'calc(4% + 12px)', right: 'calc(4% + 12px)',
          top: 'calc(11% + 12px)', bottom: 'calc(5% + 12px)',
          background: feltBackground,
          boxShadow: feltShadow,
        }}
      >
        {/* 베팅 라인 */}
        <div className={`absolute inset-5 md:inset-7 rounded-[9999px] border ${story ? (yellowFelt ? 'border-gilded/25' : 'border-cyber/20') : 'border-gilded/15'}`} />
        {/* 수련 테이블 워터마크 — 보드 위쪽 펠트에 옅게 (실전 방엔 없음) */}
        {story && watermark && (
          <div className="pointer-events-none absolute inset-x-0 top-[17%] flex justify-center" aria-hidden>
            <span className={`select-none text-[11px] font-black tracking-[0.45em] ${yellowFelt ? 'text-gilded/30' : 'text-cyber/25'}`}>{yellowFelt ? '노란띠 도장' : '수련 테이블'}</span>
          </div>
        )}
      </div>
    </>
  );
}
