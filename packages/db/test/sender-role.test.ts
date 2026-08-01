// packages/db/test/sender-role.test.ts
//
// Nejcennější testovací soubor plánu. Historicky se stalo přesně tohle:
// politika sender_bypass chyběla, sender by v produkci neviděl ani řádek,
// a testy byly zelené, protože běžely pod migrátorem. KAŽDÝ test tady běží
// pod h.as('mlain_sender'). Kritérium 49 a scénáře OB-08, OB-09, OB-16, OB-17.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v7 as uuidv7 } from 'uuid';
import { type Harness, startHarness } from './helpers/container';
import { seedTwoWorkspaces } from './helpers/fixtures';
import {
  MESSAGES_STORAGE,
  createMonthlyPartitions,
  ensureUpcomingPartitions,
} from '../src/partitions';
import { expectPermissionDenied, expectRlsViolation } from './helpers/errors';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
  // message_events se partitionuje podle received_at s výchozím now(),
  // takže potřebuje oddíl pro AKTUÁLNÍ měsíc. Šablona se migruje
  // s ensurePartitions: false, oddíly si zakládá každý soubor sám.
  await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date(), 1);
}, 180_000);
afterAll(async () => {
  await h.stop();
});

type Fixture = { workspaceId: string; campaignId: string; messageId: string; createdAt: string };

async function seedCampaignWithMessage(): Promise<Fixture> {
  const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
  const campaignId = uuidv7();
  const messageId = uuidv7();
  // Invariant I1: created_at všech zpráv běhu = campaigns.audience_built_at,
  // zaokrouhlené na celé sekundy.
  const createdAt = '2026-08-10T09:00:00.000Z';
  // Partition MUSÍ existovat před vložením. Výchozí partition se nezakládá,
  // takže zápis mimo existující okno tvrdě selže, a to je záměr: fixture
  // s pevným datem si oddíl zakládá sama, nespoléhá na to, že ho runner
  // náhodou vytvořil pro aktuální měsíc.
  await createMonthlyPartitions(
    h.as('mlain_migrator'),
    'messages',
    'created_at',
    new Date(createdAt),
    1,
    MESSAGES_STORAGE,
  );
  await h.as('mlain_migrator').query(
    `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
     VALUES ($1, $2, 'Kampaň', 'sending', $3)`,
    [campaignId, ws.workspaceA, createdAt],
  );
  await h.as('mlain_migrator').query(
    `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, created_at)
     VALUES ($1, $2, $3, $4, 'prijemce@example.test', $5)`,
    [messageId, ws.workspaceA, campaignId, ws.contactInA, createdAt],
  );
  return { workspaceId: ws.workspaceA, campaignId, messageId, createdAt };
}

