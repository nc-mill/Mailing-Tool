import { createSystemContext } from '../../identity/context';
import { TtlLru } from '../click/lru';
import { applyIdentify, type IdentifyPayload } from '../identity/apply-identify';
import { enqueueTrackingJob } from '../jobs/enqueue';
import { trackingLogger } from '../logging';
import { markTrackingDomainVerified } from '../repo/tracking-domains.repo';
import { withTrackingTx, type Tx } from '../repo/tx';
import type { EventSource } from '../types';
import {
  ensureIdentityRow,
  insertIngestedWebEvents,
  resolveIdentity,
  selectExistingEventIds,
  touchContactActivity,
  upsertWebEventMonths,
  type IngestedWebEventInsert,
} from './web-events.repo';

/**
 * Job `event.process`, viz plán P10 Task 32.
 *
 * Tohle je článek, který z přijaté dávky dělá řádky v `web_events`. Bez něj
 * endpoint `/e/track` odpoví 202, metrika ukáže přijaté události a v databázi
 * nebude nic; vypadalo by to jako rozbité měření, přitom by to bylo
 * nezapojené zpracování.
 *
 * ODCHYLKA OD PLÁNU, UMÍSTĚNÍ: plán chtěl `tracking/jobs/event-process.ts`.
 * Soubor leží vedle zbytku příjmu v `tracking/ingest/`, protože sdílí typy
 * s `ingest-service.ts` a s `web-events.repo.ts` a jinam než sem nepatří.
 * Registrace fronty zůstává v `tracking/jobs/queue-handlers.ts`, tam ji hledá
 * codegen workeru.
 */

export const EVENT_PROCESS_QUEUE = 'event.process';

export type EventProcessJobData = {
  workspaceId: string;
  anonymousId: string | null;
  source: EventSource;
  events: {
    id: string;
    name: string;
    occurredAt: string;
    sessionId: string | null;
    page?: Record<string, unknown>;
    properties: Record<string, unknown>;
    context: Record<string, unknown>;
    /** Jen u serverové cesty a importu. */
    contactId?: string | null;
    /** Jen u události `identify`, netknutá kopie kvůli ověření podpisu. */
    identify?: IdentifyPayload;
  }[];
  /** Host, ze kterého dávka přišla. Vyplněný jen u prohlížečové cesty. */
  originHost?: string | null;
};

export type EventProcessDeps = {
  /** Zařazení navazujících úloh VE STEJNÉ transakci. Testy si sem podstrčí špióna. */
  enqueue?: (tx: Tx, queue: string, data: Record<string, unknown>) => Promise<void>;
  now?: () => Date;
  /** Zápis ověření měřicí domény. Testy si sem podstrčí špióna. */
  markDomainVerified?: (target: { workspaceId: string; host: string }) => Promise<number>;
};

/**
 * Domény, u kterých už tenhle proces ověření zapsal.
 *
 * Bez ní by každá dávka znamenala jeden `UPDATE` navíc, i když je doména dávno
 * ověřená. Časové omezení je tam schválně: kdyby se pamatovalo navždy, doména
 * smazaná a znovu přidaná by se do restartu workeru už nikdy neověřila.
 */
const VERIFIED_DOMAIN_CACHE = { capacity: 5_000, ttlMs: 10 * 60_000 } as const;
let verifiedDomains = new TtlLru<string, true>(VERIFIED_DOMAIN_CACHE);

/**
 * Jen pro testy: bez toho by si druhý test pamatoval doménu z prvního.
 * Přiřazení nové instance je tentýž postup jako u `resetPublicKeyCache`.
 */
export function resetVerifiedDomainCache(): void {
  verifiedDomains = new TtlLru<string, true>(VERIFIED_DOMAIN_CACHE);
}

/**
 * Ověření měřicí domény, viz P10. Sloupec `tracking_domains.verified_at` neměl
 * do téhle opravy žádného zapisovatele, takže v rozhraní u KAŽDÉ domény trvale
 * svítilo „Zatím neověřeno. Ověří se samo při prvním úspěšném běhu skriptu."
 * To byl slib, který produkt neplnil.
 *
 * Ověřením je PRVNÍ PŘIJATÁ DÁVKA z té domény, ne její založení. Označit doménu
 * za ověřenou hned při přidání by byl jen jiný druh nepravdy: uživatel by dál
 * nevěděl, jestli úryvek na webu skutečně běží.
 *
 * Selhání se jen zaloguje. Zpracování událostí na něm viset nesmí: neověřená
 * doména je kosmetická vada, zahozená dávka událostí není.
 */
async function verifyOriginDomain(
  workspaceId: string,
  host: string,
  mark: (target: { workspaceId: string; host: string }) => Promise<number>,
): Promise<void> {
  const key = `${workspaceId}:${host}`;
  if (verifiedDomains.get(key) !== undefined) return;

  try {
    const marked = await mark({ workspaceId, host });
    verifiedDomains.set(key, true);
    if (marked > 0) {
      trackingLogger().info({ workspaceId, host, marked }, 'tracking_domain_verified');
    }
  } catch (error) {
    trackingLogger().warn({ err: error, workspaceId, host }, 'tracking_domain_verify_failed');
  }
}

