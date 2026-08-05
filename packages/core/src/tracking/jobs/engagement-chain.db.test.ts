import { beforeAll, describe, expect, it } from 'vitest';
import { buildToken } from '@mlain/contracts/token';
import { createSystemContext } from '../../identity/context';
import { readCampaignStats } from '../../reports/campaign-stats/read';
import { compareWithStored } from '../../reports/campaign-stats/recompute';
import { withWorkspace } from '../../tx';
import { LinkCache } from '../click/link-cache';
import { createClickHandler } from '../click/handle-click';
import { TrackingDomainCache } from '../domains/domain-cache';
import { createOpenHandler } from '../open/handle-open';
import { ProxyRangeIndex } from '../open/proxy-ranges';
import { buildTrackingKeyring, currentTrackingKeyId } from '../tokens/keyring';
import { toContractFields } from '../tokens/codec';
import { lookupMessage } from '../tokens/message-lookup';
import { flushTrackingEvents, type BufferedTrackingEvent } from '../writer/flush';
import { recordCampaignUnsubscribe } from '../unsubscribe/record';
import { asMigrator, seedCampaign, seedCampaignLink, seedMessage } from '../test/support/db';
import { refreshCampaignProgress } from './refresh-campaign-progress';
import { handlers } from './queue-handlers';

/**
 * CELÝ ŘETĚZ MĚŘENÍ, od požadavku poštovního klienta až po číslo na reportu.
 *
 * Tenhle test existuje kvůli konkrétní vadě: každý jednotlivý článek řetězu měl
 * vlastní zelené testy a fungoval, jenže NIKDO nezkusil řetěz celý. Token se
 * ověřoval, otevření se klasifikovalo, řádek v `message_events` vznikl, souhrn
 * `campaign_stats` uměl číst i přepočítat, a přesto ukazoval report samé nuly:
 * mezi zápisem události a souhrnem chyběl článek, který jedno převádí na druhé.
 * Test proto jde POSTUPNĚ přes všechny články a nikde nic nepodstrkuje:
 *
 *   podepsaný token -> handler /t/o/ a /t/c/ -> buffer -> zápis do databáze
 *   -> SKUTEČNÁ fronta pg-boss (tabulka pgboss.job) -> obsluha z generované
 *   mapy workeru -> campaign_stats -> readCampaignStats
 *
 * Jediné, co se tu simuluje, je pg-boss worker: úloha se z `pgboss.job` vyzvedne
 * dotazem a předá se TÉŽE obsluze, kterou by jí předal worker. Spouštět
 * v jednotkovém testu celou smyčku pg-boss by znamenalo testovat knihovnu.
 */

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const keyring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
const keyId = currentTrackingKeyId(keyring);

/**
 * Datum se počítá z aktuálního času, ne z pevného řetězce.
 *
 * `messages` je dělená podle `created_at` a `platform.maintain_partitions`
 * zakládá oddíly pro aktuální a tři následující měsíce. Pevné datum z minulosti
 * by test shodilo chybou „no partition of relation messages found for row"
 * v okamžiku, kdy se čas přehoupne přes jeho oddíl, tedy někdy měsíc po napsání.
 *
 * Zarovnává se na celé sekundy: token nese `message_created_at` jako uint32
 * v sekundách a rovnostní dohledání zprávy porovnává právě proti němu.
 */
const AUDIENCE_BUILT_AT = new Date(Math.floor((Date.now() - 3_600_000) / 1000) * 1000);
const CREATED_AT_SECONDS = Math.floor(AUDIENCE_BUILT_AT.getTime() / 1000);
const HUMAN_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

function openToken(workspaceId: string, messageId: string): string {
  const contract = toContractFields({
    type: 'o',
    workspaceId,
    messageId,
    messageCreatedAt: CREATED_AT_SECONDS,
  });
  return buildToken({ type: contract.type, keyId, fields: contract.fields, keyring }).token;
}

function clickToken(workspaceId: string, messageId: string, linkId: string): string {
  const contract = toContractFields({
    type: 'c',
    workspaceId,
    messageId,
    linkId,
    messageCreatedAt: CREATED_AT_SECONDS,
  });
  return buildToken({ type: contract.type, keyId, fields: contract.fields, keyring }).token;
}

/** Buffer, ze kterého se čte ručně: test řídí okamžik zápisu, ne časovač. */
const buffered: BufferedTrackingEvent[] = [];

const handleOpen = createOpenHandler({
  keyring,
  proxyRanges: new ProxyRangeIndex([], { useAppleRelayRanges: false }),
  push: (item) => buffered.push(item),
});

