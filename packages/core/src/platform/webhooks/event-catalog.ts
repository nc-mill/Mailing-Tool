import type { ValidationIssue } from '../../errors/api-error';

/**
 * Uzavřený katalog typů odchozích událostí.
 *
 * JEDINÝ zdroj pravdy pro dvě věci, které se prokazatelně rozešly: co smí
 * endpoint odebírat (kontrola při zápisu, `endpoint-service.ts`) a co nabídne
 * rozhraní (`apps/web/src/features/webhooks/**`). Do doby, než tenhle soubor
 * vznikl, byla nabídka v rozhraní ručně opsaný seznam tří typů, produkt jich
 * vydával patnáct, a rozdíl se projevil jedině tak, že zaškrtnutý webhook
 * mlčky nikdy nedorazil.
 *
 * SOUBOR JE ZÁMĚRNĚ BEZ BĚHOVÝCH ZÁVISLOSTÍ. Čte ho i serverová komponenta
 * v `apps/web` a cokoli, co by sem přitáhlo konfiguraci, databázi nebo `node:`,
 * by tam spadlo při sestavení. Jediný import je typ, který se při překladu
 * vymaže.
 *
 * KDO PŘIDÁVÁ NOVOU UDÁLOST: doplnit ji sem a do `packages/i18n/messages/{cs,en}/
 * settings.json` pod `webhooks.events`. Bez zápisu tady ji nikdo nemůže odebírat,
 * takže by se doručila nikam. Hlídá to `event-catalog.test.ts`, který seznam
 * neopisuje, ale odvozuje z míst, kde se událost doopravdy vydává.
 */

/**
 * Typy, které produkt doopravdy vydává. Rozhraní nabízí přesně tenhle seznam.
 *
 * Pořadí je abecední a je to pořadí, ve kterém se typy nabízejí uvnitř skupiny.
 */
