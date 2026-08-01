import { describe, expect, it, vi } from 'vitest';
import {
  assertConfirmMethod,
  confirmSubscription,
  confirmationPageView,
  type ConfirmPorts,
} from '../../lists/confirm';

const ctx = { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071' } as never;
const now = new Date('2026-07-31T10:00:00.000Z');
const token = 'a'.repeat(43);

function makePorts(overrides: Partial<ConfirmPorts> = {}): ConfirmPorts {
  return {
    now: () => now,
    findConfirmation: vi.fn().mockResolvedValue({
      id: 'conf-1',
      contactId: 'contact-1',
      listId: 'list-1',
      expiresAt: new Date('2026-08-07T10:00:00Z'),
      consumedAt: null,
    }),
    consumeConfirmation: vi.fn().mockResolvedValue({
      id: 'conf-1',
      contactId: 'contact-1',
      listId: 'list-1',
      expiresAt: new Date('2026-08-07T10:00:00Z'),
      consumedAt: now,
    }),
    findList: vi.fn().mockResolvedValue({
      id: 'list-1',
      name: 'Newsletter',
      optIn: 'double',
      confirmationMode: 'one_step',
      confirmationTtlHours: 168,
      confirmationMaxResends: 3,
      sendWelcome: true,
    }),
    readSubscription: vi.fn().mockResolvedValue({ status: 'pending', confirmationSentAt: null }),
    writeSubscription: vi.fn().mockResolvedValue(undefined),
    checkSuppression: vi.fn().mockResolvedValue(null),
    removeUnsubscribeSuppression: vi.fn().mockResolvedValue(undefined),
    activateContact: vi.fn().mockResolvedValue(undefined),
    recordConsent: vi.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
    issueConfirmation: vi.fn().mockResolvedValue({ token: 'b'.repeat(43) }),
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    countResends: vi.fn().mockResolvedValue(0),
    emit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('assertConfirmMethod', () => {
  it('GET nikdy nepotvrzuje, v žádném režimu', () => {
    for (const mode of ['one_step', 'two_step'] as const) {
      expect(() => assertConfirmMethod('GET', mode)).toThrow();
      expect(() => assertConfirmMethod('HEAD', mode)).toThrow();
      expect(() => assertConfirmMethod('POST', mode)).not.toThrow();
    }
  });
});

describe('confirmationPageView', () => {
  it('v dvoukrokovém režimu ukáže tlačítko a formulář sám neodešle', () => {
    expect(confirmationPageView('valid', 'two_step')).toEqual({
      view: 'confirm_prompt',
      autoSubmit: false,
      status: 200,
    });
  });

  it('v jednokrokovém režimu formulář odešle skript, bez JavaScriptu zůstane tlačítko', () => {
    expect(confirmationPageView('valid', 'one_step')).toEqual({
      view: 'confirm_prompt',
      autoSubmit: true,
      status: 200,
    });
  });

  it.each([
    ['expired', 'expired'],
    ['consumed', 'already_used'],
    ['unknown', 'invalid'],
  ] as const)('stav %s ukáže pohled %s a vždy 200', (state, view) => {
    expect(confirmationPageView(state, 'one_step')).toEqual({
      view,
      autoSubmit: false,
      status: 200,
    });
  });

  it('neplatný token nikdy nevrací 404, aby nešlo zjišťovat existenci kontaktů', () => {
    expect(confirmationPageView('unknown', 'two_step').status).toBe(200);
  });
});

describe('confirmSubscription', () => {
  it('potvrdí pending, zapíše souhlas s důkazem, aktivuje kontakt a pošle uvítání', async () => {
    const ports = makePorts();
    const result = await confirmSubscription(
      ctx,
      { token, method: 'POST', requestIp: '203.0.113.7', userAgent: 'Firefox' },
      ports,
    );

    expect(result.view).toBe('done');
    expect(ports.consumeConfirmation).toHaveBeenCalledTimes(1);
    expect(ports.writeSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'confirmed', confirmedAt: now }),
    );
    expect(ports.recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'granted',
        source: 'double_opt_in',
        evidence: expect.objectContaining({
          double_opt_in_at: now.toISOString(),
          confirmation_ip: '203.0.113.7',
        }),
      }),
    );
    expect(ports.activateContact).toHaveBeenCalledWith('contact-1');
    expect(ports.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(ports.emit).toHaveBeenCalledWith('contact.subscribed', expect.anything());
  });

  it('druhé kliknutí na týž odkaz vrátí "už jste přihlášeni", nikdy chybu (kritérium 52)', async () => {
    const ports = makePorts({
      findConfirmation: vi.fn().mockResolvedValue({
        id: 'conf-1',
        contactId: 'contact-1',
        listId: 'list-1',
        expiresAt: new Date('2026-08-07T10:00:00Z'),
        consumedAt: new Date('2026-07-31T09:00:00Z'),
      }),
    });
    const result = await confirmSubscription(ctx, { token, method: 'POST' }, ports);

    expect(result.view).toBe('already_used');
    expect(result.status).toBe(200);
    expect(ports.consumeConfirmation).not.toHaveBeenCalled();
    expect(ports.recordConsent).not.toHaveBeenCalled();
  });

  it('prošlý odkaz pošle nový, pokud limit dovolí (kritérium 53)', async () => {
    const ports = makePorts({
      findConfirmation: vi.fn().mockResolvedValue({
        id: 'conf-1',
        contactId: 'contact-1',
        listId: 'list-1',
        expiresAt: new Date('2026-07-01T10:00:00Z'),
        consumedAt: null,
      }),
      readSubscription: vi.fn().mockResolvedValue({
        status: 'pending',
        confirmationSentAt: new Date('2026-07-01T09:00:00Z'),
      }),
    });
    const result = await confirmSubscription(ctx, { token, method: 'POST' }, ports);

    expect(result.view).toBe('expired_resent');
    expect(ports.sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('prošlý odkaz po vyčerpání limitu nový neposílá', async () => {
    const ports = makePorts({
      findConfirmation: vi.fn().mockResolvedValue({
        id: 'conf-1',
        contactId: 'contact-1',
        listId: 'list-1',
        expiresAt: new Date('2026-07-01T10:00:00Z'),
        consumedAt: null,
      }),
      readSubscription: vi.fn().mockResolvedValue({
        status: 'pending',
        confirmationSentAt: new Date('2026-07-31T09:00:00Z'),
      }),
      countResends: vi.fn().mockResolvedValue(3),
    });
    const result = await confirmSubscription(ctx, { token, method: 'POST' }, ports);

    expect(result.view).toBe('expired');
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('potvrzení odhlášeného sundá suppression global_unsubscribe (kritérium 63)', async () => {
    const ports = makePorts({
      readSubscription: vi
        .fn()
        .mockResolvedValue({ status: 'unsubscribed', confirmationSentAt: null }),
    });
    await confirmSubscription(ctx, { token, method: 'POST' }, ports);

    expect(ports.removeUnsubscribeSuppression).toHaveBeenCalledWith('contact-1');
  });

  it('kontakt mezitím se stížností vidí generickou hlášku a nic se nepotvrdí', async () => {
    const ports = makePorts({
      checkSuppression: vi.fn().mockResolvedValue({
        reason: 'complaint',
        createdAt: now,
        removedAt: null,
      }),
    });
    const result = await confirmSubscription(ctx, { token, method: 'POST' }, ports);

    expect(result.view).toBe('invalid');
    expect(result.status).toBe(200);
    expect(ports.consumeConfirmation).not.toHaveBeenCalled();
  });

  it('neznámý token vypadá stejně jako token cizího projektu', async () => {
    const ports = makePorts({ findConfirmation: vi.fn().mockResolvedValue(null) });
    const result = await confirmSubscription(ctx, { token, method: 'POST' }, ports);
    expect(result).toEqual({ view: 'invalid', status: 200, autoSubmit: false, listName: null });
  });

  it('GET nikdy nic nepotvrdí, ani v jednokrokovém režimu', async () => {
    const ports = makePorts();
    await expect(
      confirmSubscription(ctx, { token, method: 'GET' as never }, ports),
    ).rejects.toThrow();
    expect(ports.consumeConfirmation).not.toHaveBeenCalled();
  });
});
