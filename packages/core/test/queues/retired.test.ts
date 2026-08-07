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

  it('každý náhrobní komentář v registru má protějšek v seznamu', () => {
    // Náhrobní komentář sám o sobě frontu z běžící databáze neodstraní. Kdo píše
    // „TADY UŽ NENÍ", musí ji zároveň zapsat sem, jinak zůstane ležet i s cronem.
    const source = readFileSync(new URL('../../src/queues/registry.ts', import.meta.url), 'utf8');
    const tombstones = [...source.matchAll(/`([a-z_]+\.[a-z_]+)` TADY UŽ NENÍ/g)].map(
      (match) => match[1] as string,
    );
    expect(tombstones.length, 'v registru nejsou žádné náhrobní komentáře').toBeGreaterThan(0);

    const retiredNames = new Set(RETIRED_QUEUES.map((retired) => retired.name));
    const forgotten = tombstones.filter((name) => !retiredNames.has(name));
    expect(
      forgotten,
      'fronta má náhrobní komentář, ale v RETIRED_QUEUES není: na běžící instalaci zůstane',
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
