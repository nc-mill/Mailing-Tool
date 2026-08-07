import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, dlqName, queueCreatePlan } from '../../src/queues';
import { PGBOSS_RECIPE } from '../../src/test-support/pgboss';

/**
 * Předpis zakládání front je JEDEN a používají ho obě strany.
 *
 * Nález, kvůli kterému tenhle soubor vznikl: testovací prostředí
 * (`test-support/pgboss.ts`) zakládalo fronty vlastním cyklem a posílalo jedinou
 * volbu, `deadLetter`. Politika slučování v testech tedy zůstávala `standard`,
 * kdežto v provozu byla `exclusive` nebo `stately`. Testy neměřily totéž
 * chování co provoz a nic to neřeklo: v testu se druhá úloha s týmž klíčem
 * ZAŘADILA, v provozu se zahodila.
 */
describe('předpis zakládání front', () => {
  it('nese politiku slučování z registru u každé fronty', () => {
    const plan = new Map(queueCreatePlan().map((item) => [item.name, item.options]));
    for (const entry of QUEUE_REGISTRY) {
      expect(plan.get(entry.name)?.['policy'], entry.name).toBe(entry.policy);
    }
  });

  it('zakládá frontu pro nedoručitelné DŘÍV než tu, která na ni odkazuje', () => {
    // pg-boss jinak řekne „Queue <jméno>.dlq does not exist" a worker skončí
    // v restartové smyčce. Od chvíle, kdy schéma vlastní migrátor, si knihovna
    // chybějící frontu při prvním `send` sama nezaloží.
    const order = queueCreatePlan().map((item) => item.name);
    for (const entry of QUEUE_REGISTRY) {
      if (!entry.deadLetter) continue;
      expect(order.indexOf(dlqName(entry.name)), entry.name).toBeLessThan(
        order.indexOf(entry.name),
      );
    }
  });

  it('nedává frontě pro nedoručitelné ani politiku, ani opakování', () => {
    // Slučovat nedoručitelné úlohy by znamenalo tiše zahodit právě to, co se má
    // vyšetřit. Opakovat je nemá smysl: sem se úloha dostala až po vyčerpání
    // pokusů ve své vlastní frontě.
    for (const { name, options } of queueCreatePlan()) {
      if (!name.endsWith('.dlq')) continue;
      expect(options['policy'], name).toBeUndefined();
      expect(options['deadLetter'], name).toBeUndefined();
      expect(options['retryLimit'], name).toBe(0);
    }
  });

  it('otisk testovací šablony se hne, když se v registru změní politika', () => {
    // Bez toho by hotová šablona přepnutí politiky nezachytila: `create_queue`
    // má `ON CONFLICT DO NOTHING`, takže existující frontu nechá být, a testy by
    // dál běžely nad starou politikou.
    for (const entry of QUEUE_REGISTRY) {
      expect(PGBOSS_RECIPE, entry.name).toContain(
        `${entry.name}:${entry.policy ?? 'standard'}:${entry.deadLetter ? 'dlq' : '-'}`,
      );
    }
  });

  it('ani jedna strana si nezakládá fronty vlastním cyklem', () => {
    // Statická pojistka: kdyby si někdo cyklus napsal znovu, tenhle test spadne
    // dřív, než se rozdíl mezi testem a provozem projeví na chování.
    for (const path of [
      new URL('../../src/test-support/pgboss.ts', import.meta.url),
      new URL('../../../../apps/worker/src/boss.ts', import.meta.url),
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source, String(path)).toContain('queueCreatePlan()');
      expect(source, String(path)).not.toMatch(
        /for \(const entry of QUEUE_REGISTRY\)[\s\S]{0,200}createQueue/,
      );
    }
  });
});