const handleClick = createClickHandler({
  keyring,
  currentKeyId: keyId,
  links: new LinkCache({ capacity: 100, ttlMs: 60_000 }),
  domains: new TrackingDomainCache({ refreshMs: 60_000 }),
  push: (item) => buffered.push(item),
  lookupContactId: async (workspaceId, messageId, createdAt) => {
    const message = await lookupMessage({ workspaceId, messageId, messageCreatedAt: createdAt });
    return message?.contactId ?? null;
  },
  isWebTrackingEnabled: () => true,
  identityTokenTtlSeconds: 900,
  contactLookupTimeoutMs: 100,
});

async function seedContact(workspaceId: string, email: string): Promise<string> {
  const { rows } = await asMigrator().query<{ id: string }>(
    `INSERT INTO contacts (workspace_id, email) VALUES ($1, $2) RETURNING id`,
    [workspaceId, email],
  );
  return rows[0]!.id;
}

/**
 * Vyzvedne úlohy z pg-boss a předá je obsluze z generované mapy workeru.
 *
 * Čte se ZE SKUTEČNÉ tabulky `pgboss.job`, ne z pole v paměti. Právě tady se
 * v produktu řetěz trhal: úloha se do fronty zařazovala (nebo spíš nezařazovala)
 * a nikdo neověřoval, že na druhém konci někdo je.
 */
async function drainQueue(name: keyof typeof handlers): Promise<number> {
  const { rows } = await asMigrator().query<{ id: string; data: unknown }>(
    `SELECT id, data FROM pgboss.job WHERE name = $1 AND state = 'created' ORDER BY created_on`,
    [name],
  );
  if (rows.length === 0) return 0;

  await handlers[name](
    rows.map((row) => ({ id: row.id, name, data: row.data as Record<string, unknown> })),
  );

  await asMigrator().query(
    `UPDATE pgboss.job SET state = 'completed', completed_on = now() WHERE id = ANY($1::uuid[])`,
    [rows.map((row) => row.id)],
  );
  return rows.length;
}

async function stats(workspaceId: string, campaignId: string) {
  const ctx = createSystemContext(workspaceId, 'test.report');
  return withWorkspace(ctx, (tx) => readCampaignStats(tx, ctx, campaignId));
}

