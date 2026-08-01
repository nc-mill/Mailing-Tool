import { describe, expect, it, vi } from 'vitest';
import type { Keyring } from '@mlain/contracts/keyring';
import { elapsedSinceNonce, issueNonce, verifyNonce } from '../../forms/nonce';
import { PROTECTION_LAYERS, checkProtection } from '../../forms/protection';
import {
  DEFAULT_FORM_RATE_LIMIT,
  createFormRateLimiter,
  formRateLimitFromEnv,
} from '../../forms/rate-limit';

/**
 * ODCHYLKA OD PLÁNU, VĚDOMÁ A NUTNÁ. Plánový test staví keyring jako
 * `{ current: {...}, all: [...] }`. Kontrakt P02 má `Keyring = Map<number, Uint8Array>`
 * (kapitola 2 hlavičky plánu, řádek keyring), takže plánový tvar by se nepřeložil.
 *
 * Druhá odchylka: `checkProtection` bere limiter jako ČTVRTÝ POVINNÝ parametr, protože
 * pátá vrstva se jinak nedá vynutit. Každý test si zakládá vlastní limiter, aby jeden
 * neubíral strop druhému.
 */
const keyring: Keyring = new Map([[1, new Uint8Array(32).fill(1)]]);

const form = {
  id: 'f1',
  honeypotField: 'website',
  minFillSeconds: 2,
  allowedOrigins: ['https://firma.cz'],
  captchaProvider: 'none' as const,
};

/** Limiter s dost velkým stropem, aby nezasahoval do testů ostatních vrstev. */
const generous = () =>
  createFormRateLimiter({ perIpMinute: 1000, perIpHour: 1000, perFormMinute: 1000 });

describe('nonce', () => {
  it('ověří vlastní nonce', () => {
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    expect(verifyNonce(keyring, nonce.value, { formId: 'f1', ip: '1.2.3.4' }).ok).toBe(true);
  });

  it('nonce pro jiný formulář neprojde', () => {
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    expect(verifyNonce(keyring, nonce.value, { formId: 'f2', ip: '1.2.3.4' }).ok).toBe(false);
  });

  it('nonce se váže na prefix adresy, ne na celou', () => {
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    // Stejná síť projde: mobilní klient může mezi načtením a odesláním změnit adresu.
    expect(verifyNonce(keyring, nonce.value, { formId: 'f1', ip: '1.2.3.99' }).ok).toBe(true);
    expect(verifyNonce(keyring, nonce.value, { formId: 'f1', ip: '9.9.9.9' }).ok).toBe(false);
  });

  it('nonce po třiceti minutách vyprší', () => {
    vi.useFakeTimers();
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(verifyNonce(keyring, nonce.value, { formId: 'f1', ip: '1.2.3.4' }).ok).toBe(false);
    vi.useRealTimers();
  });

  it('pozměněný nonce neprojde', () => {
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    const tampered = `${nonce.value.slice(0, -1)}X`;
    expect(verifyNonce(keyring, tampered, { formId: 'f1', ip: '1.2.3.4' }).ok).toBe(false);
  });

  it('nonce vydaný před rotací klíče projde i po ní', () => {
    const beforeRotation: Keyring = new Map([[1, new Uint8Array(32).fill(1)]]);
    const afterRotation: Keyring = new Map([
      [1, new Uint8Array(32).fill(1)],
      [2, new Uint8Array(32).fill(2)],
    ]);
    const nonce = issueNonce(beforeRotation, { formId: 'f1', ip: '1.2.3.4' });
    expect(verifyNonce(afterRotation, nonce.value, { formId: 'f1', ip: '1.2.3.4' }).ok).toBe(true);
  });

  it('doba vyplnění se počítá z nonce, ne z hodnoty poslané klientem', () => {
    vi.useFakeTimers();
    const nonce = issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });
    vi.advanceTimersByTime(7000);
    expect(elapsedSinceNonce(nonce.value)).toBe(7);
    vi.useRealTimers();
  });
});