describe('role mlain_sender, vše pod skutečnou rolí senderu', () => {
  it('sender SKUTEČNĚ VIDÍ řádky messages, sender_bypass funguje', async () => {
    const f = await seedCampaignWithMessage();
    const { rows } = await h
      .as('mlain_sender')
      .query<{ id: string }>('SELECT id FROM messages WHERE campaign_id = $1', [f.campaignId]);
    expect(rows, 'sender nevidí žádnou zprávu, chybí politika sender_bypass').toHaveLength(1);
    expect(rows[0]!.id).toBe(f.messageId);
  });

  it('sender vidí i campaigns, workspaces, sending_providers a suppressions', async () => {
    await seedCampaignWithMessage();
    for (const table of [
      'campaigns',
      'workspaces',
      'sending_providers',
      'campaign_links',
      'suppressions',
    ]) {
      await expect(
        h.as('mlain_sender').query(`SELECT count(*) FROM ${table}`),
        `sender neumí číst ${table}`,
      ).resolves.toBeDefined();
    }
  });

  it('claim dotaz z kontraktu vrátí dávku a označí ji (scénář OB-01 v malém)', async () => {
    const f = await seedCampaignWithMessage();
    const { rows } = await h.as('mlain_sender').query(
      `
      WITH claimable AS (
        SELECT m.id, m.created_at
        FROM messages m
        WHERE m.campaign_id = $4
          AND m.status = 'pending'
          AND m.next_attempt_at <= now()
        ORDER BY m.next_attempt_at, m.id
        LIMIT $2
        FOR UPDATE OF m SKIP LOCKED
      )
      UPDATE messages m
      SET status = 'claimed', claimed_by = $1, claimed_at = now(),
          claim_expires_at = now() + make_interval(secs => $3), updated_at = now()
      FROM claimable cl, campaigns c, workspaces w
      WHERE m.id = cl.id
        AND m.created_at = cl.created_at
        AND m.campaign_id IS NOT NULL
        AND c.id = m.campaign_id
        AND w.id = m.workspace_id
        AND c.status IN ('queueing','sending')
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL
      RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
                m.email, m.render_data, m.attempts`,
      ['sender-test', 100, 300, f.campaignId],
    );
    expect(rows).toHaveLength(1);
  });

  it('sender NESMÍ mazat z messages (scénář OB-08, kritérium 49)', async () => {
    await seedCampaignWithMessage();
    await expectPermissionDenied(
      () => h.as('mlain_sender').query('DELETE FROM messages'),
      'sender smazal zprávy:',
    );
  });

  it('sender NESMÍ číst contacts (scénář OB-09, kritérium 49)', async () => {
    await seedCampaignWithMessage();
    await expectPermissionDenied(
      () => h.as('mlain_sender').query('SELECT * FROM contacts'),
      'sender přečetl contacts:',
    );
  });

  it('sender nesmí číst users, sessions, api_keys, audit_log ani web_events', async () => {
    for (const table of ['users', 'sessions', 'api_keys', 'audit_log', 'web_events']) {
      await expectPermissionDenied(
        () => h.as('mlain_sender').query(`SELECT * FROM ${table}`),
        `sender čte ${table}, a nemá:`,
      );
    }
  });

  it('sender NESMÍ vkládat do messages', async () => {
    const f = await seedCampaignWithMessage();
    await expectPermissionDenied(
      () =>
        h.as('mlain_sender').query(
          `INSERT INTO messages (workspace_id, campaign_id, contact_id, email)
       VALUES ($1, $2, gen_random_uuid(), 'x@example.test')`,
          [f.workspaceId, f.campaignId],
        ),
      'sender vložil zprávu:',
    );
  });

  it('sender NESMÍ přepsat created_at (invariant I1)', async () => {
    const f = await seedCampaignWithMessage();
    await expectPermissionDenied(
      () =>
        h
          .as('mlain_sender')
          .query(`UPDATE messages SET created_at = now() WHERE id = $1`, [f.messageId]),
      'sender přepsal created_at:',
    );
  });

  it('sender NESMÍ přepsat render_data ani email', async () => {
    const f = await seedCampaignWithMessage();
    for (const column of ['render_data', 'email']) {
      const value = column === 'render_data' ? `'{}'::jsonb` : `'jiny@example.test'`;
      await expectPermissionDenied(
        () =>
          h
            .as('mlain_sender')
            .query(`UPDATE messages SET ${column} = ${value} WHERE id = $1`, [f.messageId]),
        `sender přepsal ${column}:`,
      );
    }
  });

  it('sender SMÍ inkrementovat ambiguous_count (bez toho je reaper neproveditelný)', async () => {
    const f = await seedCampaignWithMessage();
    const r = await h.as('mlain_sender').query(
      `UPDATE messages SET ambiguous_count = ambiguous_count + 1, updated_at = now()
        WHERE id = $1 AND created_at = $2`,
      [f.messageId, f.createdAt],
    );
    expect(r.rowCount).toBe(1);
  });

  it('sender SMÍ pozastavit kampaň ze stavu sending i queueing (scénář OB-16)', async () => {
    const f = await seedCampaignWithMessage();
    const reason = JSON.stringify({
      code: 'provider_quota_exhausted',
      source: 'sender',
      detail: 'SES daily quota reached',
      sender_id: 'mlain-ws-7f3a',
      at: '2026-07-31T14:22:31Z',
    });
    const r = await h.as('mlain_sender').query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
        WHERE id = $1 AND status IN ('queueing','sending')`,
      [f.campaignId, reason],
    );
    expect(r.rowCount).toBe(1);

    // Tentýž UPDATE na už pozastavené kampani ovlivní 0 řádků a NENÍ to chyba.
    const again = await h.as('mlain_sender').query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
        WHERE id = $1 AND status IN ('queueing','sending')`,
      [f.campaignId, reason],
    );
    expect(again.rowCount).toBe(0);
  });

  it('sender NESMÍ změnit jiný sloupec campaigns než status a pause_reason (OB-17)', async () => {
    const f = await seedCampaignWithMessage();
    await expectPermissionDenied(
      () =>
        h
          .as('mlain_sender')
          .query(`UPDATE campaigns SET subject = 'podvrzeno' WHERE id = $1`, [f.campaignId]),
      'sender přepsal subject:',
    );
    await expectPermissionDenied(
      () =>
        h
          .as('mlain_sender')
          .query(`UPDATE campaigns SET compiled_html = '<p>x</p>' WHERE id = $1`, [f.campaignId]),
      'sender přepsal compiled_html:',
    );
  });

  it('sender SMÍ vložit událost do message_events', async () => {
    // `rank` ve výčtu SCHVÁLNĚ NENÍ: je to generovaný sloupec (rozhodnutí R32)
    // a explicitní hodnota by skončila chybou „cannot insert a non-DEFAULT
    // value". Sender ho tedy nemá jak uvést špatně, což je celý smysl změny.
    const f = await seedCampaignWithMessage();
    const r = await h.as('mlain_sender').query(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
                                   campaign_id, contact_id, recipient, type,
                                   ts, source)
       SELECT $1, $2, $3, $4, m.contact_id, m.email, 'circuit_breaker_open', now(), 'internal'
         FROM messages m WHERE m.id = $2 AND m.created_at = $3`,
      [f.workspaceId, f.messageId, f.createdAt, f.campaignId],
    );
    expect(r.rowCount).toBe(1);
  });

  it('sender NESMÍ číst ani měnit message_events, má jen INSERT', async () => {
    await seedCampaignWithMessage();
    await expectPermissionDenied(
      () => h.as('mlain_sender').query('SELECT * FROM message_events'),
      'sender čte message_events:',
    );
  });

  it('sender SMÍ zapsat agregované varování renderu přes ON CONFLICT DO UPDATE', async () => {
    // Tenhle zápis dřív neprošel NIKDY: grant byl, politika sender_bypass ne.
    // Sender by dostal nejdřív permission denied (ON CONFLICT DO UPDATE čte
    // existující řádek, potřebuje tedy i SELECT) a po jejím doplnění
    // "new row violates row-level security policy". Report varování by byl
    // vždy prázdný a nikdo by nevěděl proč, protože sender chybu jen loguje.
    const f = await seedCampaignWithMessage();
    const zapis = () =>
      h.as('mlain_sender').query(
        `INSERT INTO campaign_render_warnings
         (workspace_id, campaign_id, code, path, count, sample)
       VALUES ($1, $2, 'missing_value', 'contact.attributes.city', 1, '[]'::jsonb)
       ON CONFLICT (workspace_id, campaign_id, code, path)
       DO UPDATE SET count = campaign_render_warnings.count + 1, last_seen_at = now()`,
        [f.workspaceId, f.campaignId],
      );

    await expect(zapis()).resolves.toBeDefined();
    // Druhý průchod jde větví DO UPDATE, tedy tou, která potřebuje SELECT.
    await expect(zapis()).resolves.toBeDefined();

    const { rows } = await h
      .as('mlain_migrator')
      .query<{ count: string }>(
        `SELECT count FROM campaign_render_warnings WHERE campaign_id = $1`,
        [f.campaignId],
      );
    expect(Number(rows[0]!.count)).toBe(2);
  });

  it('sender NESMÍ označit kampaň za odeslanou ani ji zrušit (jen pozastavit)', async () => {
    // Sloupcový grant říká, DO KTERÝCH sloupců smí sender psát, ne jakou
    // hodnotu. Bez WITH CHECK na politice sender_bypass by šlo nastavit
    // status = 'sent' a kampaň by se tvářila jako doběhlá.
    const f = await seedCampaignWithMessage();
    for (const status of ['sent', 'cancelled', 'draft']) {
      await expectRlsViolation(
        () =>
          h
            .as('mlain_sender')
            .query(`UPDATE campaigns SET status = $2 WHERE id = $1`, [f.campaignId, status]),
        `sender nastavil kampani status ${status}:`,
      );
    }
  });

  it('claim nevrátí nic, když je kampaň pozastavená (OB-05)', async () => {
    const f = await seedCampaignWithMessage();
    await h
      .as('mlain_migrator')
      .query(`UPDATE campaigns SET status = 'paused' WHERE id = $1`, [f.campaignId]);
    // Podmínka na id je proti plánu navíc: soubor sdílí jednu databázi, takže
    // předchozí testy nechaly v tabulce vlastní kampaně ve stavu sending
    // a nefiltrovaný dotaz by vracel je, ne odpověď na tuhle otázku.
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.id = $1
          AND c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`,
      [f.campaignId],
    );
    expect(rows).toHaveLength(0);
  });

  it('claim nevrátí nic, když je workspace měkce smazaný (OB-06)', async () => {
    const f = await seedCampaignWithMessage();
    await h
      .as('mlain_migrator')
      .query(`UPDATE workspaces SET deleted_at = now() WHERE id = $1`, [f.workspaceId]);
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.id = $1
          AND c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`,
      [f.campaignId],
    );
    expect(rows).toHaveLength(0);
  });

  it('claim nevrátí nic, když je kampaň měkce smazaná ve stavu sending (OB-18)', async () => {
    const f = await seedCampaignWithMessage();
    await h
      .as('mlain_migrator')
      .query(`UPDATE campaigns SET deleted_at = now() WHERE id = $1`, [f.campaignId]);
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.id = $1
          AND c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`,
      [f.campaignId],
    );
    expect(rows).toHaveLength(0);
  });
});
