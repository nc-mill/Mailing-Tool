import { beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { asMigrator, seedCampaign } from '../test/support/db';
import { withTrackingTx } from './tx';
import { insertWebEvents } from './web-events.repo';

/**
 * MAPA MĚSÍCŮ MUSÍ VZNIKNOUT SPOLU S UDÁLOSTÍ.
 *
 * `web_event_months` je předvýběr, přes který se ptá časová osa kontaktu
 * i podmínka segmentu podle chování. Chybějící řádek nic neshodí, jen se
 * událost nikde neukáže. Přesně tenhle tvar vady se v produktu už jednou stal:
 * v ostré databázi byla tabulka prázdná, přestože `web_events` řádky měly.
 */
describe('zápis do jednotné časové osy', () => {
  let workspaceId: string;
  let contactId: string;

  beforeAll(async () => {
    ({ workspaceId } = await seedCampaign(null));
    const { rows } = await asMigrator().query<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
      [workspaceId, 'osa@example.cz'],
    );
    contactId = rows[0]!.id;
  }, 300_000);

  it('doplní měsíc subjektu, aby událost šla dohledat', async () => {
    await withTrackingTx({ workspaceId, job: 'test.web_events' }, (tx) =>
      insertWebEvents(tx, workspaceId, [
        {
          id: uuidv7(),
          occurredAt: new Date(),
          workspaceId,
          name: 'email_opened',
          contactId,
          source: 'email',
          properties: { open_class: 'human' },
        },
      ]),
    );

    const { rows } = await asMigrator().query<{ subject_kind: string; month: string }>(
      `SELECT subject_kind, month::text AS month FROM web_event_months
        WHERE workspace_id = $1 AND subject_id = $2`,
      [workspaceId, contactId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject_kind).toBe('contact');

    // Měsíc se bere z received_at, tedy z oddílu, do kterého řádek spadl.
    const { rows: expected } = await asMigrator().query<{ month: string }>(
      `SELECT DISTINCT date_trunc('month', received_at)::date::text AS month
         FROM web_events WHERE workspace_id = $1 AND contact_id = $2`,
      [workspaceId, contactId],
    );
    expect(rows[0]?.month).toBe(expected[0]?.month);
  });

  it('druhá událost téhož měsíce druhý řádek mapy nevyrobí', async () => {
    await withTrackingTx({ workspaceId, job: 'test.web_events' }, (tx) =>
      insertWebEvents(tx, workspaceId, [
        {
          id: uuidv7(),
          occurredAt: new Date(),
          workspaceId,
          name: 'email_clicked',
          contactId,
          source: 'email',
          properties: {},
        },
      ]),
    );

    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*) AS count FROM web_event_months
        WHERE workspace_id = $1 AND subject_id = $2`,
      [workspaceId, contactId],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('událost bez kontaktu se nezapíše a mapu nezaplevelí', async () => {
    await withTrackingTx({ workspaceId, job: 'test.web_events' }, (tx) =>
      insertWebEvents(tx, workspaceId, [
        {
          id: uuidv7(),
          occurredAt: new Date(),
          workspaceId,
          name: 'email_opened',
          contactId: null,
          source: 'email',
          properties: {},
        },
      ]),
    );

    const { rows } = await asMigrator().query<{ count: string }>(
      `SELECT count(*) AS count FROM web_event_months WHERE workspace_id = $1`,
      [workspaceId],
    );
    expect(rows[0]?.count).toBe('1');
  });
});