describe('řetěz měření kampaně od pixelu po číslo v reportu', () => {
  let workspaceId: string;
  let campaignId: string;
  let openedMessage: string;
  let clickedMessage: string;
  let unsubscribedMessage: string;
  let contactA: string;
  let contactB: string;
  let contactC: string;
  const linkId = '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6099';

  beforeAll(async () => {
    ({ workspaceId, campaignId } = await seedCampaign(AUDIENCE_BUILT_AT));

    contactA = await seedContact(workspaceId, 'a@example.cz');
    contactB = await seedContact(workspaceId, 'b@example.cz');
    contactC = await seedContact(workspaceId, 'c@example.cz');

    // `sent_at` je o minutu později než odeslání, aby proklik neskončil jako
    // skener podle pravidla 5 (proklik do pěti sekund od odeslání).
    const sentAt = new Date(AUDIENCE_BUILT_AT.getTime() + 60_000);
    openedMessage = await seedMessage({
      workspaceId,
      campaignId,
      contactId: contactA,
      createdAt: AUDIENCE_BUILT_AT,
      sentAt,
    });
    clickedMessage = await seedMessage({
      workspaceId,
      campaignId,
      contactId: contactB,
      createdAt: AUDIENCE_BUILT_AT,
      sentAt,
    });
    unsubscribedMessage = await seedMessage({
      workspaceId,
      campaignId,
      contactId: contactC,
      createdAt: AUDIENCE_BUILT_AT,
      sentAt,
    });

    /**
     * Kampaň dostane odesílací účet typu `ses`, protože právě u něj je rozdíl
     * mezi „nikomu nedošlo" a „nevíme" vidět. U SMTP se doručenost dopočítává
     * z odeslaných, takže je vždycky známá a tenhle stav nemůže nastat.
     */
    const { rows: providers } = await asMigrator().query<{ id: string }>(
      `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted, status)
       VALUES ($1, 'Amazon SES', 'ses', 'x', 'ready') RETURNING id`,
      [workspaceId],
    );
    await asMigrator().query(`UPDATE campaigns SET provider_id = $1 WHERE id = $2`, [
      providers[0]!.id,
      campaignId,
    ]);

    await seedCampaignLink({
      workspaceId,
      campaignId,
      linkId,
      url: 'https://shop.example.cz/akce',
      position: 1,
    });
  });

  it('otevření pixelem se propíše až do statistiky kampaně', async () => {
    buffered.length = 0;
    handleOpen({
      token: openToken(workspaceId, openedMessage),
      userAgent: HUMAN_UA,
      method: 'GET',
      headers: { 'user-agent': HUMAN_UA },
      ip: '198.51.100.10',
      now: new Date(),
    });
    expect(buffered, 'handler otevření nic nepředal bufferu').toHaveLength(1);

    const eventIds = await flushTrackingEvents(buffered);
    expect(eventIds, 'zápis do message_events nevrátil ani jedno ID').toHaveLength(1);

    // Článek, který v produktu chyběl: bez úlohy ve frontě není co zpracovat.
    expect(await drainQueue('tracking.process_engagement')).toBe(1);

    const after = await stats(workspaceId, campaignId);
    expect(after.counts.opensUnique).toBe(1);
    expect(after.counts.opensUniqueHuman).toBe(1);
    expect(after.counts.opensTotal).toBe(1);
  });

  it('proklik započítá otevření, i když se pixel nikdy nenačetl', async () => {
    buffered.length = 0;
    const response = await handleClick({
      token: clickToken(workspaceId, clickedMessage, linkId),
      userAgent: HUMAN_UA,
      method: 'GET',
      headers: { 'user-agent': HUMAN_UA },
      ip: '198.51.100.20',
      query: '',
      now: new Date(),
    });
    expect(response.status).toBe(302);
    expect(response.location).toContain('https://shop.example.cz/akce');
    expect(buffered).toHaveLength(1);

    await flushTrackingEvents(buffered);
    expect(await drainQueue('tracking.process_engagement')).toBe(1);

    const after = await stats(workspaceId, campaignId);
    expect(after.counts.clicksUnique).toBe(1);
    expect(after.counts.clicksUniqueHuman).toBe(1);
    // Zpráva, u které se načetl jen odkaz a ne obrázek, se počítá i jako
    // otevřená. Kdo klikl, ten četl; obrázek blokuje většina poštovních klientů.
    expect(after.counts.opensUnique, 'proklik nezaložil otevření').toBe(2);
    expect(after.counts.opensUniqueHuman).toBe(2);
  });

  it('odhlášení z odkazu v kampani se objeví ve statistice té kampaně', async () => {
    const recorded = await recordCampaignUnsubscribe({
      workspaceId,
      messageId: unsubscribedMessage,
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId: contactC,
    });
    expect(recorded).toEqual({ campaignId, recorded: true });

    expect((await stats(workspaceId, campaignId)).counts.unsubscribed).toBe(1);

    // Dvojí kliknutí na tentýž odhlašovací odkaz číslo nezvedne.
    await recordCampaignUnsubscribe({
      workspaceId,
      messageId: unsubscribedMessage,
      messageCreatedAt: AUDIENCE_BUILT_AT,
      contactId: contactC,
    });
    expect((await stats(workspaceId, campaignId)).counts.unsubscribed).toBe(1);
  });

  it('průběh odesílání se počítá z outboxu, ne z událostí', async () => {
    await refreshCampaignProgress({ workspaceId, campaignId, audienceBuiltAt: AUDIENCE_BUILT_AT });

    const after = await stats(workspaceId, campaignId);
    expect(after.counts.materialized).toBe(3);
    expect(after.counts.sent).toBe(3);
    // Doručenost od poskytovatele nedorazila. Nula tady NENÍ údaj, je to
    // absence údaje, a obrazovka to musí umět rozlišit.
    expect(after.counts.delivered).toBe(0);
    expect(after.deliveredKnown).toBe(false);
  });

  it('opakované zpracování téže dávky čísla nezmění', async () => {
    const before = await stats(workspaceId, campaignId);

    buffered.length = 0;
    handleOpen({
      token: openToken(workspaceId, openedMessage),
      userAgent: HUMAN_UA,
      method: 'GET',
      headers: { 'user-agent': HUMAN_UA },
      ip: '198.51.100.10',
      now: new Date(),
    });
    const ids = await flushTrackingEvents(buffered);

    // Tatáž úloha dvakrát, přesně jako po pádu workeru mezi zpracováním
    // a potvrzením.
    const job = [
      { id: ids[0]!, name: 'tracking.process_engagement', data: { workspaceId, eventIds: ids } },
    ];
    await handlers['tracking.process_engagement'](job);
    await handlers['tracking.process_engagement'](job);
    await drainQueue('tracking.process_engagement');

    const after = await stats(workspaceId, campaignId);
    expect(after.counts.opensUnique).toBe(before.counts.opensUnique);
    expect(after.counts.clicksUnique).toBe(before.counts.clicksUnique);
  });

  it('uložený souhrn sedí s přepočtem ze zdrojových tabulek', async () => {
    const ctx = createSystemContext(workspaceId, 'test.drift');
    const drift = await withWorkspace(ctx, (tx) => compareWithStored(tx, ctx, campaignId));
    expect(drift.differences).toEqual([]);
  });
});
