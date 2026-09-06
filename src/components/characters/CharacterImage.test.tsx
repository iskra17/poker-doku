import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import CharacterImage from './CharacterImage';
import { getCharacterArt } from '@/lib/assets/character-art';

/**
 * `frameless`는 VN 씬(ScenePlayer) 전용 — 투명 배경 버스트를 액자 없이 얹는다.
 * 로비·좌석 호출부는 기본값(false)이므로 **기존 마크업이 그대로여야** 한다.
 * jsdom이 없는 저장소라 `renderToStaticMarkup` 문자열로 고정한다.
 */
describe('CharacterImage frameless', () => {
  const ART_ID = 'sakura';
  const SKIN_ID = 'affinity-sakura-skin';

  it('아트 경로가 실제로 존재하는 캐릭터로 검사한다 (전제)', () => {
    expect(getCharacterArt(ART_ID, 'neutral', null)).toBeTruthy();
  });

  it('기본값은 그라디언트 배경·라운딩·overflow 클리핑을 유지한다', () => {
    const round = renderToStaticMarkup(<CharacterImage characterId={ART_ID} className="h-10 w-10" />);
    expect(round).toContain('linear-gradient(135deg,');
    expect(round).toContain('relative overflow-hidden rounded-full h-10 w-10');

    const square = renderToStaticMarkup(<CharacterImage characterId={ART_ID} round={false} className="h-10 w-10" />);
    expect(square).toContain('linear-gradient(135deg,');
    expect(square).toContain('relative overflow-hidden rounded-xl h-10 w-10');
  });

  it('frameless=true면 배경 style·라운딩·overflow가 없다', () => {
    const markup = renderToStaticMarkup(
      <CharacterImage characterId={ART_ID} round={false} frameless className="h-10 w-10" />,
    );
    expect(markup).not.toContain('linear-gradient');
    expect(markup).not.toContain('overflow-hidden');
    expect(markup).not.toContain('rounded-');
    expect(markup).toContain('relative h-10 w-10');
    // 이미지 자체는 그대로
    expect(markup).toContain('absolute inset-0 w-full h-full object-cover');
  });

  it('frameless=true면 스킨 그라디언트·하단 패널 오버레이를 렌더하지 않는다', () => {
    const framed = renderToStaticMarkup(
      <CharacterImage characterId={ART_ID} round={false} skinId={SKIN_ID} className="h-10 w-10" />,
    );
    expect(framed).toContain('bg-gradient-to-br');
    expect(framed).toContain('from-panel/35');

    const frameless = renderToStaticMarkup(
      <CharacterImage characterId={ART_ID} round={false} skinId={SKIN_ID} frameless className="h-10 w-10" />,
    );
    expect(frameless).not.toContain('bg-gradient-to-br');
    expect(frameless).not.toContain('from-panel/35');
  });

  it('이모지 폴백(아트 없음)은 frameless여도 기존 그라디언트 원/사각을 유지한다', () => {
    const unknown = 'no-such-character';
    expect(getCharacterArt(unknown, 'neutral', null)).toBeNull();

    const markup = renderToStaticMarkup(<CharacterImage characterId={unknown} frameless className="h-10 w-10" />);
    expect(markup).toContain('linear-gradient(135deg,');
    expect(markup).toContain('overflow-hidden rounded-full');
  });
});
