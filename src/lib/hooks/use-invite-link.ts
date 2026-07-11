'use client';

import { useState } from 'react';

/** 방 초대 링크(origin/?room=id) 복사 — copied는 1.5초간 true 유지 */
export function useInviteLink(roomId: string | null) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!roomId) return;
    const url = `${window.location.origin}/?room=${roomId}`;
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
