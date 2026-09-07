'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAdminRequestErrorMessage } from './admin-auth';

export interface AdminDevice {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  current: boolean;
}

interface AdminDevicesPanelProps {
  csrfToken: string;
  onCurrentDeviceRevoked: () => void;
  onSessionExpired: () => void;
}

interface DeviceListResponse {
  devices?: AdminDevice[];
}

function formatDeviceDate(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Date(value).toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminDevicesPanel({
  csrfToken,
  onCurrentDeviceRevoked,
  onSessionExpired,
}: AdminDevicesPanelProps) {
  const [devices, setDevices] = useState<AdminDevice[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const loadDevices = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/devices', {
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) {
        setError(getAdminRequestErrorMessage(response.status, 'devices'));
        return;
      }
      const body = await response.json() as DeviceListResponse;
      if (!Array.isArray(body.devices)) {
        setError('등록 기기 목록을 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
        return;
      }
      setDevices(body.devices);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(getAdminRequestErrorMessage(null, 'devices'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => {
    const controller = new AbortController();
    void loadDevices(controller.signal);
    return () => controller.abort();
  }, [loadDevices]);

  const revokeDevice = async (device: AdminDevice) => {
    if (pendingId) return;
    if (confirmingId !== device.id) {
      setConfirmingId(device.id);
      return;
    }

    setPendingId(device.id);
    setConfirmingId(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/devices?id=${encodeURIComponent(device.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (response.status === 204) {
        if (device.current) {
          onCurrentDeviceRevoked();
          return;
        }
        await loadDevices();
        return;
      }
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      setError(getAdminRequestErrorMessage(response.status, 'devices'));
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setError(getAdminRequestErrorMessage(null, 'devices'));
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section
      id="admin-devices-panel"
      aria-labelledby="admin-devices-heading"
      aria-busy={loading || pendingId !== null}
      className="rounded-xl border border-mystic/20 bg-panel/85 p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id="admin-devices-heading" className="text-sm font-bold text-blossom">등록 기기</h2>
          <p className="mt-1 max-w-2xl text-[11px] leading-snug text-ink-dim">
            로그인 유지에 동의한 브라우저만 표시됩니다. 기기를 해제하면 다음 요청부터 해당 브라우저의
            장기 로그인 자격이 사라집니다.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || pendingId !== null}
          onClick={() => void loadDevices()}
          className="rounded-lg border border-mystic/30 px-2.5 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? '불러오는 중…' : '새로고침'}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 rounded-lg border border-blossom/40 bg-blossom/10 px-3 py-2 text-[11px] leading-snug text-blossom">
          {error}
        </p>
      )}

      {loading && devices === null && (
        <p className="mt-3 text-xs text-ink-dim" role="status">등록 기기를 불러오는 중…</p>
      )}

      {!loading && devices?.length === 0 && (
        <p className="mt-3 rounded-lg border border-mystic/15 bg-elevated/40 px-3 py-3 text-xs text-ink-dim">
          등록된 기기가 없습니다. 다음 로그인에서 ‘이 기기에서 90일간 로그인 유지’를 선택할 수 있어요.
        </p>
      )}

      {devices && devices.length > 0 && (
        <ul className="mt-3 space-y-2" aria-label="등록된 관리자 로그인 기기">
          {devices.map(device => {
            const isPending = pendingId === device.id;
            const isConfirming = confirmingId === device.id;
            return (
              <li
                key={device.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-mystic/15 bg-elevated/35 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-bold text-ink">{device.name}</span>
                    {device.current && (
                      <span className="rounded-full border border-cyber/40 bg-cyber/10 px-1.5 py-px text-[10px] font-bold text-cyber">
                        현재 기기
                      </span>
                    )}
                  </div>
                  <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-[10px] text-ink-dim sm:grid-cols-3">
                    <div><dt className="inline">등록 </dt><dd className="inline tabular">{formatDeviceDate(device.createdAt)}</dd></div>
                    <div><dt className="inline">최근 접속 </dt><dd className="inline tabular">{formatDeviceDate(device.lastUsedAt)}</dd></div>
                    <div><dt className="inline">만료 </dt><dd className="inline tabular">{formatDeviceDate(device.expiresAt)}</dd></div>
                  </dl>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isConfirming && !isPending && (
                    <span className="text-[10px] text-gilded">한 번 더 눌러 해제</span>
                  )}
                  <button
                    type="button"
                    disabled={pendingId !== null}
                    onClick={() => void revokeDevice(device)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-50 ${
                      isConfirming
                        ? 'border-blossom/70 bg-blossom/25 text-blossom hover:bg-blossom/35'
                        : 'border-mystic/30 text-ink-dim hover:bg-white/5 hover:text-ink'
                    }`}
                    aria-label={`${device.name} 등록 해제`}
                  >
                    {isPending ? '해제 중…' : isConfirming ? '해제 확인' : '해제'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
