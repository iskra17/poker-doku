'use client';

import { getAudioContext } from './audio-engine';

/**
 * 오실레이터/노이즈 합성 헬퍼.
 * 동시 8보이스 상한 + 이벤트별 스로틀로 과부하 방지.
 */

let activeVoices = 0;
const MAX_VOICES = 8;
const lastPlayed = new Map<string, number>();

/** 같은 키의 사운드가 ms 이내에 재생됐으면 true (스킵용) */
export function throttled(key: string, ms = 40): boolean {
  const now = performance.now();
  const last = lastPlayed.get(key) ?? 0;
  if (now - last < ms) return true;
  lastPlayed.set(key, now);
  return false;
}

interface ToneOpts {
  type?: OscillatorType;
  gain?: number;
  attackMs?: number;
  freqEnd?: number;
  delayMs?: number;
}

export function playTone(freq: number, durationMs: number, opts: ToneOpts = {}): void {
  const audio = getAudioContext();
  if (!audio || activeVoices >= MAX_VOICES) return;
  const { ctx, master } = audio;
  const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
  const dur = Math.max(0.02, durationMs / 1000);

  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(Math.max(20, freq), t0);
  if (opts.freqEnd) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + dur);
  }

  const gain = ctx.createGain();
  const peak = opts.gain ?? 0.15;
  const attack = (opts.attackMs ?? 4) / 1000;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(gain);
  gain.connect(master);
  activeVoices++;
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  osc.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
}

interface NoiseOpts {
  gain?: number;
  delayMs?: number;
  filterType?: BiquadFilterType;
  /** 필터 주파수 스윕 종료값 */
  filterEnd?: number;
}

export function playNoise(durationMs: number, filterFreq: number, opts: NoiseOpts = {}): void {
  const audio = getAudioContext();
  if (!audio || activeVoices >= MAX_VOICES) return;
  const { ctx, master } = audio;
  const t0 = ctx.currentTime + (opts.delayMs ?? 0) / 1000;
  const dur = Math.max(0.02, durationMs / 1000);

  const bufferSize = Math.ceil(ctx.sampleRate * dur);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType ?? 'bandpass';
  filter.frequency.setValueAtTime(filterFreq, t0);
  if (opts.filterEnd) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, opts.filterEnd), t0 + dur);
  }
  filter.Q.value = 1.2;

  const gain = ctx.createGain();
  const peak = opts.gain ?? 0.12;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  activeVoices++;
  source.start(t0);
  source.stop(t0 + dur + 0.05);
  source.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };
}
