import { beforeEach, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { asMigrator, seedCampaign } from '../test/support/db';
import { handleEventProcess, type EventProcessJobData } from './event-process';

/**
 * Řetěz od přijaté dávky k řádku v časové ose.
 *
 * Tenhle test je tu proto, že mezi „endpoint odpověděl 202" a „událost je
 * vidět u kontaktu" jsou čtyři kroky, na kterých se řetěz může tiše přetrhnout:
 * vyřešení identity, deduplikace, zápis do oddílu a doplnění mapy měsíců.
 * Kterýkoli z nich může vynechat, aniž by cokoli spadlo.
 */
describe('event.process', () => {
  let workspaceId: string;
  let contactId: string;
  let anonymousId: string;
  let enqueued: { queue: string; data: Record<string, unknown> }[];

  const event = (over: Record<string, unknown> = {}) => ({
    id: uuidv4(),
    name: 'page_view',
    occurredAt: new Date().toISOString(),
    sessionId: null,
    page: { url: 'https://shop.cz/a', path: '/a' },
    properties: {},
    context: {},
    ...over,
  });

  const job = (over: Partial<EventProcessJobData> = {}): EventProcessJobData => ({
    workspaceId,
    anonymousId,
    source: 'web',
    events: [event()],
    ...over,
  });

  const deps = () => ({
    enqueue: async (_tx: unknown, queue: string, data: Record<string, unknown>) => {
      enqueued.push({ queue, data });
    },
  });

  const countEvents = async (): Promise<number> => {
    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM web_events WHERE workspace_id = $1`,
      [workspaceId],
    );
    return Number(rows[0]!.count);
  };

  beforeEach(async () => {
    ({ workspaceId } = await seedCampaign(null));
    const { rows } = await asMigrator().query<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
      [workspaceId, `web-${Date.now()}@example.cz`],
    );
    contactId = rows[0]!.id;
    anonymousId = uuidv4();
    enqueued = [];
  }, 300_000);

  it('uloží událost a založí řádek identities s contact_id NULL', async () => {
    await handleEventProcess(job(), deps());

    expect(await countEvents()).toBe(1);
    const { rows } = await asMigrator().query<{ contact_id: string | null }>(
      `SELECT contact_id FROM identities WHERE workspace_id = $1 AND anonymous_id = $2`,
      [workspaceId, anonymousId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.contact_id).toBeNull();
  });

  it('doplní web_event_months, jinak by událost nikdo nenašel', async () => {
    await handleEventProcess(job(), deps());
    const { rows } = await asMigrator().query<{ subject_kind: string }>(
      `SELECT subject_kind FROM web_event_months WHERE workspace_id = $1 AND subject_id = $2`,
      [workspaceId, anonymousId],
    );
    expect(rows.map((r) => r.subject_kind)).toEqual(['anonymous']);
  });

  it('u navázaného anonymního ID doplní contact_id a zařadí přepočet segmentů', async () => {
    await asMigrator().query(
      `INSERT INTO identities (workspace_id, anonymous_id, contact_id) VALUES ($1, $2, $3)`,
      [workspaceId, anonymousId, contactId],
    );

    await handleEventProcess(job(), deps());

    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM web_events WHERE workspace_id = $1 AND contact_id = $2`,
      [workspaceId, contactId],
    );
    expect(Number(rows[0]!.count)).toBe(1);
    expect(enqueued.map((item) => item.queue)).toContain('segments.recalc_for_contact');

    // Časová osa se ptá přes mapu měsíců, takže tam musí přibýt i kontakt.
    const { rows: months } = await asMigrator().query<{ subject_kind: string }>(
      `SELECT subject_kind FROM web_event_months WHERE workspace_id = $1 ORDER BY subject_kind`,
      [workspaceId],
    );
    expect(months.map((m) => m.subject_kind)).toEqual(['anonymous', 'contact']);
  });

  it('u kontaktu s omezeným zpracováním zůstane událost anonymní (GDPR čl. 18)', async () => {
    await asMigrator().query(
      `INSERT INTO identities (workspace_id, anonymous_id, contact_id) VALUES ($1, $2, $3)`,
      [workspaceId, anonymousId, contactId],
    );
    await asMigrator().query(`UPDATE contacts SET processing_restricted = true WHERE id = $1`, [
      contactId,
    ]);

    await handleEventProcess(job(), deps());

    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*)::text AS count FROM web_events WHERE workspace_id = $1 AND contact_id = $2`,
      [workspaceId, contactId],
    );
    expect(Number(rows[0]!.count)).toBe(0);
    expect(await countEvents()).toBe(1);
    expect(enqueued).toHaveLength(0);
  });

  it('táž událost odeslaná dvakrát vytvoří jeden řádek', async () => {
    const data = job();
    await handleEventProcess(data, deps());
    await handleEventProcess(data, deps());
    expect(await countEvents()).toBe(1);
  });

  it('duplicita uvnitř jedné dávky se zachytí také', async () => {
    const single = event();
    await handleEventProcess(job({ events: [single, single] }), deps());
    expect(await countEvents()).toBe(1);
  });

  it('událost stará přes sedm dní projde, protože se čas ořezal už při příjmu', async () => {
    const old = new Date(Date.now() - 6.5 * 24 * 3600 * 1000).toISOString();
    await handleEventProcess(job({ events: [event({ occurredAt: old })] }), deps());
    expect(await countEvents()).toBe(1);
  });

  it('poslední aktivita kontaktu se zvedne, import ji nechá být', async () => {
    await asMigrator().query(
      `INSERT INTO identities (workspace_id, anonymous_id, contact_id) VALUES ($1, $2, $3)`,
      [workspaceId, anonymousId, contactId],
    );

    await handleEventProcess(job(), deps());
    const { rows } = await asMigrator().query<{ last_activity_at: Date | null }>(
      `SELECT last_activity_at FROM contacts WHERE id = $1`,
      [contactId],
    );
    expect(rows[0]!.last_activity_at).not.toBeNull();
  });
});
