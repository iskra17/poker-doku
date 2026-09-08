'use client';

import { useIsMobile } from '@/lib/hooks/use-mobile';
import MobileChatPanel from './MobileChatPanel';
import DesktopChatPanel from './DesktopChatPanel';

export default function ChatPanel({ compact = false }: { compact?: boolean }) {
  const isMobile = useIsMobile();
  return isMobile || compact ? <MobileChatPanel /> : <DesktopChatPanel />;
}
