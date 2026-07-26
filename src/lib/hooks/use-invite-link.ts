'use client';

import { useState } from 'react';
import { formatInviteCode } from '@/lib/invite/invite-code';

/**
 * 초대 복사 — 링크가 주 경로이고, 코드가 있으면 같이 붙여 보낸다.
 * 링크가 깨지거나 음성으로 불러줘야 할 때 코드가 대안이 된다.
 * copied는 1.5초간 true 유지.
 */
export function useInviteLink(roomId: string | null, inviteCode?: string | null) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!roomId) return;
    const link = `${window.location.origin}/?room=${roomId}`;
    const url = inviteCode
      ? `${link}
초대 코드: ${formatInviteCode(inviteCode)}`
      : link;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard API 미지원(비보안 컨텍스트 등) 폴백
      const ta = document.createElement('textarea');
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return { copied, copy };
}
