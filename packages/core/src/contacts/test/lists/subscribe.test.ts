import { describe, expect, it, vi } from 'vitest';
import { subscribe, type SubscribePorts } from '../../lists/subscribe';

const ctx = { workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071' } as never;
const now = new Date('2026-07-31T10:00:00.000Z');

function makePorts(overrides: Partial<SubscribePorts> = {}): SubscribePorts {
  return {
    now: () => now,
    checkSuppression: vi.fn().mockResolvedValue(null),
    findList: vi.fn().mockResolvedValue({
      id: 'list-1',
      name: 'Newsletter',
      optIn: 'double',
      confirmationTtlHours: 168,
      confirmationMaxResends: 3,
      sendWelcome: true,
    }),
    upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: true }),
    readSubscription: vi.fn().mockResolvedValue(null),
    writeSubscription: vi.fn().mockResolvedValue(undefined),
    countResends: vi.fn().mockResolvedValue(0),
    findConsent: vi.fn().mockResolvedValue(null),
    issueConfirmation: vi.fn().mockResolvedValue({ token: 't'.repeat(43) }),
    recordConsent: vi.fn().mockResolvedValue(undefined),
    sendConfirmationEmail: vi.fn().mockResolvedValue(undefined),
    sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
    deliverRequestedItem: vi.fn().mockResolvedValue(undefined),
    emit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const input = { listId: 'list-1', email: 'Jan@Example.CZ', source: 'form' as const };

describe('subscribe: nový kontakt', () => {
  it('na double opt-in seznamu vytvoří pending a pošle potvrzení', async () => {
    const ports = makePorts();
    const result = await subscribe(ctx, input, ports);

    expect(result.response).toBe('accepted');
    expect(result.outcome).toBe('confirmation_sent');
    expect(result.subscriptionStatus).toBe('pending');
    expect(ports.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(ports.sendWelcomeEmail).not.toHaveBeenCalled();
    // Adresa se normalizuje jednou, na vstupu, a dál jde jen normalizovaná.
    expect(ports.upsertContact).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'jan@example.cz' }),
    );
  });

  it('na single opt-in seznamu rovnou potvrdí, zapíše souhlas a pošle uvítání', async () => {
    const ports = makePorts({
      findList: vi.fn().mockResolvedValue({
        id: 'list-1',
        name: 'Newsletter',
        optIn: 'single',
        confirmationTtlHours: 168,
        confirmationMaxResends: 3,
        sendWelcome: true,
      }),
    });
    const result = await subscribe(ctx, input, ports);

    expect(result.subscriptionStatus).toBe('confirmed');
    expect(ports.recordConsent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'granted' }),
    );
    expect(ports.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe('subscribe: kontakt, který už je potvrzený', () => {
  it('nepošle ani potvrzovací, ani uvítací e-mail, ale vyžádanou věc doručí', async () => {
    const ports = makePorts({
      upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: false }),
      readSubscription: vi
        .fn()
        .mockResolvedValue({ status: 'confirmed', confirmationSentAt: null }),
    });
    const result = await subscribe(ctx, { ...input, deliverable: 'ebook-42' }, ports);

    expect(result.response).toBe('accepted');
    expect(result.outcome).toBe('already_confirmed');
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
    expect(ports.sendWelcomeEmail).not.toHaveBeenCalled();
    // Doručení vyžádané věci je to jediné, o co člověk skutečně požádal.
    expect(ports.deliverRequestedItem).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: 'ebook-42' }),
    );
    expect(ports.writeSubscription).not.toHaveBeenCalled();
  });
});

describe('subscribe: dříve odhlášený kontakt', () => {
  it('na single opt-in seznamu skončí v pending, ne v confirmed (kritérium 54)', async () => {
    const ports = makePorts({
      findList: vi.fn().mockResolvedValue({
        id: 'list-1',
        name: 'Newsletter',
        optIn: 'single',
        confirmationTtlHours: 168,
        confirmationMaxResends: 3,
        sendWelcome: true,
      }),
      upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: false }),
      readSubscription: vi
        .fn()
        .mockResolvedValue({ status: 'unsubscribed', confirmationSentAt: null }),
    });
    const result = await subscribe(ctx, input, ports);

    expect(result.subscriptionStatus).toBe('pending');
    expect(ports.sendConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(ports.recordConsent).not.toHaveBeenCalled();
  });
});

