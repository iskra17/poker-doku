'use client';

import { useState } from 'react';
import { HAND_RANK_KO } from '@/lib/poker/evaluator';
import Modal from '../ui/Modal';

/**
 * 초보용 도움말 — 핸드 랭킹표 + 포커 용어집.
 * 로비(RoomList)와 게임 중(TopBar) 양쪽에서 열 수 있다.
 * HandStrengthBadge가 "지금 내 핸드"를 알려준다면, 이 표는 전체 서열을 알려준다.
 */

// 예시 카드: [표기, 수트 문자] — 수트 색은 빨강(♥♦)/흰색(♠♣) 고정 (덱 테마와 무관한 학습용 표기)
type ExampleCard = string; // 'A♠' 형태

interface RankRow {
  rank: keyof typeof HAND_RANK_KO;
  example: ExampleCard[];
  desc: string;
}

const RANK_ROWS: RankRow[] = [
  { rank: 'royal-flush', example: ['A♠', 'K♠', 'Q♠', 'J♠', '10♠'], desc: '같은 무늬 A-K-Q-J-10' },
  { rank: 'straight-flush', example: ['9♥', '8♥', '7♥', '6♥', '5♥'], desc: '같은 무늬 연속 5장' },
  { rank: 'four-of-a-kind', example: ['Q♠', 'Q♥', 'Q♦', 'Q♣', '7♠'], desc: '같은 숫자 4장' },
  { rank: 'full-house', example: ['J♠', 'J♥', 'J♦', '8♣', '8♠'], desc: '트리플 + 원페어' },
  { rank: 'flush', example: ['A♦', 'J♦', '8♦', '6♦', '2♦'], desc: '같은 무늬 5장' },
  { rank: 'straight', example: ['10♣', '9♦', '8♠', '7♥', '6♣'], desc: '연속된 숫자 5장' },
  { rank: 'three-of-a-kind', example: ['7♠', '7♥', '7♣', 'K♦', '4♠'], desc: '같은 숫자 3장' },
  { rank: 'two-pair', example: ['K♠', 'K♥', '9♣', '9♦', 'A♠'], desc: '페어 2개' },
  { rank: 'one-pair', example: ['A♣', 'A♦', 'Q♠', '8♥', '3♣'], desc: '같은 숫자 2장' },
  { rank: 'high-card', example: ['A♠', 'J♦', '9♣', '6♥', '2♠'], desc: '족보 없음 — 높은 카드 승부' },
];

const GLOSSARY: Array<{ term: string; desc: string }> = [
  { term: '블라인드', desc: '딜러 왼쪽 두 명이 의무로 내는 베팅. 스몰(SB)·빅(BB) 순서예요.' },
  { term: '체크', desc: '앞에 베팅이 없을 때, 칩을 내지 않고 차례를 넘기는 것.' },
  { term: '콜', desc: '상대의 베팅 금액만큼 따라 내고 계속 참여하는 것.' },
  { term: '레이즈', desc: '상대의 베팅보다 더 크게 올려 베팅하는 것.' },
  { term: '폴드', desc: '이번 핸드를 포기하는 것. 이미 낸 칩은 돌려받지 못해요.' },
  { term: '올인', desc: '남은 칩을 전부 베팅하는 것.' },
  { term: '팟', desc: '모두가 베팅한 칩이 모이는 곳. 승자가 가져가요.' },
  { term: '커뮤니티 카드', desc: '모두가 함께 쓰는 공개 카드 5장. 플랍(3장)→턴(1장)→리버(1장) 순서로 열려요.' },
  { term: '쇼다운', desc: '리버까지 남은 사람들이 패를 공개해 승자를 가리는 순간.' },
  { term: '키커', desc: '족보가 같을 때 승부를 가르는 나머지 높은 카드.' },
  { term: '사이드 팟', desc: '누군가 올인하면, 그 금액을 넘는 베팅은 별도 팟으로 나뉘어요.' },
  { term: '바이인', desc: '테이블에 앉을 때 가져가는 칩. 캐시 게임은 입장 시 직접 골라요.' },
  { term: '타임칩', desc: '내 턴 시간이 부족할 때 자동으로 사용되는 연장권. 핸드에 참여하면 쌓여요.' },
];

/** 수트 문자에 따라 색 입힌 카드 표기 */
function CardText({ card }: { card: string }) {
  const red = card.includes('♥') || card.includes('♦');
  return (
    <span className={`font-bold tabular ${red ? 'text-suit-red' : 'text-ink'}`}>
      {card}
    </span>
  );
}

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const [tab, setTab] = useState<'ranks' | 'terms'>('ranks');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="게임 도움말">
      <div className="flex gap-2 mb-3">
        {([
          { id: 'ranks' as const, label: '핸드 랭킹' },
          { id: 'terms' as const, label: '용어' },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-bold transition-all ${
              tab === t.id
                ? 'bg-purple-600 text-white border border-purple-400'
                : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[55dvh] overflow-y-auto pr-1 space-y-1">
        {tab === 'ranks' ? (
          <>
            <p className="text-[11px] text-gray-500 mb-2">위에서 아래로 갈수록 약해져요. 홀카드 2장 + 커뮤니티 5장 중 베스트 5장으로 겨뤄요.</p>
            {RANK_ROWS.map((row, i) => (
              <div key={row.rank} className="flex items-center gap-2 bg-gray-800/30 rounded-lg px-2.5 py-1.5">
                <span className="text-gilded font-bold text-xs w-4 shrink-0 text-right">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-white font-bold text-sm">{HAND_RANK_KO[row.rank]}</span>
                    <span className="text-[10px] text-gray-500 truncate">{row.desc}</span>
                  </div>
                  <div className="flex gap-1.5 text-xs mt-0.5">
                    {row.example.map(c => <CardText key={c} card={c} />)}
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          GLOSSARY.map(g => (
            <div key={g.term} className="bg-gray-800/30 rounded-lg px-2.5 py-1.5">
              <span className="text-purple-300 font-bold text-sm">{g.term}</span>
              <p className="text-xs text-gray-400 mt-0.5">{g.desc}</p>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
