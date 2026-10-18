/** 결산 파트너 한마디. 실패에도 함께 수련할 다음 기회를 제안한다. */
export type ResultLineKind = 'pass' | 'sGrade' | 'fail';

const RESULT_LINES: Readonly<Record<string, Readonly<Record<ResultLineKind, string>>>> = {
  sakura: {
    pass: '해, 해냈어요…! 당신이랑 같이 배워서 기뻐요♥',
    sGrade: '와, 정말 멋졌어요…! 저도 당신처럼 침착하게 해 볼래요♥',
    fail: '괘, 괜찮아요… 제가 곁에 있을게요. 같이 다시 해 봐요.',
  },
  ara: {
    pass: '제법이네! …너랑 같이 하니까 나도 재밌었어.',
    sGrade: '방금 좀 멋있었어. …뭐, 잘했으니까 칭찬하는 거야!',
    fail: '괜찮아. 같이 복기하고 다시 해 보자. 나도 옆에 있을게.',
  },
  hana: {
    pass: '당신의 판단이 안정되고 있어요. 함께 복기한 보람이 있네요.',
    sGrade: '당신의 판단 과정이 인상적이었어요. 저도 배울 점이 있네요.',
    fail: '천천히 복기해 봐요. 당신이 이해할 때까지 함께할게요.',
  },
  chloe: {
    pass: '여러분~ 오늘 수련 클리어! 너랑 하니까 완전 재밌잖아!',
    sGrade: '와, 이건 하이라이트 각! 너 오늘 완전 빛났어!',
    fail: '괜찮아~ 다음 도전도 같이 가자! 내가 응원할게!',
  },
  vivian: {
    pass: '자기, 멋진 무대였어요. 함께해서 더 즐거웠어요.',
    sGrade: '자기, 오늘의 주인공이네요. 진심으로 박수를 보내요.',
    fail: '자기, 잠깐 쉬어도 괜찮아요. 다음 무대도 함께 준비해요.',
  },
  elena: {
    pass: '…잘했어. 같이 가자.',
    sGrade: '…멋졌어. 기억할게.',
    fail: '…괜찮아. 함께 다시 하자.',
  },
};

const FALLBACK: Readonly<Record<ResultLineKind, string>> = {
  pass: '잘했어요. 다음 수련도 함께해요.',
  sGrade: '멋진 수련이었어요. 함께해서 기뻐요.',
  fail: '괜찮아요. 천천히 복기하고 함께 다시 도전해요.',
};

export function partnerResultLine(characterId: string | null, kind: ResultLineKind): string {
  return (characterId ? RESULT_LINES[characterId] : null)?.[kind] ?? FALLBACK[kind];
}
