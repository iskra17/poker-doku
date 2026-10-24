import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import PokerTablePreview from './PokerTablePreview';

export const metadata: Metadata = { title: '실전 테이블 미리보기' };

/** 실전 테이블(6인 샘플 스냅샷)을 GameRoomView 골격으로 띄우는 검토 화면 — 개발 서버 전용 (운영 빌드에서는 404) */
export default function PokerTablePreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <PokerTablePreview />;
}