export const WEBHOOK_EVENT_TYPES = [
  'brand.extraction_completed',
  'campaign.paused',
  'campaign.resumed',
  'campaign.schedule_delayed',
  'campaign.schedule_missed',
  'campaign.sending_started',
  'campaign.sent',
  'contact.subscribed',
  'contact.suppressed',
  'contact.unsubscribed',
  'domain.verification_changed',
  'message.clicked',
  'message.opened',
  'provider.status_changed',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

/**
 * Typy, které produkt VYDÁVÁ, ale které se NEODEBÍRAJÍ.
 *
 * Zatím je tu jediný: `webhook.ping`, tedy testovací událost z tlačítka
 * „Poslat testovací událost". Doručuje se CÍLENĚ na ten endpoint, u kterého
 * člověk tlačítko zmáčkl (`deliverEventToEndpoint` v `emit.ts`), takže se
 * fan-outu ani odběru vůbec neptá. Nabízet ji k zaškrtnutí by byla lež
 * v obou směrech: zaškrtnutá by nic nezměnila a nezaškrtnutá by nic nebrala.
 *
 * PROČ TU TEDY JE. Katalog je seznam toho, co produkt vydává, a hlídací test
 * ho odvozuje ze zdrojů. Kdyby tenhle typ v katalogu nebyl, spadl by test na
 * „vydává se něco, co katalog nezná", a jediná cesta ven by byla výjimka
 * v testu. Výjimka v hlídači je horší než pojmenovaná kategorie.
 *
 * PŘEJMENOVÁNO Z `ping` NA `webhook.ping` 7. 8. Byl to jediný typ bez tečky
 * a katalog i hlídací test kolem něj musely dělat obchvat, protože sken zdrojů
 * se opírá o tvar `prefix.sloveso`. Bezpečné to bylo proto, že doručení s typem
 * `ping` NEMOHLO existovat: cesta `/test` sice událost zapsala, ale nikdy
 * nezařadila fan-out, takže řádek v `webhook_events` jen ležel. Starý tvar
 * zůstává přijímaný přes `RETIRED_WEBHOOK_EVENT_TYPES`.
 */
export const TARGETED_WEBHOOK_EVENT_TYPES = ['webhook.ping'] as const;

/**
 * Typy, které se v produktu NEVYDÁVAJÍ, ale zápis je pořád přijme.
 *
 * Nejsou to hodnoty k nabízení, jsou to hodnoty k nerozbití. Kdo je má uložené,
 * musí být schopen svůj endpoint dál upravovat, aniž by ho kontrola vyhodila.
 * Rozhraní je nenabízí, takže nový nikdo nepřidá a seznam může jen řídnout.
 *
 * Hodnota je důvod, ne omluva: říká tomu, kdo sem přijde příště, proč typ
 * zůstal. Odstranit ho jde teprve tehdy, až ho žádná instalace nemá uložený.
 */
export const RETIRED_WEBHOOK_EVENT_TYPES: Readonly<Record<string, string>> = {
  'contact.created':
    'rozhraní ho nabízelo od MVP0, ale nikdo ho nikdy nevydal; zůstává přijímaný, aby endpointy založené v té době šly dál upravovat',
  ping: 'testovací událost se od 7. 8. doručuje cíleně na jeden endpoint a neodebírá se vůbec (viz TARGETED_WEBHOOK_EVENT_TYPES); zůstává přijímaný, protože pár hodin 7. 8. šel zaškrtnout a kdo ho má uložený, musí svůj endpoint dál upravit',
};

const OFFERED = new Set<string>(WEBHOOK_EVENT_TYPES);
const TARGETED = new Set<string>(TARGETED_WEBHOOK_EVENT_TYPES);

/** Typ, který smí rozhraní nabídnout k zaškrtnutí. */
export function isOfferedWebhookEventType(value: string): value is WebhookEventType {
  return OFFERED.has(value);
}

/**
 * Typ, o kterém katalog VÍ, tedy nabízený nebo cílený.
 *
 * Používá to hlídací test, ne kontrola zápisu: cílený typ se odebírat nesmí,
 * ale vydávat se smí, a hlídač musí obojí rozlišit.
 */
export function isKnownWebhookEventType(value: string): boolean {
  return OFFERED.has(value) || TARGETED.has(value);
}

/**
 * Typ, který projde kontrolou při zápisu.
 *
 * Je to jiná množina než nabídka: PŘIBÍRÁ vysloužilé typy
 * (`RETIRED_WEBHOOK_EVENT_TYPES`) a NEBERE cílené
 * (`TARGETED_WEBHOOK_EVENT_TYPES`). Cílený typ se odebírat nedá, protože
 * odběr u něj nic neovlivní; kdo ho zkusí zapsat, dostane seznam platných
 * typů, ne tichý souhlas s tím, že mu nikdy nic nedorazí.
 */
export function isAcceptedWebhookEventType(value: string): boolean {
  return OFFERED.has(value) || Object.hasOwn(RETIRED_WEBHOOK_EVENT_TYPES, value);
}

/** Levenshteinova vzdálenost, iterativně nad jedním řádkem matice. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, substitution);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Nejbližší platný typ k překlepu, nebo `null`, když nic dost blízko není.
 *
 * Existuje kvůli jedinému případu, který se v praxi děje: `contact.subscribe`
 * místo `contact.subscribed`. Rozdíl jednoho znaku se ze seznamu patnácti
 * položek očima nepozná, takže odpověď musí ukázat přímo na správný tvar.
 *
 * Práh je 1/3 délky a nejvýš 3 znaky. Volnější práh začne radit nesmysly
 * („ping" ke každému krátkému slovu), přísnější neporadí nic u delších typů,
 * kde je překlep nejpravděpodobnější.
 */
export function suggestWebhookEventType(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const limit = Math.min(3, Math.max(1, Math.floor(normalized.length / 3)));
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of WEBHOOK_EVENT_TYPES) {
    const distance = editDistance(normalized, candidate);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return bestDistance <= limit ? best : null;
}

/** Výsledek kontroly. `null` znamená, že je seznam v pořádku. */
export type UnknownEventTypesRejection = {
  issues: ValidationIssue[];
  params: Record<string, unknown>;
};

/**
 * Kontrola seznamu odebíraných typů proti katalogu.
 *
 * KONTROLUJE SE JEN PŘI ZÁPISU, NIKDY PŘI DORUČOVÁNÍ, a je to rozhodnutí, ne
 * opomenutí. Kdyby se typ někdy přejmenoval nebo zrušil, kontrola v doručování
 * by ze dne na den umlčela každý endpoint, který ho má uložený, a majitel by se
 * to dozvěděl jedině tím, že mu přestaly chodit události. Doručování proto dál
 * jen porovnává řetězce (`endpointsSubscribedTo`) a uložené řádky přežijí
 * jakoukoli změnu katalogu. Kdo sem přijde „pro pořádek“ doplnit kontrolu i do
 * doručování, rozbije přesně tohle.
 *
 * `alreadyStored` je druhá polovina téhož slibu: typ, který na endpointu už
 * leží, projde vždycky. Bez toho by existoval endpoint, který nejde upravit,
 * protože kontrolou neprojdou jeho vlastní data.
 */
export function rejectUnknownEventTypes(
  types: readonly string[],
  alreadyStored: readonly string[],
): UnknownEventTypesRejection | null {
  const stored = new Set(alreadyStored);
  const unknown = types.filter((type) => !stored.has(type) && !isAcceptedWebhookEventType(type));
  if (unknown.length === 0) return null;

  const valid = WEBHOOK_EVENT_TYPES.join(', ');
  const suggestions: Record<string, string> = {};
  const issues = unknown.map((type) => {
    // Seznam platných typů patří do KAŽDÉ hlášky, ne jen do params: hlášku čte
    // člověk, params program. Překlep o jeden znak se bez správného tvaru
    // vedle sebe nepozná, a přesně takový překlep to v praxi bývá.
    const suggestion = suggestWebhookEventType(type);
    if (suggestion !== null) suggestions[type] = suggestion;
    return {
      path: 'event_types',
      code: 'unknown_event_type',
      message:
        suggestion !== null
          ? `Typ události „${type}“ neexistuje. Nemysleli jste „${suggestion}“? Platné typy: ${valid}.`
          : `Typ události „${type}“ neexistuje. Platné typy: ${valid}.`,
    };
  });

  return {
    issues,
    params: {
      unknown_event_types: unknown,
      allowed_event_types: [...WEBHOOK_EVENT_TYPES],
      ...(Object.keys(suggestions).length > 0 ? { suggestions } : {}),
    },
  };
}
