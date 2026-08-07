import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RETIRED_WEBHOOK_EVENT_TYPES,
  TARGETED_WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENT_TYPES,
  isAcceptedWebhookEventType,
  isKnownWebhookEventType,
  isOfferedWebhookEventType,
  rejectUnknownEventTypes,
  suggestWebhookEventType,
} from './event-catalog';

/**
 * Pojistka proti vadě, která už jednou nastala a nikdo si jí nevšiml: nabídka
 * typů událostí v rozhraní a typy, které produkt doopravdy vydává, se rozešly.
 * Rozhraní nabízelo `contact.created`, který nikdo nevydával, a naopak neznalo
 * tři typy, které se vydávaly. Nic přitom nespadlo. Zaškrtnutý webhook prostě
 * mlčky nikdy nedorazil, protože doručování porovnává typ prostým řetězcem.
 *
 * TENHLE TEST SEZNAM NEOPISUJE. Kdyby ho opisoval, hlídal by sám sebe a tatáž
 * vada by se vrátila. Odvozuje ho z míst, kde se událost doopravdy vydává:
 * čte zdrojové soubory `packages/core/src` a hledá řetězcové literály předané
 * do `emitWebhookEvent` a do portů `emit` / `emitWebhookEvent`.
 *
 * MEZ TÉHLE METODY, ať ji nikdo nepřecení: vidí jen literál, který ve zdroji
 * doopravdy stojí. Typ složený za běhu (`` `contact.${verb}` ``) je pro ni
 * neviditelný. Skládat jméno odchozí události je proto zakázané a tenhle
 * odstavec je jediné místo, kde se to dá říct tomu, kdo by to zkusil.
 *
 * Test nevynucuje konkrétní seznam. Vynucuje ROZHODNUTÍ: nový literál ve zdroji
 * shodí test do doby, než ho někdo zapíše do katalogu, nebo ho vypíše níž
 * v `NOT_WEBHOOK_EVENT_TYPES` i s důvodem, proč to odchozí událost není.
 */

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Literály tvaru `type: 'a.b'`, které odchozí událost NEJSOU.
 *
 * Důvod není omluva, je to informace. Prázdný seznam je správný stav: dnes má
 * tenhle tvar v `packages/core/src` výhradně typ odchozí události.
 */
const NOT_WEBHOOK_EVENT_TYPES: Readonly<Record<string, string>> = {};

const SKIPPED_DIRS = new Set(['test', 'tests', '__tests__', 'test-support', 'node_modules']);

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * Literál `type: '...'` v těsné blízkosti za voláním, které událost vydává.
 *
 * Dřív to byl jediný způsob, jak zahlédnout typ BEZ TEČKY, protože takový
 * v produktu jeden byl: `ping`. Od 7. 8. se jmenuje `webhook.ping` a výjimka
 * zmizela, ale tenhle vzor zůstává: chytí i typ, který by někdo napsal
 * v jiném tvaru, a to je přesně to, co má hlídač umět.
 */
