/**
 * 초대 코드 — 링크를 못 쓰는 자리(음성·오프라인·링크가 깨진 메신저)를 위한 보조 수단.
 *
 * 링크가 여전히 주 경로다(탭 한 번이면 끝난다). 코드는 여섯 글자를 사람이 옮겨 적는
 * 것이므로, 읽을 때 가장 많이 틀리는 0/O·1/I/L을 알파벳에서 통째로 뺐다.
 * 잘못 적은 글자를 임의로 교정하면 엉뚱한 방으로 조용히 보낼 수 있어, 교정 대신
 * 거절한다.
 *
 * 31자 × 6 ≈ 8.9억 조합. 이건 추측을 어렵게 할 뿐 인증이 아니다 —
 * 서버는 반드시 조회 레이트리밋을 걸어야 하고, 방 비밀번호는 별도로 유지된다.
 */

export const INVITE_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const INVITE_CODE_LENGTH = 6;

/** CSPRNG + rejection sampling — 모듈로 편향 없이 알파벳을 고르게 쓴다 */
function secureIndex(bound: number): number {
  const limit = Math.floor(256 / bound) * bound;
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) return buffer[0] % bound;
  }
}

export function generateInviteCode(): string {
  let code = '';
  for (let index = 0; index < INVITE_CODE_LENGTH; index += 1) {
    code += INVITE_CODE_ALPHABET[secureIndex(INVITE_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * 사람이 친 문자열을 정규 코드로 바꾼다. 대소문자와 구분자(공백·하이픈)만 관대하게
 * 받고, 알파벳 밖 글자가 하나라도 있으면 null을 준다.
 */
export function normalizeInviteCode(input: string): string | null {
  if (typeof input !== 'string') return null;
  const compact = input.replace(/[\s-]/g, '').toUpperCase();
  if (compact.length !== INVITE_CODE_LENGTH) return null;
  for (const char of compact) {
    if (!INVITE_CODE_ALPHABET.includes(char)) return null;
  }
  return compact;
}

/** 읽어주기 좋게 반으로 끊는다 (ABC-DEF) */
export function formatInviteCode(code: string): string {
  return code.length === INVITE_CODE_LENGTH
    ? `${code.slice(0, 3)}-${code.slice(3)}`
    : code;
}
