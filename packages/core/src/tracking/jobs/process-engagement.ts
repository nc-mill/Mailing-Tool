import { v7 as uuidv7 } from 'uuid';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { OPEN_CLASS_BIT, SYSTEM_CLICK_SUBTYPE, type ClickClass, type OpenClass } from '../types';
import { OPEN_DEDUP_WINDOW_SECONDS } from '../config';
import { ScannerWindow, reclassifyClicks } from '../click/classify-click';
import { isVerifiedOpenClass } from '../open/classify-open';
import { trackingLogger } from '../logging';
import { selectMessageExact } from '../repo/messages.repo';
import { withTrackingTx } from '../repo/tx';
import {
  applyBucketDelta,
  applyCampaignStatsDelta,
  applyContactEngagementDelta,
  applyLinkStatsDelta,
  selectMessageEventsByIds,
  upsertMessageEngagement,
  type BucketDeltaRow,
  type CampaignStatsDelta,
  type EngagementDelta,
  type LinkStatsDeltaRow,
} from '../repo/engagement.repo';
import {
  insertWebEvents,
  selectMeasurementWithdrawn,
  type WebEventInsert,
} from '../repo/web-events.repo';
import { enqueueTrackingJob } from './enqueue';

export const PROCESS_ENGAGEMENT_QUEUE = 'tracking.process_engagement';

/**
 * Náklad fronty. Jména polí odpovídají registru P01 (`payloadFields`).
 *
 * `workspaceId` v nákladu není redundance. Bez něj by job musel číst
 * `message_events` napříč projekty, což pod rolí `mlain_app` znamená NULA řádků
 * (politika `ws_isolation` porovnává s nenastaveným `mlain.workspace_id`),
 * takže by úloha skončila úspěchem a nic by nespočítala.
 */
export type ProcessEngagementJobData = { workspaceId: string; eventIds: string[] };

/** Šířka bloku v grafu průběhu, viz 3.9.2 části 5. */
const BUCKET_MS = 300_000;

/**
 * Okno pravidla 6 (jedna IP otevřela tři různé odkazy téže zprávy do minuty)
 * přežívá mezi běhy jobu v paměti workeru. Restart ho ztratí, což vede
 * k několika falešným lidským proklikům. Zapsaný a přijatý kompromis, viz 3.5.
 */
const scannerWindow = new ScannerWindow();

/** Zařazení agregace hned po zápisu událostí, ve stejné transakci. */
export async function enqueueProcessEngagement(
  tx: Parameters<typeof enqueueTrackingJob>[0],
  data: ProcessEngagementJobData,
): Promise<void> {
  if (data.eventIds.length === 0) return;
  await enqueueTrackingJob(tx, PROCESS_ENGAGEMENT_QUEUE, {
    workspaceId: data.workspaceId,
    eventIds: data.eventIds,
  });
}

function emptyDelta(): CampaignStatsDelta {
  return {
    opensTotal: 0,
    opensUnique: 0,
    opensUniqueHuman: 0,
    opensUniqueApple: 0,
    clicksTotal: 0,
    clicksUnique: 0,
    clicksUniqueHuman: 0,
    clicksScanner: 0,
    firstEventAt: null,
    lastEventAt: null,
  };
}

/**
 * Obsluha fronty `tracking.process_engagement`.
 *
 * Tohle je ten článek řetězu, který v produktu CHYBĚL. Pixel i přesměrování
 * prokliku zapisovaly do `message_events` správně, jenže z těch řádků nikdo
 * nepočítal souhrn, takže report ukazoval samé nuly a vypadalo to, jako by
 * se neměřilo vůbec nic.
 *
 * Deset kroků podle 3.9.2 části 5:
 *  1. načtení událostí dávky
 *  2. dohledání `messages.sent_at` kvůli pravidlu 5 klasifikace prokliku
 *  3. doklasifikace prokliků pravidly 5 a 6
 *  4. seskupení podle zprávy
 *  5. upsert `message_engagement`, který vrátí PŘECHODY stavu
 *  6. přírůstky do `campaign_stats` z přechodů, ne z délky dávky
 *  7. statistika odkazů a pětiminutové bloky
 *  8. rollup na kontakt
 *  9. položky do jednotné časové osy
 * 10. odchozí události `message.opened` a `message.clicked`
 */