const EMIT_CALL = /\b(?:emitWebhookEvent|emitEvent|\.emit)\(/g;
const TYPE_NEARBY = /\btype:\s*'([a-z][a-z0-9_.]*)'/;

/** Literál `type: 'a.b'` kdekoli v souboru. Zahlédne i typ, který se do volání dostane oklikou přes pole. */
const DOTTED_TYPE = /\btype:\s*'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g;

/** Typ jako PRVNÍ argument portu: `ports.emit('contact.subscribed', …)`. */
const FIRST_ARGUMENT = /\.(?:emit|emitWebhookEvent)\(\s*'([a-z][a-z0-9_.]*)'/g;

function emittedEventTypesInSource(): Set<string> {
  const found = new Set<string>();

  for (const file of collectSourceFiles(SRC_ROOT)) {
    const source = readFileSync(file, 'utf8');

    for (const call of source.matchAll(EMIT_CALL)) {
      const region = source.slice(call.index, call.index + 300);
      const nearby = region.match(TYPE_NEARBY);
      if (nearby) found.add(nearby[1]!);
    }
    for (const match of source.matchAll(DOTTED_TYPE)) found.add(match[1]!);
    for (const match of source.matchAll(FIRST_ARGUMENT)) found.add(match[1]!);
  }

  for (const excluded of Object.keys(NOT_WEBHOOK_EVENT_TYPES)) found.delete(excluded);
  return found;
}

describe('katalog typů odchozích událostí', () => {
  const emitted = emittedEventTypesInSource();

  it('sken zdrojů něco najde, jinak by test procházel naprázdno', () => {
    // Bez téhle kontroly by překlep v cestě nebo v regulárním výrazu vyrobil
    // prázdnou množinu, a prázdná množina projde všemi kontrolami pod ní.
    expect(emitted.size).toBeGreaterThanOrEqual(10);
  });

  it('každý typ, který produkt vydává, je v katalogu', () => {
    // `isKnownWebhookEventType`, ne `isOffered`: cílený typ se vydává, ale
    // nenabízí se k odběru. Kdyby se měřilo nabídkou, musel by se hlídač
    // obejít výjimkou, a výjimka v hlídači je horší než pojmenovaná kategorie.
    const missing = [...emitted].filter((type) => !isKnownWebhookEventType(type)).toSorted();
    expect(missing).toEqual([]);
  });

  it('každý typ v katalogu produkt doopravdy vydává', () => {
    const known = [...WEBHOOK_EVENT_TYPES, ...TARGETED_WEBHOOK_EVENT_TYPES];
    const dead = known.filter((type) => !emitted.has(type)).toSorted();
    expect(dead).toEqual([]);
  });

  /**
   * Cílený typ se VYDÁVÁ, ale NEODEBÍRÁ. Kdyby prošel zápisem, měl by zákazník
   * uložený odběr, který nic nedělá: doručení testovací události si endpoint
   * vybírá tlačítko, ne seznam odebíraných typů.
   */
  it('cílený typ se vydává, ale odebírat se nedá', () => {
    for (const type of TARGETED_WEBHOOK_EVENT_TYPES) {
      expect(emitted.has(type), `${type} se nikde nevydává`).toBe(true);
      expect(isKnownWebhookEventType(type)).toBe(true);
      expect(isOfferedWebhookEventType(type)).toBe(false);
      expect(isAcceptedWebhookEventType(type)).toBe(false);
      // Tečka je celý důvod přejmenování z `ping`: sken zdrojů i dělení
      // nabídky do skupin se opírají o tvar `prefix.sloveso`.
      expect(type).toContain('.');
    }
  });

  /**
   * Starý tvar `ping` musí projít zápisem. Pár hodin 7. 8. šel zaškrtnout,
   * takže ho někdo může mít uložený, a kontrola nesmí zamknout endpoint kvůli
   * hodnotě, kterou sama pustila dovnitř.
   */
  it('starý tvar ping projde zápisem, ale nenabízí se', () => {
    expect(isAcceptedWebhookEventType('ping')).toBe(true);
    expect(isOfferedWebhookEventType('ping')).toBe(false);
  });

  it('vysloužilý typ se nesmí vydávat, jinak patří zpátky do nabídky', () => {
    const resurrected = Object.keys(RETIRED_WEBHOOK_EVENT_TYPES)
      .filter((type) => emitted.has(type))
      .toSorted();
    expect(resurrected).toEqual([]);
  });

  it('vysloužilý typ projde zápisem, ale rozhraní ho nenabízí', () => {
    // Zpětná slučitelnost: kdo má `contact.created` uložený, musí svůj endpoint
    // dál uložit. Nový si ho zaškrtnout nemůže.
    expect(isAcceptedWebhookEventType('contact.created')).toBe(true);
    expect(isOfferedWebhookEventType('contact.created')).toBe(false);
  });

  it('katalog je seřazený a bez duplicit', () => {
    expect([...WEBHOOK_EVENT_TYPES]).toEqual([...WEBHOOK_EVENT_TYPES].toSorted());
    expect(new Set(WEBHOOK_EVENT_TYPES).size).toBe(WEBHOOK_EVENT_TYPES.length);
  });

  it('neznámý typ neprojde', () => {
    expect(isAcceptedWebhookEventType('contact.subscribe')).toBe(false);
    expect(isAcceptedWebhookEventType('')).toBe(false);
  });
});

describe('návrh opravy překlepu', () => {
  it('typický překlep dostane konkrétní návrh', () => {
    expect(suggestWebhookEventType('contact.subscribe')).toBe('contact.subscribed');
    expect(suggestWebhookEventType('message.click')).toBe('message.clicked');
    expect(suggestWebhookEventType('campaign.send')).toBe('campaign.sent');
  });

  it('nesouvisející hodnota návrh nedostane', () => {
    expect(suggestWebhookEventType('order.created')).toBeNull();
    expect(suggestWebhookEventType('naprosto.mimo.katalog')).toBeNull();
    expect(suggestWebhookEventType('')).toBeNull();
  });
});

describe('kontrola odebíraných typů při zápisu', () => {
  it('samé platné typy projdou', () => {
    expect(rejectUnknownEventTypes(['contact.subscribed', 'message.opened'], [])).toBeNull();
  });

  it('neznámý typ se odmítne a odpověď nese SEZNAM platných typů', () => {
    const rejection = rejectUnknownEventTypes(['contact.subscribe'], []);
    expect(rejection).not.toBeNull();

    // Bez seznamu v hlášce nemá pisatel podle čeho překlep poznat. Tohle je
    // celý smysl kontroly, ne „neplatná hodnota".
    expect(rejection!.issues).toHaveLength(1);
    expect(rejection!.issues[0]!.code).toBe('unknown_event_type');
    expect(rejection!.issues[0]!.path).toBe('event_types');
    expect(rejection!.issues[0]!.message).toContain('contact.subscribed');
    expect(rejection!.issues[0]!.message).toContain('message.opened');

    expect(rejection!.params['allowed_event_types']).toEqual([...WEBHOOK_EVENT_TYPES]);
    expect(rejection!.params['unknown_event_types']).toEqual(['contact.subscribe']);
    expect(rejection!.params['suggestions']).toEqual({
      'contact.subscribe': 'contact.subscribed',
    });
  });

  it('u hodnoty bez blízkého tvaru se nic nedomýšlí', () => {
    const rejection = rejectUnknownEventTypes(['order.created'], []);
    expect(rejection!.issues[0]!.message).not.toContain('Nemysleli jste');
    expect(rejection!.params['suggestions']).toBeUndefined();
  });

  it('každý neznámý typ dostane vlastní nález', () => {
    const rejection = rejectUnknownEventTypes(['order.created', 'contact.subscribe'], []);
    expect(rejection!.issues).toHaveLength(2);
    expect(rejection!.params['unknown_event_types']).toEqual([
      'order.created',
      'contact.subscribe',
    ]);
  });

  it('vysloužilý typ projde, protože ho někdo může mít uložený', () => {
    expect(rejectUnknownEventTypes(['contact.created'], [])).toBeNull();
  });

  it('typ, který endpoint už odebírá, projde i mimo katalog', () => {
    // Endpoint založený přes API s libovolnou hodnotou musí jít dál upravit.
    // Jinak by kontrola zamkla data, která sama pustila dovnitř.
    expect(rejectUnknownEventTypes(['naprosto.vymysleny'], ['naprosto.vymysleny'])).toBeNull();

    // Přidat k němu DALŠÍ nesmysl už ale nejde.
    const rejection = rejectUnknownEventTypes(
      ['naprosto.vymysleny', 'druhy.nesmysl'],
      ['naprosto.vymysleny'],
    );
    expect(rejection!.params['unknown_event_types']).toEqual(['druhy.nesmysl']);
  });
});
