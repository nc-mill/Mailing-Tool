/**
 * Ve kterých stavech se kampaň smí přejmenovat.
 *
 * Není to táž množina jako `EDITABLE_STATUSES` u obsahu a nesmí se s ní slučovat.
 * `PATCH /campaigns/{id}` pouští mimo `draft` a `schedule_missed` ještě
 * NAPLÁNOVANOU kampaň, pokud se požadavek dotkne jen klíčů z
 * `EDITABLE_WHILE_SCHEDULED` (`name`, `scheduled_at`, `schedule_timezone`).
 * Jméno je popiska pro toho, kdo kampaň spravuje; na tom, co komu odejde, nic
 * nemění, takže u naplánované kampaně není důvod ho zamykat.
 *
 * Zbytek (`queueing`, `sending`, `paused`, `sent`, `partially_sent`,
 * `cancelled`, `failed`) skončí na `campaign_locked`. Tam se úprava
 * NENABÍZÍ VŮBEC: pole, které se dá vyplnit a při odchodu z něj vyhodí chybu,
 * je horší než nadpis, o kterém je na první pohled vidět, že se upravit nedá.
 *
 * Soubor je schválně BEZ `'use client'` a bez komponent: ptá se ho i serverová
 * stránka, když rozhoduje, jestli hlavičce dát pole, nebo holý text. Kdyby to
 * bydlelo v klientské komponentě, Next.js by volání ze serveru odmítl
 * („It's not possible to invoke a function from the server"). Naměřeno v
 * prohlížeči: stránka kroku 1 spadla na chybové obrazovce, ne v testech.
 */

const RENAMABLE_STATUSES = new Set(['draft', 'schedule_missed', 'scheduled']);

/**
 * Mez z `PatchCampaignRequest` (`z.string().min(1).max(200)`) i z kroku 2.
 *
 * Bydlí tady, ne v komponentě: přejmenovat jde od 6. 8. 2026 ze dvou míst
 * (pole v hlavičce kroku 1 a nabídka „…" v seznamu) a obě musí odmítnout
 * TOTÉŽ jméno. Dvě opsané dvoustovky by se rozešly první změnou schématu.
 */
export const CAMPAIGN_NAME_MAX = 200;

/**
 * Výčet stavů je OTEVŘENÝ (v1 smí přidat hodnotu). Cokoli neznámého je proto
 * zamčené, ne otevřené dokořán: nabídnout úpravu, která na serveru spadne,
 * je horší než ji u nového stavu na chvíli nenabídnout.
 */
export function canRenameCampaign(status: string): boolean {
  return RENAMABLE_STATUSES.has(status);
}