export async function handleProcessEngagement(data: ProcessEngagementJobData): Promise<void> {
  const events = await selectMessageEventsByIds({
    workspaceId: data.workspaceId,
    ids: data.eventIds,
  });
  if (events.length === 0) return;

  // 2. `sent_at` je vstup pravidla 5: proklik do pěti sekund od odeslání
  // neudělal člověk, ale bezpečnostní skener poskytovatele.
  const sentAtByMessage: Record<string, Date> = {};
  const seenMessages = new Set<string>();
  for (const event of events) {
    if (seenMessages.has(event.messageId)) continue;
    seenMessages.add(event.messageId);
    const message = await selectMessageExact({
      workspaceId: event.workspaceId,
      messageId: event.messageId,
      createdAtSeconds: Math.floor(event.messageCreatedAt.getTime() / 1000),
    });
    if (message?.sentAt != null) sentAtByMessage[event.messageId] = new Date(message.sentAt);
  }

  // 3. doklasifikace prokliků
  //
  // Systémové prokliky (patička: odhlášení, předvolby, zobrazení v prohlížeči)
  // se do doklasifikace NEPOSÍLAJÍ. Nemají `link_id`, takže by do okna pravidla 6
  // („jedna IP otevřela tři různé odkazy téže zprávy do minuty") vstupovaly
  // všechny pod prázdným identifikátorem a slévaly se v jeden odkaz. Do souhrnu
  // se stejně nezapočítají, viz SYSTEM_CLICK_SUBTYPE, takže je to jen úklid
  // vstupu, ne změna výsledku.
  const clickEvents = events.filter(
    (e) => e.type === 'click' && e.subtype !== SYSTEM_CLICK_SUBTYPE,
  );
  const reclassified = reclassifyClicks(
    clickEvents.map((e) => ({
      messageId: e.messageId,
      linkId: e.linkId ?? '',
      ip: typeof e.metadata['ip'] === 'string' ? (e.metadata['ip'] as string) : null,
      occurredAt: new Date(e.ts),
      clickClass: e.subtype as ClickClass,
    })),
    sentAtByMessage,
    scannerWindow,
  );
  const classByEvent = new Map<string, ClickClass>();
  clickEvents.forEach((event, index) => {
    classByEvent.set(event.id, reclassified[index]?.clickClass ?? 'human');
  });

  // 4. seskupení podle zprávy
  //
  // Systémový proklik se do souhrnu nepromítá nijak, takže se sem nedostane
  // vůbec. Kdyby se dostal, založil by pro zprávu prázdný přírůstek, ten by
  // proběhl celým zbytkem jobu s nulami a zvedl `campaign_stats.version` bez
  // jediné změněné hodnoty. Viditelnost systémového prokliku zajišťuje jeho
  // řádek v `message_events`, ze kterého čte časová osa i `readSystemLinkClicks`.
  const byMessage = new Map<string, EngagementDelta>();
  for (const event of events) {
    if (event.type === 'click' && event.subtype === SYSTEM_CLICK_SUBTYPE) continue;
    const createdAt = new Date(event.messageCreatedAt);
    const key = `${event.messageId}:${createdAt.toISOString()}`;
    const delta = byMessage.get(key) ?? {
      messageId: event.messageId,
      createdAt,
      workspaceId: event.workspaceId,
      campaignId: event.campaignId,
      contactId: event.contactId,
      opens: [],
      clicks: [],
    };
    if (event.type === 'open') {
      delta.opens.push({ at: new Date(event.ts), cls: event.subtype as OpenClass });
    } else if (event.linkId !== null) {
      delta.clicks.push({
        at: new Date(event.ts),
        cls: classByEvent.get(event.id) ?? 'human',
        linkId: event.linkId,
      });
    }
    byMessage.set(key, delta);
  }

  const perCampaign = new Map<string, { workspaceId: string; delta: CampaignStatsDelta }>();
  const linkDeltas = new Map<string, Map<string, LinkStatsDeltaRow>>();
  const bucketDeltas = new Map<string, Map<number, BucketDeltaRow>>();
  const timelineRows: WebEventInsert[] = [];
  const webhooks: { type: string; payload: Record<string, unknown> }[] = [];
  const contactRollups: { contactId: string; openedAt: Date | null; clickedAt: Date | null }[] = [];

  for (const delta of byMessage.values()) {
    const transition = await upsertMessageEngagement(delta, OPEN_DEDUP_WINDOW_SECONDS);

    const humanClicks = delta.clicks.filter((c) => c.cls === 'human');
    const scannerClicks = delta.clicks.filter((c) => c.cls !== 'human');

    // „Jen Apple" znamená, že zpráva má POUZE otevření přes Apple Mail Privacy
    // Protection. Jakmile dorazí lidské otevření, číslo se musí SNÍŽIT: je to
    // jediné místo v produktu, kde se do agregátu posílá záporný přírůstek.
    const onlyApple = (mask: number): boolean => mask === OPEN_CLASS_BIT.proxy_apple;
    const becameAppleOnly =
      onlyApple(transition.openClassMaskAfter) && !onlyApple(transition.openClassMaskBefore);
    const stoppedBeingAppleOnly =
      onlyApple(transition.openClassMaskBefore) && !onlyApple(transition.openClassMaskAfter);

    const entry = perCampaign.get(delta.campaignId) ?? {
      workspaceId: delta.workspaceId,
      delta: emptyDelta(),
    };

    entry.delta.opensTotal += transition.openCountDelta;
    if (transition.firstOpen) entry.delta.opensUnique += 1;
    if (transition.firstHumanOpen) entry.delta.opensUniqueHuman += 1;
    if (becameAppleOnly) entry.delta.opensUniqueApple += 1;
    if (stoppedBeingAppleOnly) entry.delta.opensUniqueApple -= 1;
    entry.delta.clicksTotal += transition.clickCountDelta;
    if (transition.firstClick) entry.delta.clicksUnique += 1;
    if (transition.firstHumanClick) entry.delta.clicksUniqueHuman += 1;
    entry.delta.clicksScanner += scannerClicks.length;

    const times = [...delta.opens.map((o) => o.at), ...delta.clicks.map((c) => c.at)];
    for (const at of times) {
      const first = entry.delta.firstEventAt;
      const last = entry.delta.lastEventAt;
      entry.delta.firstEventAt = first === null || at < first ? at : first;
      entry.delta.lastEventAt = last === null || at > last ? at : last;
    }
    perCampaign.set(delta.campaignId, entry);

    // 7. statistika odkazů
    const links = linkDeltas.get(delta.campaignId) ?? new Map<string, LinkStatsDeltaRow>();
    for (const click of delta.clicks) {
      const row = links.get(click.linkId) ?? {
        linkId: click.linkId,
        total: 0,
        uniqueClicks: 0,
        human: 0,
      };
      row.total += 1;
      if (transition.newLinkIds.includes(click.linkId)) row.uniqueClicks += 1;
      if (click.cls === 'human') row.human += 1;
      links.set(click.linkId, row);
    }
    linkDeltas.set(delta.campaignId, links);

    // 7. pětiminutové bloky. Blok se posílá JEN u přechodu, jinak by graf
    // narostl o každé opakované stažení pixelu, které se do souhrnu nepočítá.
    const buckets = bucketDeltas.get(delta.campaignId) ?? new Map<number, BucketDeltaRow>();
    const bump = (at: Date, opens: number, clicks: number): void => {
      const bucketAt = Math.floor(at.getTime() / BUCKET_MS) * BUCKET_MS;
      const row = buckets.get(bucketAt) ?? {
        bucketAt: new Date(bucketAt),
        opensUnique: 0,
        clicksUnique: 0,
      };
      row.opensUnique += opens;
      row.clicksUnique += clicks;
      buckets.set(bucketAt, row);
    };
    if (transition.firstOpen && delta.opens[0] !== undefined) bump(delta.opens[0].at, 1, 0);
    if (transition.firstClick && delta.clicks[0] !== undefined) bump(delta.clicks[0].at, 0, 1);
    bucketDeltas.set(delta.campaignId, buckets);

    // 9. jednotná časová osa. Apple proxy se do ní nezapisuje: otevření, které
    // udělal stroj kvůli předzásobení obrázků, není událost kontaktu.
    for (const open of delta.opens) {
      if (!isVerifiedOpenClass(open.cls)) continue;
      timelineRows.push({
        id: uuidv7(),
        occurredAt: open.at,
        workspaceId: delta.workspaceId,
        name: 'email_opened',
        contactId: delta.contactId,
        source: 'email',
        properties: { campaign_id: delta.campaignId, open_class: open.cls },
      });
    }
    for (const click of delta.clicks) {
      timelineRows.push({
        id: uuidv7(),
        occurredAt: click.at,
        workspaceId: delta.workspaceId,
        name: 'email_clicked',
        contactId: delta.contactId,
        source: 'email',
        properties: {
          campaign_id: delta.campaignId,
          link_id: click.linkId,
          click_class: click.cls,
        },
      });
    }

    // 10. odchozí události, jen při PRVNÍM přechodu na zprávu
    if (transition.firstHumanOpen) {
      webhooks.push({
        type: 'message.opened',
        payload: {
          message_id: delta.messageId,
          message_created_at: delta.createdAt.toISOString(),
          campaign_id: delta.campaignId,
          contact_id: delta.contactId,
          open_class: delta.opens[0]?.cls ?? 'human',
          implied_from_click: transition.impliedOpenFromClick,
        },
      });
    }
    if (transition.firstHumanClick && humanClicks[0] !== undefined) {
      webhooks.push({
        type: 'message.clicked',
        payload: {
          message_id: delta.messageId,
          message_created_at: delta.createdAt.toISOString(),
          campaign_id: delta.campaignId,
          contact_id: delta.contactId,
          link_id: humanClicks[0].linkId,
          occurred_at: humanClicks[0].at.toISOString(),
        },
      });
    }

    // 8. rollup na kontakt
    if (delta.contactId !== null && (transition.firstHumanOpen || transition.firstHumanClick)) {
      contactRollups.push({
        contactId: delta.contactId,
        openedAt: transition.firstHumanOpen ? (delta.opens[0]?.at ?? null) : null,
        clickedAt: transition.firstHumanClick ? (humanClicks[0]?.at ?? null) : null,
      });
    }
  }

  for (const [campaignId, entry] of perCampaign) {
    const scope = { workspaceId: entry.workspaceId, campaignId };
    await applyCampaignStatsDelta(scope, entry.delta);
    await applyLinkStatsDelta(scope, [...(linkDeltas.get(campaignId)?.values() ?? [])]);
    await applyBucketDelta(scope, [...(bucketDeltas.get(campaignId)?.values() ?? [])]);
  }

  await withTrackingTx(
    { workspaceId: data.workspaceId, job: PROCESS_ENGAGEMENT_QUEUE },
    async (tx) => {
      /**
       * SOUHLAS S MĚŘENÍM PLATÍ I NA OTEVŘENÍ A PROKLIKY.
       *
       * Bez tohohle kroku by přepínač na detailu kontaktu lhal na téže
       * obrazovce, na které stojí: vypnuté měření by zastavilo webové události,
       * ale do časové osy o kus vedle by dál přibývala „Otevřel e-mail".
       *
       * ZAHAZUJE SE JEN OSOBNÍ ATRIBUCE, ne měření kampaně. `message_events`,
       * statistika kampaně, míra otevření i klasifikace zůstávají: to je
       * souhrn o zásilce, ne profil člověka, a řídí ho `campaigns.track_opens`
       * s `track_clicks`. Kdyby se odečítalo i odtud, jeden odvolaný souhlas
       * by měnil čísla už odeslané kampaně a report by přestal sedět sám se
       * sebou.
       */
      const withdrawn = await selectMeasurementWithdrawn(
        tx,
        data.workspaceId,
        [
          ...timelineRows.map((row) => row.contactId),
          ...contactRollups.map((rollup) => rollup.contactId),
        ].filter((id): id is string => id !== null),
      );

      await insertWebEvents(
        tx,
        data.workspaceId,
        timelineRows.filter((row) => row.contactId === null || !withdrawn.has(row.contactId)),
      );
      for (const rollup of contactRollups) {
        if (withdrawn.has(rollup.contactId)) continue;
        await applyContactEngagementDelta(tx, {
          workspaceId: data.workspaceId,
          contactId: rollup.contactId,
          openedAt: rollup.openedAt,
          clickedAt: rollup.clickedAt,
        });
      }
      for (const hook of webhooks) {
        const eventId = await emitWebhookEvent(tx, {
          workspaceId: data.workspaceId,
          type: hook.type,
          occurredAt: new Date(),
          data: hook.payload,
        });
        // Bez zařazení fan-outu by událost v tabulce jen ležela: `fanoutEvent`
        // volá výhradně job `platform.webhook_fanout` a ten se sám nezařadí.
        await enqueueTrackingJob(tx, 'platform.webhook_fanout', {
          event_id: eventId,
          workspace_id: data.workspaceId,
        });
      }
    },
  );

  trackingLogger().debug(
    {
      job: PROCESS_ENGAGEMENT_QUEUE,
      workspace_id: data.workspaceId,
      events: events.length,
      messages: byMessage.size,
      campaigns: perCampaign.size,
    },
    'zapojení zpracováno',
  );
}
