import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import {
  ensurePartitions,
  seedCampaign,
  seedCampaignStats,
  seedContact,
  seedWorkspace,
} from '../test-support/fixtures';
import { TileCache } from './cache';
import { readDashboard } from './read';

describe('readDashboard', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('sečte odeslané a spočítá vážené míry přes kampaně období', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    const a = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: recent });
    await seedCampaignStats(db, ws.workspaceId, a.campaignId, {
      sent: 1000,
      delivered: 1000,
      opens_unique: 500,
      opens_unique_apple: 200,
      opens_unique_human: 300,
      clicks_unique_human: 40,
      bounced_hard: 5,
      complained: 1,
    });
    const b = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: old });
    await seedCampaignStats(db, ws.workspaceId, b.campaignId, { sent: 9999, delivered: 9999 });

    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 7,
      timezone: 'Europe/Prague',
      cache: new TileCache(),
    });

    expect(result.tiles.sent).toMatchObject({ status: 'ok', data: { value: 1000 } });
    const clicks = result.tiles.click_rate;
    expect(clicks.status).toBe('ok');
    if (clicks.status === 'ok') expect(clicks.data.rate).toBeCloseTo(0.04, 10);
    const opens = result.tiles.open_rate;
    if (opens.status === 'ok') {
      expect(opens.data.rate).toBeCloseTo(0.5, 10);
      expect(opens.data.machineShare).toBeCloseTo(0.4, 10);
    }
  });

  /**
   * REGRESE: přehled hlásil „Otevřelo 185,7 %".
   *
   * Kampaň jde přes poskytovatele `ses`, od kterého na téhle instalaci nedorazí
   * ani jedna událost o osudu zprávy (odběr SNS se na `localhost` nepotvrdí).
   * Doručenost se tedy NEZNÁ, jenže přehled si ji dopočítal jako „odesláno
   * minus odrazy", a protože odrazy taky neznal, vyšel mu jmenovatel roven
   * počtu odeslaných. Otevření se přitom měří pixelem nezávisle na
   * poskytovateli a je jich klidně víc než odeslaných zpráv.
   *
   * Míra proto musí být `null`, ne velké číslo, a absolutní počty zůstávají:
   * ty naměřené jsou.
   */
  it('kampaň bez zpětné vazby od služby nedostane míru počítanou z odhadu', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      audienceBuiltAt: new Date(),
      providerType: 'ses',
    });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 14,
      delivered: 0,
      opens_unique: 26,
      clicks_unique_human: 3,
    });

    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });

    const opens = result.tiles.open_rate;
    expect(opens.status).toBe('ok');
    if (opens.status === 'ok') {
      expect(opens.data.rate).toBeNull();
      expect(opens.data.opens).toBe(26);
      expect(opens.data.unknown).toEqual({ campaigns: 1, sent: 14 });
    }
    const clicks = result.tiles.click_rate;
    if (clicks.status === 'ok') {
      expect(clicks.data.rate).toBeNull();
      expect(clicks.data.clicks).toBe(3);
    }
    // Nula odrazů z tichého poskytovatele není „v pořádku", je to „nevíme".
    const problems = result.tiles.problems;
    if (problems.status === 'ok') expect(problems.data.level).toBe('unknown');
    // Odesláno se měří u nás, takže to číslo platí dál.
    expect(result.tiles.sent).toMatchObject({ status: 'ok', data: { value: 14 } });
  });

  /**
   * Táž vada ve dlaždici posledních kampaní a v podkladu pro obrazovku
   * Statistiky. Kampaň odeslaná před chvílí ukazovala „100 %", protože se
   * tři prokliky dělily třemi odeslanými zprávami, o jejichž doručení nevíme
   * nic. Míra je proto `null` a příznak říká proč.
   */
  it('poslední kampaně nepočítají míru z dopočtené doručenosti', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, {
      audienceBuiltAt: new Date(),
      providerType: 'ses',
    });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 3,
      delivered: 0,
      clicks_unique_human: 3,
    });

    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });

    const recent = result.tiles.recent_campaigns;
    expect(recent.status).toBe('ok');
    if (recent.status === 'ok') {
      expect(recent.data.items[0]).toMatchObject({
        clickRate: null,
        deliveredKnown: false,
        clicks: 3,
      });
    }
  });

  it('kampaň se známou doručeností míru počítá dál, i když vedle stojí neznámá', async () => {
    const ws = await seedWorkspace(db);
    const known = await seedCampaign(db, ws.workspaceId, {
      audienceBuiltAt: new Date(),
      providerType: 'ses',
    });
    await seedCampaignStats(db, ws.workspaceId, known.campaignId, {
      sent: 100,
      delivered: 100,
      opens_unique: 40,
      clicks_unique_human: 10,
    });
    const silent = await seedCampaign(db, ws.workspaceId, {
      audienceBuiltAt: new Date(),
      providerType: 'ses',
    });
    await seedCampaignStats(db, ws.workspaceId, silent.campaignId, {
      sent: 50,
      delivered: 0,
      opens_unique: 5,
    });

    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });

    const opens = result.tiles.open_rate;
    if (opens.status === 'ok') {
      // 40 ze 100 doručených. Pětka z tiché kampaně do MÍRY nevstupuje,
      // protože k ní není jmenovatel, ale v absolutním počtu je vidět.
      expect(opens.data.rate).toBeCloseTo(0.4, 10);
      expect(opens.data.opens).toBe(45);
      expect(opens.data.unknown).toEqual({ campaigns: 1, sent: 50 });
    }
  });

  it('označí překročené prahy vrácení a stížností', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 1000,
      delivered: 950,
      bounced_hard: 45,
      bounced_soft: 5,
      complained: 3,
    });
    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const problems = result.tiles.problems;
    expect(problems.status).toBe('ok');
    if (problems.status === 'ok') expect(problems.data.level).toBe('bad');
  });

  it('spočítá kontakty aktivní na webu za posledních 24 hodin', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date());
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source)
       VALUES (gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web'),
              (gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web')`,
      [ws.workspaceId, contact],
    );
    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const web = result.tiles.web_active;
    expect(web.status).toBe('ok');
    if (web.status === 'ok') {
      expect(web.data.contacts).toBe(1);
      // Dvě události jednoho člověka jsou JEDEN řádek seznamu, ne dva:
      // dlaždice mluví o lidech, ne o návštěvách.
      expect(web.data.people).toHaveLength(1);
      expect(web.data.people[0]?.contactId).toBe(contact);
      expect(web.data.people[0]?.name).toBe('Jana Nováková');
      expect(web.data.people[0]?.email).toContain('@');
    }
  });

  it('kampaň bez řádku agregace z přehledu nevypadne (líné zakládání rollupu)', async () => {
    const ws = await seedWorkspace(db);
    // seedCampaign schválně NEzakládá campaign_stats: přesně tenhle stav má
    // kampaň mezi odesláním a prvním během jobu z P10.
    await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    const withStats = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    await seedCampaignStats(db, ws.workspaceId, withStats.campaignId, { sent: 100, delivered: 90 });

    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const recent = result.tiles.recent_campaigns;
    expect(recent.status).toBe('ok');
    // S `FROM campaign_stats` by tu byla jen jedna kampaň a nic by nespadlo.
    if (recent.status === 'ok') expect(recent.data.items).toHaveLength(2);
    const sent = result.tiles.sent;
    if (sent.status === 'ok') expect(sent.data.value).toBe(100);
  });

  it('dlaždice aktivity na webu se čte z indexu, ne sekvenčním průchodem oddílu', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date());
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source)
       SELECT gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web'
         FROM generate_series(1, 500)`,
      [ws.workspaceId, contact],
    );
    await db.pool.query('ANALYZE web_events');
    // ODCHYLKA OD PLÁNU, VYNUCENÁ PLÁNOVAČEM. Nad pěti sty řádky v jednom
    // oddílu je sekvenční průchod levnější než cokoliv jiného, takže by test
    // padal i se správným indexem a po jeho smazání by se plán nezměnil.
    // Sekvenční průchod se pro tenhle jediný dotaz vypne. Tvrzení zní, že
    // `idx_web_events__contact_occurred` na dotaz odpoví, a to se tím ověřuje:
    // bez indexu zbude i tak jen sekvenční průchod a test padne.
    const client = await db.pool.connect();
    let plan: string;
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (FORMAT TEXT)
       SELECT count(DISTINCT contact_id) FROM web_events
        WHERE workspace_id = $1 AND contact_id IS NOT NULL
          AND occurred_at >= now() - interval '24 hours'
          AND received_at >= now() - interval '24 hours' - interval '60 seconds'
          AND received_at <  now() + interval '7 days'`,
        [ws.workspaceId],
      );
      plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
    expect(plan).not.toMatch(/Seq Scan on web_events/);
    expect(plan).toMatch(/contact_id_occurred_at_idx/);
  });

  it('projekt bez jediné odeslané kampaně nemá míry, ale odpověď se nerozbije', async () => {
    const ws = await seedWorkspace(db);
    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const clicks = result.tiles.click_rate;
    if (clicks.status === 'ok') expect(clicks.data.rate).toBeNull();
    expect(result.tiles.recent_campaigns.status).toBe('ok');
  });

  /**
   * Čerstvá instalace: projekt existuje, ale ještě v něm neproběhla jediná
   * kampaň ani jediná návštěva webu. Prázdno je tu NORMÁLNÍ stav, ne porucha,
   * a všech šest dlaždic z něj musí umět vytěžit prázdná DATA, ne `error`.
   * Kdyby některá dlaždice spadla na dotazu (chybějící oddíl, cizí tabulka
   * bez řádku…), objeví se to tady jako `status: 'error'`, ne jako pád testu:
   * `TileCache.resolve()` chybu polyká schválně (viz `cache.ts`), takže se
   * musí kontrolovat status KAŽDÉ dlaždice zvlášť.
   */
  it('čerstvě založený projekt vrací u všech šesti dlaždic prázdná data, ne error', async () => {
    const ws = await seedWorkspace(db);
    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });

    expect(result.tiles.sent).toMatchObject({ status: 'ok', data: { value: 0 } });
    expect(result.tiles.click_rate).toMatchObject({ status: 'ok', data: { rate: null } });
    expect(result.tiles.open_rate).toMatchObject({ status: 'ok', data: { rate: null } });
    expect(result.tiles.problems).toMatchObject({
      status: 'ok',
      data: { bounceRate: null, complaintRate: null, level: 'ok' },
    });
    expect(result.tiles.web_active).toMatchObject({ status: 'ok', data: { contacts: 0 } });
    expect(result.tiles.recent_campaigns).toMatchObject({ status: 'ok', data: { items: [] } });
    expect(result.tiles.running).toMatchObject({ status: 'ok', data: { campaign: null } });
  });
});
