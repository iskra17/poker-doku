import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import DrillTablePreview from './DrillTablePreview';

export const metadata: Metadata = { title: '수련 테이블 미리보기' };

/** 수련 문제 테이블(인트로·판단 재생)을 문항별로 재생하는 검토 화면 — 개발 서버 전용 (운영 빌드에서는 404) */
export default function DrillTablePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DrillTablePreview />;
}
