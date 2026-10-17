import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SkillBurstPreview from './SkillBurstPreview';

export const metadata: Metadata = { title: '필살기 연출 미리보기' };

/** 파트너 필살기 연출만 단독으로 재생하는 검토 화면 — 개발 서버 전용 (운영 빌드에서는 404) */
export default function SkillBurstPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SkillBurstPreview />;
}
