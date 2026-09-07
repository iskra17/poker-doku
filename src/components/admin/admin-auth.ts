export type AdminRequestContext = 'login' | 'session' | 'devices' | 'logout';

export interface AdminSessionBody {
  token: string;
  rememberDevice: boolean;
  deviceName?: string;
}

export function buildAdminSessionBody(
  token: string,
  rememberDevice: boolean,
  deviceName: string,
): AdminSessionBody {
  const body: AdminSessionBody = { token, rememberDevice };
  if (rememberDevice) {
    const trimmedName = deviceName.trim().slice(0, 80);
    if (trimmedName) body.deviceName = trimmedName;
  }
  return body;
}

export function getAdminRequestErrorMessage(
  status: number | null,
  context: AdminRequestContext,
): string {
  if (status === null) return '서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.';
  if (status === 400) return '요청 형식이 올바르지 않아요. 입력값을 확인해주세요.';
  if (status === 401) {
    return context === 'login'
      ? '운영 토큰이 올바르지 않아요.'
      : '운영 세션이 만료되었어요. 다시 로그인해주세요.';
  }
  if (status === 403) return '보안 검증에 실패했어요. 페이지를 새로고침한 뒤 다시 시도해주세요.';
  if (status === 409) return '등록 기기 한도(20개)에 도달했어요. 다른 기기를 해제한 뒤 다시 시도해주세요.';
  if (status === 503) {
    return context === 'logout'
      ? '로그아웃에 실패했어요. 잠시 후 다시 시도해주세요.'
      : context === 'devices' || context === 'login'
        ? '등록 기기를 저장할 수 없어요. 잠시 후 다시 시도해주세요.'
        : '서버 저장소를 사용할 수 없어요. 잠시 후 다시 시도해주세요.';
  }
  return context === 'login'
    ? '로그인에 실패했어요. 잠시 후 다시 시도해주세요.'
    : context === 'logout'
      ? '로그아웃에 실패했어요. 잠시 후 다시 시도해주세요.'
      : '요청을 처리하지 못했어요. 잠시 후 다시 시도해주세요.';
}
