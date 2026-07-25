'use client';

import { useEffect, useState } from 'react';

/** One server-aligned clock per owning view; descendants receive the value. */
export function useServerNow(offsetMs: number): number {
  const [now, setNow] = useState(() => Date.now() + offsetMs);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offsetMs), 500);
    return () => clearInterval(timer);
  }, [offsetMs]);

  return now;
}
