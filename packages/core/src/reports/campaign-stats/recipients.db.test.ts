import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createTestTx,
  startTestDatabase,
  testContext,
  type TestDatabase,
} from '../test-support/db';
import {
  seedCampaign,
  seedContact,
  seedMessageEvent,
  seedWorkspace,
} from '../test-support/fixtures';
import { readCampaignRecipients } from './recipients';

describe('readCampaignRecipients', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedMessage(
    workspaceId: string,
    campaignId: string,
    createdAt: Date,
    contactId: string | null,
    engagement?: {
      firstOpenAt?: string;
      firstHumanOpenAt?: string;
      firstClickAt?: string;
      firstHumanClickAt?: string;
      openMask?: number;
      erased?: boolean;
    },
  ) {
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6)`,
      [messageId, workspaceId, campaignId, contactId ?? randomUUID(), 'x@example.cz', createdAt],
    );
    if (engagement) {
      await db.pool.query(
        `INSERT INTO message_engagement
           (message_id, created_at, workspace_id, campaign_id, contact_id, erased_at,
            first_open_at, first_human_open_at, open_count, open_class_mask,
            first_click_at, first_human_click_at, click_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          messageId,
          createdAt,
          workspaceId,
          campaignId,
          engagement.erased ? null : contactId,
          engagement.erased ? new Date() : null,
          engagement.firstOpenAt ?? null,
          engagement.firstHumanOpenAt ?? null,
          engagement.firstOpenAt ? 1 : 0,
          engagement.openMask ?? 0,
          engagement.firstClickAt ?? null,
          engagement.firstHumanClickAt ?? null,
          engagement.firstClickAt ? 1 : 0,
        ],
      );
    }
    return messageId;
  }

  it('vrátí i příjemce bez jediné události pod filtrem not_opened', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'ticho@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);

    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'not_opened',
      limit: 50,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      email: 'ticho@example.cz',
      firstOpenAt: null,
      contactState: 'active',
    });
    expect(page.hasMore).toBe(false);
  });

  it('filtr machine_open_only vrací jen zprávy, kde je otevření výhradně automatické', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const apple = await seedContact(db, ws.workspaceId, { email: 'apple@example.cz' });
    const human = await seedContact(db, ws.workspaceId, { email: 'human@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, apple, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 2,
    });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, human, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1 | 2,
    });

    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'machine_open_only',
      limit: 50,
    });
    expect(page.items.map((i) => i.email)).toEqual(['apple@example.cz']);
    expect(page.items[0]?.openReliability).toBe('machine');
  });

  it('smazaný kontakt se zobrazí jako řádek bez osobních údajů, ne jako pád', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'pryc@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1,
      erased: true,
    });
    await db.pool.query(`DELETE FROM contacts WHERE id = $1`, [contact]);

    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'opened',
      limit: 50,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      contactId: null,
      email: null,
      name: null,
      contactState: 'erased',
    });
  });

  it('anonymizovaný kontakt zůstane v seznamu s náhradními údaji, ne s prázdnem', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'anonym@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1,
    });
    // Tvar anonymizace vlastní P07: řádek zůstává, osobní údaje mizí.
    await db.pool.query(
      `UPDATE contacts
          SET anonymized_at = now(), first_name = NULL, last_name = NULL,
              email = ('erased+' || id || '@erased.invalid')::citext
        WHERE id = $1`,
      [contact],
    );

    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'opened',
      limit: 50,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      contactId: contact,
      email: null,
      name: null,
      contactState: 'erased',
    });
    expect(page.items[0]?.openCount).toBe(1);
  });

  it('stránkuje kurzorem a nevrací položku dvakrát', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    for (let i = 0; i < 5; i += 1) {
      const contact = await seedContact(db, ws.workspaceId, { email: `p${i}@example.cz` });
      await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    }
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const first = await readCampaignRecipients(tx, ctx, {
      campaignId: campaign.campaignId,
      filter: 'all',
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await readCampaignRecipients(tx, ctx, {
      campaignId: campaign.campaignId,
      filter: 'all',
      limit: 2,
      ...(first.nextCursor ? { cursor: first.nextCursor } : {}),
    });
    const overlap = first.items.filter((a) =>
      second.items.some((b) => b.messageId === a.messageId),
    );
    expect(overlap).toEqual([]);
  });

  it('filtr bounced čte z událostí a nevrací zprávu dvakrát ani při obou tvrdostech', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'odraz@example.cz' });
    const messageId = await seedMessage(
      ws.workspaceId,
      campaign.campaignId,
      campaign.audienceBuiltAt,
      contact,
    );
    // Tvrdost odrazu nese TYP, ne subtype (R19). Zapisuje se přes seedMessageEvent,
    // který doplní povinný `source` a adresu vyžadovanou ck_message_events__recipient.
    for (const type of ['bounced_soft', 'bounced_hard']) {
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        recipient: 'odraz@example.cz',
      });
    }
    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'bounced',
      limit: 50,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.email).toBe('odraz@example.cz');
  });

  it('filtr complained najde stížnost pod jménem, které schéma zná', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'stiznost@example.cz' });
    const messageId = await seedMessage(
      ws.workspaceId,
      campaign.campaignId,
      campaign.audienceBuiltAt,
      contact,
    );
    await seedMessageEvent(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      messageId,
      messageCreatedAt: campaign.audienceBuiltAt,
      contactId: contact,
      type: 'complained',
      recipient: 'stiznost@example.cz',
    });
    const page = await readCampaignRecipients(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      filter: 'complained',
      limit: 50,
    });
    expect(page.items.map((i) => i.email)).toEqual(['stiznost@example.cz']);
  });

  it('stránka příjemců se čte z indexu, ne přes řazení celého oddílu (R20)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    // POČET ŘÁDKŮ JE SOUČÁST TVRZENÍ, ne libovolná konstanta.
    //
    // Původních čtyřicet nestačilo ani s `ANALYZE`: rozdíl v odhadované ceně
    // mezi průchodem indexem a řazením je nad tak malou tabulkou v řádu šumu,
    // takže volba plánu kolísala podle zatížení stroje. Test padal zhruba
    // jednou ze čtyř úplných běhů, a to na jiných místech než v samostatném
    // běhu souboru, což vypadalo jako závislost na cizích datech. Nebyla to
    // ona; byla to tahle konstanta.
    //
    // Se třemi sty řádky je průchod indexem levnější řádově a plánovač nemá
    // o čem váhat. Cena je zhruba vteřina navíc, což je za stabilní tvrzení
    // o výkonnostním kontraktu levné.
    for (let i = 0; i < 300; i += 1) {
      const contact = await seedContact(db, ws.workspaceId, { email: `x${i}@example.cz` });
      await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    }
    // ANALYZE je povinný: bez čerstvých statistik se plánovač rozhoduje podle
    // odhadu z prázdné tabulky a počet řádků výš by byl k ničemu.
    await db.pool.query('ANALYZE messages');
    // DVĚ ODCHYLKY OD PLÁNU, obě vynucené tím, jak se `messages` skutečně chová.
    //
    // 1. Plán měřil plán dotazu nad čtyřiceti řádky. Nad tak malou tabulkou
    //    volí PostgreSQL sekvenční průchod VŽDY, ať index existuje, nebo ne,
    //    takže by test padal i na správném schématu a po smazání indexu by se
    //    nic nezměnilo. Sekvenční a bitmapový průchod se proto pro tenhle
    //    jediný dotaz vypnou. Tvrzení R20 zní, že uspořádání umí obsloužit
    //    index `(campaign_id, contact_id, created_at)` BEZ řazení, a přesně to
    //    se tím ověřuje: po smazání indexu zbude Sort a test padne.
    //
    // 2. Plán hledal v plánu jméno `uq_messages__campaign_contact`. To je
    //    jméno indexu na RODIČI. `messages` je partitionovaná, dotaz sáhne na
    //    oddíl a EXPLAIN vypíše jméno indexu oddílu, které si PostgreSQL
    //    odvozuje sám. Kontroluje se proto přípona se seznamem sloupců, tedy
    //    to, co je na tvrzení R20 podstatné. Uspořádání umí obsloužit dva
    //    indexy oddílu, `(campaign_id, contact_id, created_at)` z invariantu I1
    //    i `(workspace_id, contact_id, created_at DESC)` z časové osy kontaktu,
    //    a který z nich plánovač zvolí, je jeho věc. Podstatné je, že stránka
    //    jde z indexu vedeného přes `contact_id` a že v plánu není Sort.
    const client = await db.pool.connect();
    let plan: string;
    try {
      await client.query('SET enable_seqscan = off');
      await client.query('SET enable_bitmapscan = off');
      // ANALYZE je tu POVINNÝ, ne opatrnost. Plánovač se rozhoduje podle
      // statistik, a ty po čerstvém zápisu do prázdné tabulky neexistují.
      // Bez něj závisel výsledek na tom, kolik řádků po sobě nechaly SOUSEDNÍ
      // testy: v celé doméně reportů jich bylo dost a plán vyšel podle
      // očekávání, kdežto při běhu samotného souboru plánovač nad hrstkou
      // řádků zvolil jinou cestu a test spadl. Tvrzení o plánu, které platí jen
      // při určitém množství cizích dat, netestuje dotaz, ale pořadí testů.
      await client.query('ANALYZE messages');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (FORMAT TEXT)
       SELECT m.id, m.contact_id FROM messages m
        WHERE m.workspace_id = $1 AND m.campaign_id = $2 AND m.created_at = $3
        ORDER BY m.contact_id DESC LIMIT 51`,
        [ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt],
      );
      plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    } finally {
      client.release();
    }
    // Bez indexu vedeného přes contact_id by tu byl Sort nad celým oddílem.
    expect(plan).toMatch(/Index Scan[^\n]*contact_id_created_at_idx/);
    expect(plan).not.toMatch(/\bSort\b/);
  });
});
