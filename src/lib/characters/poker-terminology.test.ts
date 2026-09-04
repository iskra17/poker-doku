import { describe, expect, it } from 'vitest';
import { hasAwkwardPokerTerminology } from './poker-terminology';
import { BOT_CHARACTERS } from './index';
import { STORY_CHAPTERS } from '../story/chapters';

describe('포커 대사 용어', () => {
  it.each(['좋은 손이 들어왔네.', '강한 손으로 콜할게.', '상위 %로 보는 손', '여기선 접는다.', '이번엔 접을게요.', '여기서는 접겠습니다.', '이번엔 접자.', '상대가 접으면 이득이야.', '팟의 두 배를 던져요.', '칩을 크게 던진다.'])(
    '어색한 포커 번역을 거른다: %s', line => {
      expect(hasAwkwardPokerTerminology(line)).toBe(true);
    },
  );

  it.each(['좋은 핸드가 들어왔네.', '폴드할게요.', '팟의 두 배를 벳해요.', '손이 떨리네요.', '손을 잡아도 될까요?', '반가운 손님이네?', '꽃다발을 던져요.', '올인 기념으로 꽃다발을 던져줄게!', '꽃다발을 크게 던져요.', '손익분기 폴드율을 계산해요.', '직접 확인했어요.'])(
    '자연스러운 용어와 실제 손·투척 표현을 보존한다: %s', line => {
      expect(hasAwkwardPokerTerminology(line)).toBe(false);
    },
  );

  it('캐릭터 프로필과 챕터의 수기 문구도 같은 규칙을 따른다', () => {
    const strings = (value: unknown): string[] => {
      if (typeof value === 'string') return [value];
      if (Array.isArray(value)) return value.flatMap(strings);
      if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
      return [];
    };
    expect(strings([BOT_CHARACTERS, STORY_CHAPTERS]).filter(hasAwkwardPokerTerminology)).toEqual([]);
  });
});
