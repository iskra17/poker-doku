/**
 * 채팅 프리셋 — 자유 타이핑 대신 미리 정의된 문구/이모지만 전송할 수 있다.
 * 욕설·비하 발언을 원천 차단하기 위한 구조로, 서버(send-chat)가 이 테이블로만 검증한다
 * (클라이언트가 보낸 텍스트는 절대 신뢰하지 않고 presetId → text 매핑만 사용).
 * 참고: 클래시 로얄/하스스톤류 퀵챗 문법 — 카테고리 탭 + 탭하면 즉시 전송.
 */

export interface ChatPreset {
  id: string;
  text: string;
}

export interface ChatCategory {
  id: string;
  label: string;
  presets: ChatPreset[];
}

export const CHAT_CATEGORIES: ChatCategory[] = [
  {
    id: 'greet',
    label: '인사',
    presets: [
      { id: 'greet-1', text: '안녕하세요! 👋' },
      { id: 'greet-2', text: '잘 부탁해요~' },
      { id: 'greet-3', text: '좋은 게임 해요!' },
      { id: 'greet-4', text: 'GG! 좋은 게임이었어요' },
      { id: 'greet-5', text: '다음에 또 봐요!' },
      { id: 'greet-6', text: '먼저 일어날게요 🙇' },
    ],
  },
  {
    id: 'react',
    label: '리액션',
    presets: [
      { id: 'react-1', text: '나이스 핸드! 👏' },
      { id: 'react-2', text: '우와, 대박… 😲' },
      { id: 'react-3', text: '아깝다!' },
      { id: 'react-4', text: 'ㅋㅋㅋㅋㅋ' },
      { id: 'react-5', text: '헉 😱' },
      { id: 'react-6', text: '멋진 플레이!' },
      { id: 'react-7', text: '운이 좋았어요 🍀' },
      { id: 'react-8', text: '소름 돋았어요…' },
    ],
  },
  {
    id: 'game',
    label: '승부',
    presets: [
      { id: 'game-1', text: '흠… 고민되네요 🤔' },
      { id: 'game-2', text: '블러핑 같은데요? 👀' },
      { id: 'game-3', text: '못 믿겠어요!' },
      { id: 'game-4', text: '갑니다, 올인! 🔥' },
      { id: 'game-5', text: '오늘 카드가 안 붙네요 😮‍💨' },
      { id: 'game-6', text: '한 판 더 해요!' },
      { id: 'game-7', text: '천천히 하셔도 돼요' },
      { id: 'game-8', text: '집중, 집중…' },
    ],
  },
  {
    id: 'emoji',
    label: '이모지',
    presets: [
      '😀', '😂', '🤣', '😭', '😡', '😱', '🤯', '😴',
      '🤔', '😎', '🥲', '🫠', '👍', '👎', '🙏', '👏',
      '❤️', '🔥', '🍀', '💰', '💦', '🃏', '☕', '🎉',
    ].map((e, i) => ({ id: `emoji-${i + 1}`, text: e })),
  },
];

/** presetId → text 플랫 맵 (서버 검증용) */
export const CHAT_PRESET_MAP: Record<string, string> = Object.fromEntries(
  CHAT_CATEGORIES.flatMap(c => c.presets.map(p => [p.id, p.text])),
);
