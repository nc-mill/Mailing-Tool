import { describe, expect, it } from 'vitest';
import { createIngestService, type EventProcessPayload } from './ingest-service';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
let counter = 0;
const event = (over: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    id: `0192f3a0-1c2d-7e50-8a1b-2c3d4e5f${String(counter).padStart(4, '0')}`,
    name: 'page_view',
    occurred_at: '2026-07-31T11:59:59.000Z',
    ...over,
  };
};

function service(over: Record<string, unknown> = {}) {
  const enqueued: EventProcessPayload[] = [];
  const svc = createIngestService({
    resolvePublicKey: async () => ({ workspaceId: WS, apiKeyId: 'k1' }),
    isOriginAllowed: () => true,
    allowServersidePublicKey: () => false,
    limits: { maxKeys: 32, maxDepth: 3, maxString: 1024 },
    stripParams: ['token', 'ml_token'],
    enqueue: async (payload) => {
      enqueued.push(payload);
    },
    now: () => new Date('2026-07-31T12:00:00.000Z'),
    ...over,
  });
  return { svc, enqueued };
}

const batch = (events: unknown[]) => ({
  v: 1,
  key: 'ml_pub_aebagbafaydqqcik',
  sent_at: '2026-07-31T12:00:00.000Z',
  anonymous_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  events,
});