export async function handleEventProcess(
  data: EventProcessJobData,
  deps: EventProcessDeps = {},
): Promise<void> {
  const enqueue = deps.enqueue ?? enqueueTrackingJob;
  const now = deps.now?.() ?? new Date();
  const isImport = data.source === 'import';

  /**
   * Ověření domény se zapisuje PŘED uložením událostí, ne po něm, a schválně.
   * Dávka může celá vypadnout na deduplikaci, jenže i tak je to důkaz, že
   * skript na webu běží a že doména odpovídá. Kdyby zápis visel na tom, že se
   * něco uložilo, druhá návštěva téhož dne by doménu neověřila.
   */
  if (!isImport && data.originHost != null && data.originHost !== '') {
    await verifyOriginDomain(
      data.workspaceId,
      data.originHost,
      deps.markDomainVerified ?? markTrackingDomainVerified,
    );
  }

  await withTrackingTx({ workspaceId: data.workspaceId, job: EVENT_PROCESS_QUEUE }, async (tx) => {
    // 2. vyřešení identity
    let contactId: string | null = null;
    if (data.anonymousId !== null) {
      const identity = await resolveIdentity(tx, data.workspaceId, data.anonymousId);
      // Řádek se zakládá nebo aktualizuje vždy, i u známého návštěvníka:
      // `last_seen` je jediné, z čeho se pozná živý prohlížeč.
      await ensureIdentityRow(tx, data.workspaceId, data.anonymousId, now);
      if (
        identity !== null &&
        identity.contactId !== null &&
        !identity.processingRestricted &&
        identity.deletedAt === null
      ) {
        contactId = identity.contactId;
      }
      // Omezené zpracování nebo smazaný kontakt: `contact_id` se NEDOPLNÍ
      // a událost se uloží anonymně (GDPR čl. 18).
    }

    // 3. aplikační deduplikace v okně sedmi dní
    const existing = await selectExistingEventIds(
      tx,
      data.workspaceId,
      data.events.map((event) => event.id),
    );
    const seen = new Set<string>();

    const rows: IngestedWebEventInsert[] = [];
    for (const event of data.events) {
      if (existing.has(event.id) || seen.has(event.id)) continue;
      seen.add(event.id);

      const occurredAt = new Date(event.occurredAt);
      rows.push({
        id: event.id,
        occurredAt,
        // U importu padne řádek do oddílu podle času vzniku, jinak by ho dotaz
        // na loňský listopad nenašel a retence by ho zahodila jindy.
        receivedAt: isImport ? occurredAt : now,
        workspaceId: data.workspaceId,
        name: event.name,
        anonymousId: data.anonymousId,
        contactId: event.contactId ?? contactId,
        sessionId: event.sessionId,
        source: data.source,
        page: event.page ?? {},
        properties: event.properties,
        context: event.context,
      });
    }

    const insertedIds = await insertIngestedWebEvents(tx, rows);
    if (insertedIds.length === 0) return;

    const insertedSet = new Set(insertedIds);
    const inserted = rows.filter((row) => insertedSet.has(row.id));

    // 4. řídká mapa měsíců, ve kterých subjekt vůbec má data
    const months = new Map<
      string,
      { subjectKind: 'contact' | 'anonymous'; subjectId: string; month: Date }
    >();
    for (const row of inserted) {
      const month = new Date(
        Date.UTC(row.receivedAt.getUTCFullYear(), row.receivedAt.getUTCMonth(), 1),
      );
      for (const [kind, id] of [
        ['contact', row.contactId],
        ['anonymous', row.anonymousId],
      ] as const) {
        if (id === null) continue;
        months.set(`${kind}:${id}:${month.toISOString()}`, {
          subjectKind: kind,
          subjectId: id,
          month,
        });
      }
    }
    await upsertWebEventMonths(tx, data.workspaceId, [...months.values()]);

    // 6. a 7. Historická událost není aktivita a import nespouští živé reakce.
    if (isImport) return;

    const latestByContact = new Map<string, Date>();
    for (const row of inserted) {
      if (row.contactId === null) continue;
      const current = latestByContact.get(row.contactId);
      if (current === undefined || row.occurredAt > current) {
        latestByContact.set(row.contactId, row.occurredAt);
      }
    }
    for (const [id, at] of latestByContact) {
      await touchContactActivity(tx, id, at);
      /**
       * Producent fronty, kterou dnes nikdo neobsluhuje: `segments.recalc_for_contact`
       * je v registru P01 a patří doméně segmentů, ale obsluhu zatím nemá.
       * Zařazení je i tak správně, protože jinak by se segment podle chování
       * po doplnění obsluhy nikdy nedozvěděl, že se něco stalo.
       */
      await enqueue(tx, 'segments.recalc_for_contact', {
        workspaceId: data.workspaceId,
        contactId: id,
      });
    }
  });

  /**
   * 8. Volání `identify` se promítne na kontakt AŽ TEĎ, mimo transakci nad
   * událostmi, a schválně. `writeContact` i `bindIdentity` si otevírají vlastní
   * transakci a obojí je delší práce než zápis řádků; kdyby viselo uvnitř,
   * držela by se zámky nad `web_events` po celou tu dobu.
   *
   * Selhání jednoho `identify` nesmí shodit celou dávku: události jsou v tu
   * chvíli uložené a opakování jobu by je jen znovu deduplikovalo, zatímco
   * chyba by se opakovala pořád dokola.
   */
  if (isImport) return;
  for (const event of data.events) {
    if (event.identify === undefined) continue;
    try {
      const result = await applyIdentify({
        // Rozsah se vyrábí tady, z identifikátoru v payloadu jobu, a jedinou
        // schválenou továrnou. Dál už putuje jako branded kontext, takže
        // `identify.repo.ts` ani `writeContact` nedostanou holý řetězec.
        ctx: createSystemContext(data.workspaceId, 'tracking.identify'),
        anonymousId: data.anonymousId,
        payload: event.identify,
        now,
      });
      if (result.outcome !== 'applied') {
        trackingLogger().warn(
          { workspaceId: data.workspaceId, outcome: result.outcome },
          'tracking_identify_not_applied',
        );
      }
    } catch (error) {
      trackingLogger().error(
        { err: error, workspaceId: data.workspaceId },
        'tracking_identify_failed',
      );
    }
  }
}
