import {
  generateInviteCode,
  normalizeInviteCode,
} from '../lib/invite/invite-code';

/**
 * 초대 코드 ↔ 대상(방·토너먼트) 매핑.
 *
 * 방과 토너먼트가 같은 코드 공간을 쓴다 — 사용자는 코드를 받을 때 그게 캐시 테이블인지
 * 토너먼트인지 모르고, 알 필요도 없다. 대상이 사라지면 코드를 즉시 회수해 다음 대상이
 * 재사용할 수 있게 한다(죽은 코드가 엉뚱한 곳을 가리키면 안 된다).
 *
 * 인메모리다 — 서버 재시작 시 코드가 바뀐다. 방도 인메모리라 같은 수명이고,
 * 토너먼트는 DB에 남지만 코드만 새로 발급된다(링크는 그대로 유효).
 */

export type InviteTargetKind = 'room' | 'tournament';

export interface InviteTarget {
  readonly kind: InviteTargetKind;
  readonly id: string;
}

export class InviteRegistry {
  private readonly byCode = new Map<string, InviteTarget>();
  private readonly byTarget = new Map<string, string>();

  private key(kind: InviteTargetKind, id: string): string {
    return `${kind}:${id}`;
  }

  /** 이미 코드가 있으면 그대로 돌려준다 — 코드는 대상당 하나로 안정적이어야 한다 */
  issue(kind: InviteTargetKind, id: string): string | null {
    const existing = this.byTarget.get(this.key(kind, id));
    if (existing !== undefined) return existing;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const code = generateInviteCode();
      if (this.byCode.has(code)) continue;
      this.byCode.set(code, { kind, id });
      this.byTarget.set(this.key(kind, id), code);
      return code;
    }
    // 8.9억 조합에서 12연속 충돌은 사실상 불가능하다. 그래도 대상은 살아야 하므로
    // null을 주고 링크 초대만 남긴다.
    return null;
  }

  codeFor(kind: InviteTargetKind, id: string): string | null {
    return this.byTarget.get(this.key(kind, id)) ?? null;
  }

  /** 사용자가 친 문자열을 정규화해 대상을 찾는다 */
  resolve(input: string): InviteTarget | null {
    const code = normalizeInviteCode(input);
    if (code === null) return null;
    return this.byCode.get(code) ?? null;
  }

  release(kind: InviteTargetKind, id: string): void {
    const key = this.key(kind, id);
    const code = this.byTarget.get(key);
    if (code === undefined) return;
    this.byCode.delete(code);
    this.byTarget.delete(key);
  }

  size(): number {
    return this.byCode.size;
  }
}
