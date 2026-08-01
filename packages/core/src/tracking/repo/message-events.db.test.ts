import { beforeAll, describe, expect, it } from 'vitest';
import { asMigrator, seedWorkspace } from '../test/support/db';
import { insertMessageEvents, type MessageEventInsert } from './message-events.repo';

const MESSAGE = '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182';
const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';

describe('insertMessageEvents', () => {
  let workspaceId: string;
  let otherWorkspaceId: string;

  beforeAll(async () => {
    workspaceId = await seedWorkspace();
    otherWorkspaceId = await seedWorkspace();
  });

  function row(id: string, overrides: Partial<MessageEventInsert> = {}): MessageEventInsert {
    return {
      id,
      workspaceId,
      messageId: MESSAGE,
      messageCreatedAt: new Date('2026-07-25T16:00:00Z'),
      campaignId: CAMPAIGN,
      contactId: CONTACT,
      type: 'open',
      subtype: 'human',
      ts: new Date(),
      linkId: null,
      metadata: {},
      ...overrides,
    };
  }

  it('zápis dávky do message_events je idempotentní a druhý běh nevyrobí duplicitu', async () => {
    const rows = [row('0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071')];
    const first = await insertMessageEvents(rows);
    const second = await insertMessageEvents(rows);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    // Návratová hodnota nestačí. Dřívější `ON CONFLICT (id, received_at)`
    // byl mrtvý kód a druhý běh by vrátil zase jedno ID, takže tenhle test
    // musí sáhnout do tabulky a spočítat řádky.
    const { rows: stored } = await asMigrator().query<{ count: string }>(
      'SELECT count(*) FROM message_events WHERE id = $1',
      [rows[0]!.id],
    );
    expect(Number(stored[0]!.count)).toBe(1);
  });

  it('zápis vyplní source a nechá rank i recipient na databázi', async () => {
    const id = '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6072';
    await insertMessageEvents([row(id)]);

    const { rows } = await asMigrator().query<{
      source: string;
      rank: number;
      recipient: string | null;
    }>('SELECT source, rank, recipient FROM message_events WHERE id = $1', [id]);
    expect(rows[0]!.source).toBe('tracking');
    // ODCHYLKA OD PLÁNU: plán čekal rank 50. Generovaný sloupec v P03 dává
    // otevření i prokliku NULU, protože obě události se neúčastní odvození
    // stavu doručení. Škálu vlastní P03 a test se řídí schématem, ne plánem.
    expect(rows[0]!.rank).toBe(0);
    // recipient je u otevření prázdný: e-mailová adresa se na řádek události
    // nekopíruje, jinak by jí musel projít i výmaz podle GDPR.
    expect(rows[0]!.recipient).toBeNull();
  });

  it('dávka ze dvou projektů se zapíše celá, ne jen její první polovina', async () => {
    // Buffer je společný pro proces. Kdyby se zapisovalo jednou transakcí
    // s jedním workspace kontextem, RLS by druhý projekt odmítla na WITH CHECK
    // a polovina událostí by zmizela, aniž by cokoliv spadlo.
    const inserted = await insertMessageEvents([
      row('0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6073'),
      row('0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6074', {
        workspaceId: otherWorkspaceId,
        messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607183',
        campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b6',
      }),
    ]);
    expect(inserted).toHaveLength(2);
  });

  it('prázdná dávka se nedotkne databáze', async () => {
    expect(await insertMessageEvents([])).toEqual([]);
  });
});
