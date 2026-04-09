'use client';

import { useIsMobile } from '@/lib/hooks/use-mobile';
import MobileChatPanel from './MobileChatPanel';
import DesktopChatPanel from './DesktopChatPanel';

export default function ChatPanel() {
  const isMobile = useIsMobile();
  return isMobile ? <MobileChatPanel /> : <DesktopChatPanel />;
}
