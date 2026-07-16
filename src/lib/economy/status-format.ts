import type { EconomyStatus } from '@/lib/profile/types';

const KST_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function formatEconomyAvailableAt(
  availableAt: number | null,
  now: number,
): string {
  if (availableAt === null) return '조건을 충족하면 받을 수 있어요';
  if (!Number.isSafeInteger(availableAt) || !Number.isSafeInteger(now)) {
    return '이용 가능 시간을 확인할 수 없어요';
  }
  if (availableAt <= now) return '지금 받을 수 있어요';
  const values: Partial<Record<'month' | 'day' | 'hour' | 'minute', string>> = {};
  for (const part of KST_FORMATTER.formatToParts(new Date(availableAt))) {
    if (
      part.type === 'month'
      || part.type === 'day'
      || part.type === 'hour'
      || part.type === 'minute'
    ) values[part.type] = part.value;
  }
  if (!values.month || !values.day || !values.hour || !values.minute) {
    return '이용 가능 시간을 확인할 수 없어요';
  }
  return `${Number(values.month)}월 ${Number(values.day)}일 ${values.hour.padStart(2, '0')}:${values.minute.padStart(2, '0')}부터`;
}

export function getRescueStatusText(
  rescue: EconomyStatus['rescue'],
  now: number,
): string {
  if (rescue.eligible) return `지금 ${rescue.grantAmount.toLocaleString('ko-KR')}칩 지원`;
  switch (rescue.reason) {
    case 'active-escrow':
      return '참가 중인 좌석 칩을 먼저 정산해 주세요';
    case 'balance-threshold':
      return '지갑 잔액이 800칩 미만일 때 받을 수 있어요';
    case 'cooldown':
      return `다음 지원 · ${formatEconomyAvailableAt(rescue.availableAt, now)}`;
    case 'daily-limit':
      return `오늘 지원을 모두 사용했어요 · ${formatEconomyAvailableAt(rescue.availableAt, now)}`;
    default:
      return formatEconomyAvailableAt(rescue.availableAt, now);
  }
}
