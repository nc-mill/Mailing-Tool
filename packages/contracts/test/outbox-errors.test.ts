import { describe, expect, it } from 'vitest';
import {
  CONTRACT_OUTBOX_ERROR_CODES,
  isKnownOutboxErrorCode,
  mergeOutboxErrorCodes,
} from '../src/outbox-errors';
import {
  assertSenderPauseReason,
  PAUSE_REASON_CODES,
  SENDER_PAUSE_REASON_CODES,
} from '../src/pause-reason';

describe('registr messages.error_code', () => {
  it('nese patnáct kontraktních kódů z tabulky v 4.10.1', () => {
    expect(CONTRACT_OUTBOX_ERROR_CODES).toHaveLength(15);
    expect(CONTRACT_OUTBOX_ERROR_CODES).toContain('ambiguous_dispatch');
    expect(CONTRACT_OUTBOX_ERROR_CODES).toContain('render_data_too_large');
  });

  it('sloučený registr přijme kód vlastníka jiné části', () => {
    const merged = mergeOutboxErrorCodes(CONTRACT_OUTBOX_ERROR_CODES, ['smtp_recipient_rejected']);
    expect(isKnownOutboxErrorCode('smtp_recipient_rejected', merged)).toBe(true);
    expect(isKnownOutboxErrorCode('vymyslel_jsem_si_to', merged)).toBe(false);
  });

  it('kontrola proti samotné kontraktní tabulce by kód senderu odmítla', () => {
    // Přesně proto se v CI pouští proti SLOUČENÉMU registru, ne proti tabulce.
    expect(isKnownOutboxErrorCode('smtp_recipient_rejected', CONTRACT_OUTBOX_ERROR_CODES)).toBe(
      false,
    );
  });
});

describe('campaigns.pause_reason', () => {
  it('sender smí zapsat právě čtyři kódy', () => {
    expect(SENDER_PAUSE_REASON_CODES).toEqual([
      'render_failure_rate',
      'credentials_undecryptable',
      'provider_quota_exhausted',
      'provider_unavailable',
    ]);
    expect(PAUSE_REASON_CODES).toHaveLength(9);
  });

  it('přijme platný objekt od senderu', () => {
    expect(() =>
      assertSenderPauseReason({
        code: 'provider_quota_exhausted',
        source: 'sender',
        detail: 'SES daily quota reached',
        sender_id: 'mlain-ws-7f3a',
        at: '2026-07-31T14:22:31Z',
      }),
    ).not.toThrow();
  });

  it('odmítne kód, který sender zapsat nesmí', () => {
    expect(() =>
      assertSenderPauseReason({
        code: 'bounce_guard',
        source: 'sender',
        at: '2026-07-31T14:22:31Z',
      }),
    ).toThrow(/bounce_guard/);
  });

  it('odmítne chybějící povinná pole', () => {
    expect(() =>
      assertSenderPauseReason({ code: 'provider_unavailable', source: 'sender' }),
    ).toThrow(/at/);
    expect(() =>
      assertSenderPauseReason({ code: 'provider_unavailable', at: '2026-07-31T14:22:31Z' }),
    ).toThrow(/source/);
  });
});
