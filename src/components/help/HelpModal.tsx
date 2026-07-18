'use client';

import { useState } from 'react';
import { HAND_RANK_KO } from '@/lib/poker/evaluator';
import Modal from '../ui/Modal';

/**
 * 종합 도움말 — 게임 규칙뿐 아니라 로비·칩·과제·편의 기능까지 기능별 카테고리로 정리.
 * 로비 헤더(?)와 게임 중(TopBar) 양쪽에서 열 수 있다.
 * 내용은 실제 구현과 어긋나면 안 된다 — 기능 스펙이 바뀌면 여기 문구도 함께 고칠 것.
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

interface HelpItem {
  term: string;
  desc: string;
}

const GLOSSARY: HelpItem[] = [
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
  { term: '포지션', desc: '딜러 버튼 기준 자리 이름. BTN(버튼)·SB·BB·UTG·HJ·CO 순서로 돌아요.' },
];

const TABLE_ITEMS: HelpItem[] = [
  { term: '방 만들기', desc: '[+ 방 만들기]에서 캐시 게임 또는 Sit & Go를 열 수 있어요. 블라인드·턴 시간·봇 수·비밀번호를 직접 정해요.' },
  { term: '캐시 게임', desc: '자유롭게 앉고 일어나는 기본 모드. 바이인은 40~200BB 범위에서 슬라이더로 골라요. 칩이 떨어지면 다시 사서(리바이) 이어갈 수 있어요.' },
  { term: 'Sit & Go', desc: '6인 토너먼트. 시작 스택 1,500칩, 3분마다 블라인드가 올라요. 1~3위가 상금 풀의 50/30/20%를 가져가요. 6명이 모이면 자동 시작하고, 연습 모드는 방장이 남는 자리를 봇으로 채워 시작할 수 있어요.' },
  { term: '인원 구성', desc: '🎯 혼자 연습(나 혼자 + 봇 — 다른 사람이 못 들어와요) / 봇+사람(봇이 자리를 채우다 사람이 오면 양보) / 사람만(봇 없음).' },
  { term: '난이도', desc: '초보 환영·보통·고수 — 봇들의 플레이 스타일이 달라져요. 초보 환영은 순하고, 고수는 공격적이에요.' },
  { term: '비밀번호 방 · 초대', desc: '🔒 표시는 비밀번호 방. 테이블 상단의 링크 복사 버튼으로 초대 링크를 보내면 친구가 바로 입장할 수 있어요.' },
  { term: '만석 기준', desc: '캐시 게임의 봇 좌석은 만석으로 치지 않아요 — 사람이 오면 봇이 자리를 양보해요.' },
];

const CHIP_ITEMS: HelpItem[] = [
  { term: '일일 무료 칩', desc: '로비 프로필 카드의 [일일 +N] 버튼으로 하루에 한 번 무료 칩을 받아요. 매일 잊지 말고 눌러주세요!' },
  { term: '미야코의 재도전 지원', desc: '지갑이 바닥나면 프로필 카드에 지원 배너가 떠요. 하루 제한 횟수 안에서 재기 칩을 받을 수 있어요.' },
  { term: '도장 레벨 (XP)', desc: '핸드를 플레이하면 XP가 쌓이고 도장 레벨이 올라요. 진행 바는 프로필 카드에서 볼 수 있어요.' },
  { term: '캐릭터 인연', desc: '선택한 캐릭터와 함께 플레이할수록 인연 레벨이 올라요. 프로필에서 캐릭터를 바꿀 수 있어요.' },
  { term: '타임칩', desc: '핸드에 10번 참여할 때마다 1개(최대 3개) 쌓여요. 내 턴에 타임칩 버튼을 누르면 +30초. 자동으로 쓰이지 않으니 필요할 때 직접 누르세요.' },
  { term: '수수료(레이크)', desc: '지갑 칩으로 하는 캐시 게임은 플랍 이후 팟에서 소액의 수수료를 떼요. 연습 모드는 없어요.' },
];

const PROGRESS_ITEMS: HelpItem[] = [
  { term: '수련 과제', desc: '로비의 [수련 과제] 탭에서 매일 갱신되는 과제를 확인해요. 달성하면 보상을 받아요 — 오늘의 성장 목표로 삼아보세요.' },
  { term: '포커 아레나', desc: '로비의 [포커 아레나] 탭 — 시즌마다 공식 경기로 성적을 쌓아 순위를 겨루는 경쟁 모드예요. 경기권이 있어야 공식 경기에 참가할 수 있어요.' },
  { term: '아레나 경기권', desc: '보유 경기권은 프로필 카드에서 확인해요. 공식 경기 입장에 1장씩 사용돼요.' },
];

const FEATURE_ITEMS: HelpItem[] = [
  { term: '핸드 히스토리', desc: '상단의 ⟲ 아이콘 — 내가 플레이한 핸드가 자동으로 기록돼요. 스트리트별 액션과 결과를 언제든 복기할 수 있고, 상대 카드는 쇼다운에서 공개된 것만 보여요.' },
  { term: '자리비움 · 게임 복귀', desc: '테이블에서 나갈 때 좌석을 지킬 수 있어요(자리비움). 로비에서 [게임 복귀]를 누르면 바이인 없이 바로 돌아가요. 캐시는 블라인드를 너무 오래 거르면 자동으로 일어나고, Sit & Go는 자리를 비워도 블라인드가 계속 차감돼요.' },
  { term: '재접속', desc: '연결이 끊겨도 60초 안에 같은 브라우저로 돌아오면 좌석과 칩이 그대로예요.' },
  { term: '턴 시간', desc: '기본 8초(방마다 다를 수 있어요). 시간이 다 되면 자동 체크/폴드되고 자리비움으로 표시돼요 — 액션하면 바로 풀려요.' },
  { term: '채팅', desc: '준비된 문구(프리셋)로만 대화해요. 카테고리에서 골라 탭하면 바로 전송 — 자유 입력이 없는 건 비방을 막기 위한 설계예요.' },
  { term: '설정', desc: '⚙ 설정에서 덱 스타일(클래식/빅랭크)·카드 색(2색/4색), 효과음·배경음악, 딜러 아바타/말풍선 표시를 바꿀 수 있어요.' },
  { term: '홈 화면 설치', desc: '설치 배너(또는 브라우저 메뉴의 "앱 설치")로 홈 화면에 추가하면 앱처럼 바로 실행돼요.' },
  { term: '문의 · 건의', desc: '상단의 💬 아이콘으로 버그 제보나 아이디어를 보내주세요. 운영자가 직접 읽어요.' },
];

type TabId = 'ranks' | 'terms' | 'table' | 'chips' | 'progress' | 'features';

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'ranks', label: '핸드 랭킹' },
  { id: 'terms', label: '용어' },
  { id: 'table', label: '테이블·방' },
  { id: 'chips', label: '칩·보상' },
  { id: 'progress', label: '과제·아레나' },
  { id: 'features', label: '편의 기능' },
];

const ITEM_TABS: Partial<Record<TabId, HelpItem[]>> = {
  terms: GLOSSARY,
  table: TABLE_ITEMS,
  chips: CHIP_ITEMS,
  progress: PROGRESS_ITEMS,
  features: FEATURE_ITEMS,
};

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
  const [tab, setTab] = useState<TabId>('ranks');
  const items = ITEM_TABS[tab];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="도움말">
      <div className="mb-3 flex flex-wrap gap-1.5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
              tab === t.id
                ? 'bg-purple-600 text-white border border-purple-400'
                : 'bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:border-purple-500/30'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="max-h-[55dvh] space-y-1 overflow-y-auto pr-1">
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
          items?.map(g => (
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
