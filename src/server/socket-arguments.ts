import type { AckCallback } from '../lib/realtime/protocol';

type InvalidArgs<T> = {
  ok: false;
  ack: AckCallback<T> | undefined;
};

type ValidPayloadlessArgs<T> = {
  ok: true;
  ack: AckCallback<T> | undefined;
};

type ValidPayloadArgs<T> = {
  ok: true;
  payload: unknown;
  ack: AckCallback<T> | undefined;
};

/** The only audited cast: Socket.IO acknowledgements are callable trailing arguments. */
function asAck<T>(value: unknown): AckCallback<T> | undefined {
  return typeof value === 'function' ? value as AckCallback<T> : undefined;
}

export function parsePayloadlessArgs<T = undefined>(
  args: readonly unknown[],
): ValidPayloadlessArgs<T> | InvalidArgs<T> {
  if (args.length === 0) return { ok: true, ack: undefined };
  if (args.length === 1) {
    const ack = asAck<T>(args[0]);
    return ack ? { ok: true, ack } : { ok: false, ack: undefined };
  }
  return { ok: false, ack: asAck<T>(args.at(-1)) };
}

export function parseRequiredPayloadArgs<T = undefined>(
  args: readonly unknown[],
): ValidPayloadArgs<T> | InvalidArgs<T> {
  if (args.length === 1) {
    const ack = asAck<T>(args[0]);
    if (ack) return { ok: false, ack };
    return { ok: true, payload: args[0], ack: undefined };
  }
  if (args.length === 2) {
    const ack = asAck<T>(args[1]);
    if (ack) return { ok: true, payload: args[0], ack };
  }
  return {
    ok: false,
    ack: args.length >= 2 ? asAck<T>(args.at(-1)) : undefined,
  };
}

export function parseOptionalPayloadArgs<T = undefined>(
  args: readonly unknown[],
): ValidPayloadArgs<T> | InvalidArgs<T> {
  if (args.length === 0) {
    return { ok: true, payload: undefined, ack: undefined };
  }
  if (args.length === 1) {
    const ack = asAck<T>(args[0]);
    return ack
      ? { ok: true, payload: undefined, ack }
      : { ok: true, payload: args[0], ack: undefined };
  }
  if (args.length === 2) {
    const ack = asAck<T>(args[1]);
    if (ack) return { ok: true, payload: args[0], ack };
  }
  return { ok: false, ack: asAck<T>(args.at(-1)) };
}