describe('ingest service', () => {
  it('platná dávka vrátí 202, zařadí job a neprozradí nic o kontaktu', async () => {
    const { svc, enqueued } = service();
    const out = await svc.accept(batch([event()]), { origin: 'https://shop.cz' });
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ accepted: 1, rejected: 0 });
    expect(enqueued).toHaveLength(1);
    expect(JSON.stringify(out.body)).not.toContain('contact');
  });

  it('Origin mimo tracking_domains vrátí 403 a origin_not_allowed', async () => {
    const { svc } = service({ isOriginAllowed: () => false });
    const out = await svc.accept(batch([event()]), { origin: 'https://evil.example' });
    expect(out.status).toBe(403);
    expect(out.problem?.code).toBe('origin_not_allowed');
  });

  it('požadavek bez Origin se přijme jen při zapnutém nastavení projektu', async () => {
    const off = service();
    expect((await off.svc.accept(batch([event()]), { origin: undefined })).status).toBe(403);
    const on = service({ allowServersidePublicKey: () => true });
    expect((await on.svc.accept(batch([event()]), { origin: undefined })).status).toBe(202);
  });

  it('neznámý veřejný klíč vrátí 401', async () => {
    const { svc } = service({ resolvePublicKey: async () => null });
    expect((await svc.accept(batch([event()]), { origin: 'https://shop.cz' })).status).toBe(401);
  });

  it('vypnuté měření webu vrátí 202 s nulou přijatých, ne chybu', async () => {
    const { svc, enqueued } = service({ isWebTrackingEnabled: () => false });
    const out = await svc.accept(batch([event()]), { origin: 'https://shop.cz' });
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ accepted: 0, rejected: 0 });
    expect(enqueued).toHaveLength(0);
  });

  it('událost nad 8 kB se zahodí s nálezem, dávka projde', async () => {
    const { svc } = service();
    const big = event({ properties: { blob: 'x'.repeat(9000) } });
    const out = await svc.accept(batch([event(), big]), { origin: 'https://shop.cz' });
    expect(out.body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(out.body?.findings?.[0]).toMatchObject({ code: 'tracking_event_too_large' });
  });

  it('ořez vlastností se hlásí jako varování a událost je v accepted, ne v rejected', async () => {
    const { svc } = service({ limits: { maxKeys: 1, maxDepth: 3, maxString: 5 } });
    const out = await svc.accept(
      batch([event({ properties: { a: 1, b: 2, c: 'dlouhá hodnota' } })]),
      { origin: 'https://shop.cz' },
    );
    expect(out.body).toMatchObject({ accepted: 1, rejected: 0 });
    expect(out.body?.findings?.some((f) => f.code === 'tracking_properties_keys_dropped')).toBe(
      true,
    );
  });

  it('adresa se vyčistí a utm se rozparsuje do context.campaign', async () => {
    const { svc, enqueued } = service();
    await svc.accept(
      batch([
        event({
          page: {
            url: 'https://x.cz/a?token=abc&utm_source=news',
            path: '/a',
            search: '?token=abc&utm_source=news',
          },
        }),
      ]),
      { origin: 'https://shop.cz' },
    );
    const prepared = enqueued[0]!.events[0]!;
    expect(String(prepared.page!['url'])).not.toContain('token=abc');
    expect(String(prepared.page!['search'])).not.toContain('token=abc');
    expect(prepared.context['campaign']).toEqual({ source: 'news' });
  });

  it('neznámá verze payloadu skončí 400, ne 422', async () => {
    const { svc } = service();
    const out = await svc.accept({ ...batch([event()]), v: 42 }, { origin: 'https://shop.cz' });
    expect(out.status).toBe(400);
    expect(out.problem?.code).toBe('tracking_payload_version_unsupported');
  });

  it('korekce hodin se propíše do context.clock_skew_ms', async () => {
    const { svc, enqueued } = service();
    await svc.accept(
      { ...batch([event()]), sent_at: '2026-07-31T11:59:30.000Z' },
      { origin: 'https://shop.cz' },
    );
    expect(enqueued[0]!.events[0]!.context['clock_skew_ms']).toBe(30_000);
  });

  /**
   * Bez hostu v payloadu nemá worker z čeho zapsat `tracking_domains.verified_at`
   * a v rozhraní zůstane u každé domény navždy „Zatím neověřeno".
   */
  it('do fronty jde host z povoleného Origin, aby šlo ověřit doménu', async () => {
    const { svc, enqueued } = service();
    await svc.accept(batch([event()]), { origin: 'https://Shop.CZ:8443' });
    expect(enqueued[0]!.originHost).toBe('shop.cz');
  });

  it('serverové volání bez Origin nese host null, nic se neověřuje', async () => {
    const { svc, enqueued } = service({ allowServersidePublicKey: () => true });
    await svc.accept(batch([event()]), { origin: undefined });
    expect(enqueued[0]!.originHost).toBeNull();
  });

  describe('identify', () => {
    const identify = (properties: Record<string, unknown>) =>
      event({ name: 'identify', properties });

    it('nepodepsané identify s e-mailem se odmítne, ostatní události projdou', async () => {
      const { svc, enqueued } = service();
      const out = await svc.accept(
        batch([
          identify({ external_id: 'customer_1', traits: { email: 'jan@example.cz' } }),
          event(),
        ]),
        { origin: 'https://shop.cz' },
      );

      expect(out.status).toBe(202);
      expect(out.body?.accepted).toBe(1);
      expect(out.body?.rejected).toBe(1);
      expect(out.body?.findings?.[0]?.code).toBe('tracking_identify_unsigned_pii');
      expect(enqueued[0]!.events).toHaveLength(1);
      expect(enqueued[0]!.events[0]!.name).toBe('page_view');
    });

    it('nepodepsané identify s telefonem se odmítne stejně jako s e-mailem', async () => {
      const { svc } = service();
      const out = await svc.accept(
        batch([identify({ external_id: 'c1', traits: { PHONE: '+420777123456' } })]),
        { origin: 'https://shop.cz' },
      );
      expect(out.body?.rejected).toBe(1);
      expect(out.body?.findings?.[0]?.code).toBe('tracking_identify_unsigned_pii');
    });

    it('podepsané identify s e-mailem projde, podpis se ověřuje až ve workeru', async () => {
      const { svc, enqueued } = service();
      const out = await svc.accept(
        batch([
          identify({
            external_id: 'customer_8472',
            traits: { email: 'jan@example.cz' },
            signature: 'GoE8G84t_u2jgjfQlWLvaKoFe3RQs91Pwjo1dMn9Ceg',
          }),
        ]),
        { origin: 'https://shop.cz' },
      );
      expect(out.body?.accepted).toBe(1);
      expect(enqueued[0]!.events[0]!.identify).toEqual({
        externalId: 'customer_8472',
        traits: { email: 'jan@example.cz' },
        signature: 'GoE8G84t_u2jgjfQlWLvaKoFe3RQs91Pwjo1dMn9Ceg',
      });
    });

    /**
     * TOHLE JE JÁDRO CELÉ VĚCI. `sanitizeProperties` zkracuje dlouhé řetězce,
     * takže traits v `properties` jsou po úklidu jiná data než ta podepsaná.
     * Kdyby se podpis ověřoval proti nim, neprošel by nikdy a nikde by nebylo
     * vidět proč.
     */
    it('netknutá kopie traits přežije zkrácení vlastností', async () => {
      const { svc, enqueued } = service({ limits: { maxKeys: 32, maxDepth: 3, maxString: 5 } });
      await svc.accept(
        batch([
          identify({
            external_id: 'customer_8472',
            traits: { first_name: 'Bartoloměj' },
            signature: 'aaa',
          }),
        ]),
        { origin: 'https://shop.cz' },
      );
      const prepared = enqueued[0]!.events[0]!;
      expect(prepared.identify?.traits).toEqual({ first_name: 'Bartoloměj' });
      // Uklizená verze, která jde do web_events, zkrácená být má.
      expect(
        String((prepared.properties['traits'] as Record<string, unknown>)['first_name']),
      ).not.toBe('Bartoloměj');
    });

    it('identify bez external_id se odmítne, nezařadí se', async () => {
      const { svc, enqueued } = service();
      const out = await svc.accept(batch([identify({ traits: { first_name: 'Jan' } })]), {
        origin: 'https://shop.cz',
      });
      expect(out.body?.rejected).toBe(1);
      expect(out.body?.findings?.[0]?.code).toBe('validation_failed');
      expect(enqueued).toHaveLength(0);
    });

    it('external_id s bajtem 0x0A se odmítne, podpis by byl nejednoznačný', async () => {
      const { svc } = service();
      const out = await svc.accept(batch([identify({ external_id: 'a\nb' })]), {
        origin: 'https://shop.cz',
      });
      expect(out.body?.findings?.[0]?.code).toBe('validation_failed');
    });

    it('nepodepsané identify bez osobních údajů projde', async () => {
      const { svc, enqueued } = service();
      const out = await svc.accept(
        batch([identify({ external_id: 'customer_1', traits: { orders: 3 } })]),
        { origin: 'https://shop.cz' },
      );
      expect(out.body?.accepted).toBe(1);
      expect(enqueued[0]!.events[0]!.identify).toEqual({
        externalId: 'customer_1',
        traits: { orders: 3 },
      });
    });
  });
});
