import { describe, expect, it } from 'vitest';
import {
  parseOptionalPayloadArgs,
  parsePayloadlessArgs,
  parseRequiredPayloadArgs,
} from './socket-arguments';

describe('Socket.IO runtime argument parsing', () => {
  const ack = (): void => undefined;

  it('accepts only zero arguments or one acknowledgement for payloadless events', () => {
    expect(parsePayloadlessArgs([])).toEqual({ ok: true, ack: undefined });
    expect(parsePayloadlessArgs([ack])).toEqual({ ok: true, ack });

    expect(parsePayloadlessArgs([{}])).toEqual({ ok: false, ack: undefined });
    expect(parsePayloadlessArgs([ack, 'extra'])).toEqual({ ok: false, ack: undefined });
    expect(parsePayloadlessArgs([{}, ack])).toEqual({ ok: false, ack });
  });

  it('requires one payload and permits only a trailing acknowledgement', () => {
    const payload = { roomId: 'room-1' };
    expect(parseRequiredPayloadArgs([payload])).toEqual({
      ok: true,
      payload,
      ack: undefined,
    });
    expect(parseRequiredPayloadArgs([payload, ack])).toEqual({ ok: true, payload, ack });

    expect(parseRequiredPayloadArgs([])).toEqual({ ok: false, ack: undefined });
    expect(parseRequiredPayloadArgs([ack])).toEqual({ ok: false, ack });
    expect(parseRequiredPayloadArgs([payload, {}])).toEqual({ ok: false, ack: undefined });
    expect(parseRequiredPayloadArgs([payload, {}, ack])).toEqual({ ok: false, ack });
  });

  it('disambiguates leave-room acknowledgement-only and optional-payload shapes', () => {
    const payload = { mode: 'sitout' };
    expect(parseOptionalPayloadArgs([])).toEqual({
      ok: true,
      payload: undefined,
      ack: undefined,
    });
    expect(parseOptionalPayloadArgs([ack])).toEqual({
      ok: true,
      payload: undefined,
      ack,
    });
    expect(parseOptionalPayloadArgs([payload])).toEqual({
      ok: true,
      payload,
      ack: undefined,
    });
    expect(parseOptionalPayloadArgs([payload, ack])).toEqual({ ok: true, payload, ack });

    expect(parseOptionalPayloadArgs([payload, {}])).toEqual({ ok: false, ack: undefined });
    expect(parseOptionalPayloadArgs([payload, {}, ack])).toEqual({ ok: false, ack });
  });
});
