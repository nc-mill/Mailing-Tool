import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, RETIRED_QUEUES, dlqName, retiredQueueDeleteOrder } from '../../src/queues';

/**
 * Seznam zrušených front musí sedět s registrem, jinak je horší než žádný.
 *
 * Dva směry, obojí se stalo:
 *
 *  - Fronta se vyškrtne z registru a na běžící instalaci zůstane řádek
 *    v `pgboss.queue` i s plánem cronu a s tiky. Naměřeno 7. 8.: dvě zrušené
 *    fronty pořád tikaly do prázdna.
 *  - Fronta se vrátí do registru a zapomene se na to, že ji úklid při startu
 *    workeru maže. Vznikl by cyklus: založit, smazat, založit.
 */
describe('fronty, které se zrušily', () => {
  it('žádná zrušená fronta není zároveň v registru', () => {
    const registryNames = new Set(QUEUE_REGISTRY.map((entry) => entry.name));
    const collision = RETIRED_QUEUES.filter((retired) => registryNames.has(retired.name));
    expect(
      collision.map((retired) => retired.name),
      'fronta je v registru a zároveň se maže: worker by ji každý start založil a hned smazal',
    ).toEqual([]);
  });

  /**
   * Náhrobní komentář sám o sobě frontu z běžící databáze neodstraní. Kdo frontu
   * vyškrtne z registru, musí ji zároveň zapsat do `RETIRED_QUEUES`, jinak
   * zůstane ležet i s plánem cronu.
   *
   * TENHLE TEST SE NESMÍ VÁZAT NA FORMULACI KOMENTÁŘE, a je to poučení z vlastní
   * vady. Do 8. 8. 2026 tu stálo hledání doslovného tvaru „`název` TADY UŽ NENÍ".
   * Když se 7. 8. rušila `platform.cleanup_audit_log`, napsal se komentář slovy
   * „BYLA ZRUŠENA", tedy jinak. Test zůstal zelený a fronta zůstala v databázi
   * i s cronem `35 2 * * *`, který každou noc vyrobil úlohu, kterou nikdo
   * nevyzvedne. Politika `exclusive` pak zamkla frontu až do vypršení té úlohy.
   * Pojistka tedy propustila přesně tu situaci, kvůli které vznikla, protože
   * hlídala slovník, ne skutečnost.
   *
   * Teď se nekouká na slova. Vezme se každé jméno v obráceném apostrofu, které
   * VYPADÁ JAKO FRONTA, tedy má doménovou předponu některé skutečné fronty
   * z registru, a takové jméno musí být buď v registru, nebo mezi zrušenými.
   * Jména tabulek a sloupců (`pgboss.job`, `queue.dead_letter`,
   * `workspaces.locale`) tím propadnou sítem sama, protože žádná fronta jejich
   * předponu nemá. Naměřeno 8. 8. 2026: z 18 zmíněných jmen projde sítem 1.
   */
  it('žádné jméno fronty zmíněné v registru nechybí v seznamu zrušených', () => {
    const source = readFileSync(new URL('../../src/queues/registry.ts', import.meta.url), 'utf8');
    const registryNames = new Set(QUEUE_REGISTRY.map((entry) => entry.name));
    const retiredNames = new Set(RETIRED_QUEUES.map((retired) => retired.name));
    const domains = new Set([...registryNames].map((name) => name.split('.')[0] as string));

    const mentioned = new Set(
      [...source.matchAll(/`([a-z_]+\.[a-z_]+)`/g)].map((match) => match[1] as string),
    );
    const looksLikeQueue = [...mentioned].filter((name) =>
      domains.has(name.split('.')[0] as string),
    );
    expect(looksLikeQueue.length, 'v registru se nezmiňuje ani jedna fronta').toBeGreaterThan(0);

    const forgotten = looksLikeQueue
      .filter((name) => !registryNames.has(name) && !retiredNames.has(name))
      .sort();
    expect(
      forgotten,
      'fronta se zmiňuje v registru, ale není v něm ani v RETIRED_QUEUES: na běžící ' +
        'instalaci zůstane i s plánem cronu a bude tikat do prázdna',
    ).toEqual([]);
  });

  it('každý důvod je vysvětlení, ne prázdný řádek', () => {
    // Kdo seznam čte, musí poznat rozdíl mezi „tu práci dělá něco jiného"
    // a „ta práce se dneska nedělá vůbec".
    for (const retired of RETIRED_QUEUES) {
      expect(retired.reason.length, `${retired.name} má prázdný důvod`).toBeGreaterThan(40);
    }
  });

  it('maže hlavní frontu dřív než její dead letter', () => {
    // `queue.dead_letter` i `job.dead_letter` mají ON DELETE RESTRICT.
    const order = retiredQueueDeleteOrder();
    for (const retired of RETIRED_QUEUES) {
      expect(order.indexOf(retired.name), retired.name).toBeLessThan(
        order.indexOf(dlqName(retired.name)),
      );
    }
  });
});