describe('checkProtection', () => {
  const validNonce = () => issueNonce(keyring, { formId: 'f1', ip: '1.2.3.4' });

  it('vyhodnocuje právě pět vrstev', () => {
    expect([...PROTECTION_LAYERS]).toEqual([
      'rate_limit',
      'origin',
      'nonce',
      'time_trap',
      'honeypot',
    ]);
  });

  it('platné odeslání projde', () => {
    const nonce = validNonce();
    const result = checkProtection(
      keyring,
      form,
      {
        origin: 'https://firma.cz',
        nonce: nonce.value,
        ip: '1.2.3.4',
        fields: { email: 'j@x.cz' },
        elapsedSeconds: 5,
      },
      generous(),
    );
    expect(result).toEqual({ outcome: 'accept' });
  });

  it('VRSTVA 1, KRITÉRIUM 87: původ mimo seznam skončí chybou, ne tichým zahozením', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://cizi.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'reject', code: 'origin_not_allowed' });
  });

  it('VRSTVA 1: chybějící hlavička Origin u formuláře s bílou listinou neprojde', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: null,
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'reject', code: 'origin_not_allowed' });
  });

  it('prázdný seznam původů znamená libovolný původ', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        { ...form, allowedOrigins: [] },
        {
          origin: 'https://kdekoliv.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ).outcome,
    ).toBe('accept');
  });

  it('VRSTVA 2: chybějící nonce se tiše zahodí', () => {
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: undefined,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'drop', reason: 'missing_nonce' });
  });

  it('VRSTVA 2: nonce podepsaný cizím klíčem se tiše zahodí', () => {
    const foreign: Keyring = new Map([[1, new Uint8Array(32).fill(9)]]);
    const nonce = issueNonce(foreign, { formId: 'f1', ip: '1.2.3.4' });
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'drop', reason: 'invalid_nonce' });
  });

  it('VRSTVA 3, KRITÉRIUM 86: odeslání dřív než za dvě sekundy se tiše zahodí', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 1,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'drop', reason: 'too_fast' });
  });

  it('VRSTVA 4, KRITÉRIUM 85: vyplněný honeypot se tiše zahodí', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz', website: 'http://spam.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'drop', reason: 'honeypot' });
  });

  it('VRSTVA 5: šesté odeslání z téže adresy za minutu neprojde', () => {
    const limiter = createFormRateLimiter(DEFAULT_FORM_RATE_LIMIT);
    const send = () =>
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: validNonce().value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        limiter,
      );
    for (let i = 0; i < DEFAULT_FORM_RATE_LIMIT.perIpMinute; i += 1) {
      expect(send().outcome).toBe('accept');
    }
    const blocked = send();
    expect(blocked.outcome).toBe('rate_limited');
    if (blocked.outcome !== 'rate_limited') return;
    expect(blocked.scope).toBe('ip_minute');
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('VRSTVA 5: strop na formulář platí i při rozprostření přes mnoho adres', () => {
    const limiter = createFormRateLimiter({
      perIpMinute: 1000,
      perIpHour: 1000,
      perFormMinute: 3,
    });
    const send = (ip: string) =>
      checkProtection(
        keyring,
        form,
        {
          origin: 'https://firma.cz',
          nonce: issueNonce(keyring, { formId: 'f1', ip }).value,
          ip,
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        limiter,
      );
    expect(send('10.0.1.1').outcome).toBe('accept');
    expect(send('10.0.2.1').outcome).toBe('accept');
    expect(send('10.0.3.1').outcome).toBe('accept');
    const blocked = send('10.0.4.1');
    expect(blocked.outcome).toBe('rate_limited');
    if (blocked.outcome !== 'rate_limited') return;
    expect(blocked.scope).toBe('form_minute');
  });

  it('VRSTVA 5: strop se po uplynutí okna uvolní', () => {
    let now = 1_000_000;
    const limiter = createFormRateLimiter(
      { perIpMinute: 1, perIpHour: 100, perFormMinute: 100 },
      () => now,
    );
    expect(limiter.consume({ formId: 'f1', ip: '1.2.3.4' }).allowed).toBe(true);
    expect(limiter.consume({ formId: 'f1', ip: '1.2.3.4' }).allowed).toBe(false);
    now += 61_000;
    expect(limiter.consume({ formId: 'f1', ip: '1.2.3.4' }).allowed).toBe(true);
  });

  it('VRSTVA 5: hodinový strop se konfiguruje proměnnou prostředí', () => {
    expect(formRateLimitFromEnv({ FORM_RATE_LIMIT_PER_IP_MINUTE: '10' })).toEqual({
      perIpMinute: 10,
      perIpHour: 60,
      perFormMinute: 100,
    });
    expect(formRateLimitFromEnv({ FORM_RATE_LIMIT_PER_IP_MINUTE: 'nesmysl' })).toEqual(
      DEFAULT_FORM_RATE_LIMIT,
    );
  });

  it('captcha bez tokenu skončí hlasitou chybou, ne tichým zahozením', () => {
    const nonce = validNonce();
    expect(
      checkProtection(
        keyring,
        { ...form, captchaProvider: 'turnstile' },
        {
          origin: 'https://firma.cz',
          nonce: nonce.value,
          ip: '1.2.3.4',
          fields: { email: 'j@x.cz' },
          elapsedSeconds: 5,
        },
        generous(),
      ),
    ).toEqual({ outcome: 'reject', code: 'captcha_failed' });
  });

  it('tiché zahození nikdy neprozradí, které pravidlo zabralo', () => {
    const limiter = generous();
    const honeypot = checkProtection(
      keyring,
      form,
      {
        origin: 'https://firma.cz',
        nonce: validNonce().value,
        ip: '1.2.3.4',
        fields: { email: 'j@x.cz', website: 'x' },
        elapsedSeconds: 5,
      },
      limiter,
    );
    const tooFast = checkProtection(
      keyring,
      form,
      {
        origin: 'https://firma.cz',
        nonce: validNonce().value,
        ip: '1.2.3.4',
        fields: { email: 'j@x.cz' },
        elapsedSeconds: 0,
      },
      limiter,
    );
    // Obě vedou na stejný outcome, takže bot z odpovědi nepozná, co ho chytlo.
    expect(honeypot.outcome).toBe(tooFast.outcome);
  });
});
