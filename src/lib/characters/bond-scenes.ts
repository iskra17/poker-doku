/**
 * 인연 씬(이벤트 CG) 매니페스트 — 인연 레벨 마일스톤(5/10/15/20) 도달 시 해금되는
 * 캐릭터별 스토리 일러스트. 갸루게 이벤트 CG 문법의 축소판.
 *
 * - 마일스톤은 기존 인연 보상 레벨(AFFINITY_REWARD_LEVELS)과 정합 — 보상 순간에 씬이 얹힌다
 * - 해금 판정은 인연 레벨에서 파생(클라이언트) — 서버 상태 추가 없음
 * - 캡션은 전부 수기 스크립트 (캐릭터 성장 축 유지: 말더듬 감쇠/츤데레 해동/침묵 해빙 등)
 * - 아트: public/assets/characters/<id>/scene-lv<N>.webp (배경 포함 풀 씬, 768x1152)
 */

export interface BondScene {
  id: string;
  characterId: string;
  level: number;
  title: string;
  caption: string;
}

export const BOND_SCENE_LEVELS = [5, 10, 15, 20] as const;

const SCENE_BOOK: Record<string, Array<{ level: number; title: string; caption: string }>> = {
  sakura: [
    { level: 5, title: '벚꽃 아래서', caption: '이, 이 카드… 당신에게 행운을 줄 것 같아서요. 바, 받아 주세요…!' },
    { level: 10, title: '료칸의 오후', caption: '여기가 제 고향이에요. …당신에게는, 보여주고 싶었어요.' },
    { level: 15, title: '축제의 밤', caption: '킨교스쿠이, 이겼어요! …오늘은 하나도 안 떨려요. 신기하죠?' },
    { level: 20, title: '만개', caption: '저, 이제 알아요. 제가 기다리던 프리미엄 핸드는… 카드가 아니었어요.' },
  ],
  ara: [
    { level: 5, title: '연습실', caption: '내 셋업 구경? …뭐, 특별히 보여주는 거야. 아무한테나 안 보여줘.' },
    { level: 10, title: '승리의 하이파이브', caption: '야! 방금 봤지?! 하이파이브! …빨리! 팔 아프잖아!' },
    { level: 15, title: '야시장', caption: '하나 남았는데… 머, 먹을래? 남아서 주는 거야. 착각하지 마.' },
    { level: 20, title: '옥상에서', caption: '너랑 치는 포커가 제일 재밌어. …이 말 하려고 여기까지 데려온 거야.' },
  ],
  hana: [
    { level: 5, title: '화이트보드', caption: '이 스팟의 에퀴티는 63%예요. …당신이 이해할 때까지, 몇 번이든 설명할게요.' },
    { level: 10, title: '도서관', caption: '함께 복기하면 효율이 1.8배… 아뇨, 사실은 그냥, 이 시간이 좋아요.' },
    { level: 15, title: '머리를 풀고', caption: '…데이터에 없는 변수가 하나 있어요. 당신 앞에서만 생기는 오차예요.' },
    { level: 20, title: '별 아래에서', caption: '확률로 설명되지 않는 게 있다는 걸… 당신이 증명했어요.' },
  ],
  chloe: [
    { level: 5, title: '온에어', caption: '여러분~ 오늘의 스페셜 게스트! …바로 너야! 헤헤.' },
    { level: 10, title: '셀카', caption: '치즈~! 이 사진 프로필로 해도 돼? 완전 잘 나왔어!' },
    { level: 15, title: '오프 더 레코드', caption: '카메라 없는 나, 처음 보지? …이게 진짜 나야. 어때?' },
    { level: 20, title: '콘페티', caption: '구독자 10만보다… 네가 콜해주는 게 더 좋아! 진심이야!' },
  ],
  vivian: [
    { level: 5, title: '분장실', caption: '무대 뒤를 보여주는 건… 특별한 관객에게만이야.' },
    { level: 10, title: '박스석', caption: '이 오페라, 결말이 근사해. …옆자리가 너라서 더.' },
    { level: 15, title: '가면', caption: '연기는 여기까지. …지금부터는, 대본에 없는 장면이야.' },
    { level: 20, title: '커튼콜', caption: '천 번의 커튼콜보다 값진 관객이 있다는 걸 배웠어. 이 장미는… 너에게.' },
  ],
  elena: [
    { level: 5, title: '모스크바의 저녁', caption: '…춥지. 이 거리를 걷는 건, 오랜만이야.' },
    { level: 10, title: '무언의 커피', caption: '…마셔. 네 몫이야. …말은, 이걸로 충분해.' },
    { level: 15, title: '성에 낀 창가', caption: '…이 미소의 의미? …네가 맞혀 봐. 리딩은 자신 있잖아.' },
    { level: 20, title: '첫눈', caption: '…눈이 녹는 이유를 알았어. …너였어.' },
  ],
};

export function getBondScenes(characterId: string): BondScene[] {
  const book = SCENE_BOOK[characterId];
  if (!book) return [];
  return book.map(scene => ({
    id: `${characterId}-lv${scene.level}`,
    characterId,
    ...scene,
  }));
}

export function getBondSceneArt(scene: Pick<BondScene, 'characterId' | 'level'>): string {
  return `/assets/characters/${scene.characterId}/scene-lv${scene.level}.webp`;
}

export function isBondSceneUnlocked(scene: Pick<BondScene, 'level'>, affinityLevel: number): boolean {
  return affinityLevel >= scene.level;
}

/** 레벨 상승 구간에서 새로 해금된 씬들 (레벨 오름차순) */
export function findNewlyUnlockedScenes(
  characterId: string,
  previousLevel: number,
  nextLevel: number,
): BondScene[] {
  if (nextLevel <= previousLevel) return [];
  return getBondScenes(characterId)
    .filter(scene => scene.level > previousLevel && scene.level <= nextLevel);
}
