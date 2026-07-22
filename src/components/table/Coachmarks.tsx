'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

const SEEN_KEY = 'poker-doku-coachmarks-v1';

function alreadySeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // 저장 불가 환경이면 매판 뜨는 것보다 안 뜨는 쪽이 낫다
  }
}

/**
 * 첫 테이블 코치마크 — 90초 온보딩의 일부. 처음 테이블에 들어온 유저에게
 * ①내 차례 표시 ②액션 버튼 ③칩 정산 3가지만 짚어주고 비켜선다.
 * 탭 한 번으로 닫히고 다시는 안 나온다 (localStorage 1회).
 */
export default function Coachmarks() {
  const [visible, setVisible] = useState(() =>
    typeof window !== 'undefined' && !alreadySeen(),
  );

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // 저장 실패 시 이번 세션만 숨김
    }
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          aria-label="게임 안내 닫기"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
          className="absolute inset-0 z-[60] block h-full w-full cursor-pointer bg-abyss/70 text-left backdrop-blur-[1px]"
        >
          <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
            <p className="text-center text-lg font-bold text-ink">첫 수련에 오신 걸 환영해요!</p>
            <ul className="w-full max-w-xs space-y-3">
              <li className="rounded-xl border border-gilded/40 bg-panel/90 p-3">
                <p className="text-xs font-bold text-gilded">① 내 차례</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink">
                  내 아바타에 금색 링이 돌면 내 차례예요. 시간 안에 아래 버튼으로 액션하세요.
                </p>
              </li>
              <li className="rounded-xl border border-mystic/40 bg-panel/90 p-3">
                <p className="text-xs font-bold text-mystic">② 폴드 · 콜 · 레이즈</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink">
                  화면 하단 버튼이 지금 가능한 액션만 보여줘요. 패가 나쁘면 폴드해도 칩을 아끼는 플레이예요.
                </p>
              </li>
              <li className="rounded-xl border border-blossom/40 bg-panel/90 p-3">
                <p className="text-xs font-bold text-blossom">③ 칩은 안전해요</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink">
                  테이블을 떠나면 남은 칩은 지갑으로 돌아가요. 상대 중 BOT 뱃지는 연습을 도와주는 AI예요.
                </p>
              </li>
            </ul>
            <p className="text-[11px] text-ink-dim">화면을 탭하면 시작해요</p>
          </div>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