describe('subscribe: suppression list', () => {
  it('stížnost nic nezapíše a nic nepošle (kritérium 55)', async () => {
    const ports = makePorts({
      checkSuppression: vi.fn().mockResolvedValue({
        reason: 'complaint',
        removable: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        removedAt: null,
      }),
    });
    const result = await subscribe(ctx, { ...input, deliverable: 'ebook-42' }, ports);

    expect(result.response).toBe('accepted');
    expect(result.outcome).toBe('blocked_complaint');
    expect(ports.upsertContact).not.toHaveBeenCalled();
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
    // Suppression zakazuje jakékoliv odeslání, tedy i doručení vyžádané věci.
    expect(ports.deliverRequestedItem).not.toHaveBeenCalled();
  });

  it('výmaz podle GDPR se chová stejně jako stížnost', async () => {
    const ports = makePorts({
      checkSuppression: vi.fn().mockResolvedValue({
        reason: 'gdpr_erasure',
        removable: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        removedAt: null,
      }),
    });
    const result = await subscribe(ctx, input, ports);
    expect(result.outcome).toBe('blocked_suppressed');
    expect(ports.upsertContact).not.toHaveBeenCalled();
  });

  it('tvrdý odraz starší 30 dní přihlášení pustí', async () => {
    const ports = makePorts({
      checkSuppression: vi.fn().mockResolvedValue({
        reason: 'hard_bounce',
        removable: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        removedAt: null,
      }),
      readSubscription: vi.fn().mockResolvedValue({ status: 'bounced', confirmationSentAt: null }),
    });
    const result = await subscribe(ctx, input, ports);
    expect(result.subscriptionStatus).toBe('pending');
  });

  it('tvrdý odraz mladší 30 dní přihlášení odmítne', async () => {
    const ports = makePorts({
      checkSuppression: vi.fn().mockResolvedValue({
        reason: 'hard_bounce',
        removable: false,
        createdAt: new Date('2026-07-20T00:00:00Z'),
        removedAt: null,
      }),
      readSubscription: vi.fn().mockResolvedValue({ status: 'bounced', confirmationSentAt: null }),
    });
    const result = await subscribe(ctx, input, ports);
    expect(result.outcome).toBe('blocked_suppressed');
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
  });
});

describe('subscribe: opakované přihlášení nepotvrzeného kontaktu', () => {
  it('do pěti minut od posledního e-mailu nic neodešle', async () => {
    const ports = makePorts({
      upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: false }),
      readSubscription: vi.fn().mockResolvedValue({
        status: 'pending',
        confirmationSentAt: new Date('2026-07-31T09:58:00Z'),
      }),
    });
    const result = await subscribe(ctx, input, ports);

    expect(result.response).toBe('accepted');
    expect(result.outcome).toBe('resend_throttled');
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('po vyčerpání tří pokusů za 24 hodin nic neodešle', async () => {
    const ports = makePorts({
      upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: false }),
      readSubscription: vi.fn().mockResolvedValue({
        status: 'pending',
        confirmationSentAt: new Date('2026-07-31T09:00:00Z'),
      }),
      countResends: vi.fn().mockResolvedValue(3),
    });
    const result = await subscribe(ctx, input, ports);
    expect(result.outcome).toBe('resend_throttled');
    expect(ports.sendConfirmationEmail).not.toHaveBeenCalled();
  });

  it('po pěti minutách a s volným limitem potvrzení pošle znovu', async () => {
    const ports = makePorts({
      upsertContact: vi.fn().mockResolvedValue({ contactId: 'contact-1', created: false }),
      readSubscription: vi.fn().mockResolvedValue({
        status: 'pending',
        confirmationSentAt: new Date('2026-07-31T09:00:00Z'),
      }),
      countResends: vi.fn().mockResolvedValue(1),
    });
    const result = await subscribe(ctx, input, ports);
    expect(result.outcome).toBe('confirmation_sent');
    expect(ports.sendConfirmationEmail).toHaveBeenCalledTimes(1);
  });
});

describe('subscribe: jednotná odpověď', () => {
  it('vrátí totéž pole response ve všech vnitřních stavech', async () => {
    const scenarios: SubscribePorts[] = [
      makePorts(),
      makePorts({
        readSubscription: vi
          .fn()
          .mockResolvedValue({ status: 'confirmed', confirmationSentAt: null }),
      }),
      makePorts({
        readSubscription: vi
          .fn()
          .mockResolvedValue({ status: 'unsubscribed', confirmationSentAt: null }),
      }),
      makePorts({
        checkSuppression: vi.fn().mockResolvedValue({
          reason: 'complaint',
          removable: false,
          createdAt: now,
          removedAt: null,
        }),
      }),
      makePorts({
        checkSuppression: vi.fn().mockResolvedValue({
          reason: 'gdpr_erasure',
          removable: false,
          createdAt: now,
          removedAt: null,
        }),
      }),
    ];
    for (const ports of scenarios) {
      expect((await subscribe(ctx, input, ports)).response).toBe('accepted');
    }
    // Neplatná adresa vypadá zvenku stejně, jinak by šlo přes formulář zjišťovat platnost adres.
    expect((await subscribe(ctx, { ...input, email: 'neni-adresa' }, makePorts())).response).toBe(
      'accepted',
    );
  });

  it('neexistující seznam vrátí not_found, protože to není veřejný povrch', async () => {
    const ports = makePorts({ findList: vi.fn().mockResolvedValue(null) });
    await expect(subscribe(ctx, input, ports)).rejects.toMatchObject({ code: 'not_found' });
  });
});
