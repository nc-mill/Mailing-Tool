import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY, cronQueues, dlqName, queue, queueNames } from '../../src/queues/registry';

describe('registr front pg-boss', () => {
  it('má název ve tvaru <domena>.<akce> u každé fronty (konvence 3.11)', () => {
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.name, `${entry.name}`).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it('nemá duplicitní název', () => {
    const names = queueNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('má u každé fronty explicitní retryLimit a expireInSeconds (konvence 9.1)', () => {
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.retryLimit, `${entry.name} bez retryLimit`).toBeTypeOf('number');
      expect(entry.expireInSeconds, `${entry.name} bez expireInSeconds`).toBeGreaterThan(0);
    }
  });

  it('kopíruje politiku front části 1, kapitoly 3.8', () => {
    expect(queue('platform.webhook_fanout')).toMatchObject({ retryLimit: 5 });
    expect(queue('platform.webhook_deliver')).toMatchObject({ retryLimit: 0 });
  });

  it('kopíruje politiku front části 4a, kapitoly 4.5', () => {
    expect(queue('campaign.materialize')).toMatchObject({
      retryLimit: 5,
      singletonKeyTemplate: 'campaign.materialize:<campaign_id>',
    });
    expect(queue('campaign.scheduler')).toMatchObject({ cron: '*/30 * * * * *', retryLimit: 3 });
    expect(queue('campaign.watchdog')).toMatchObject({ cron: '*/15 * * * * *', retryLimit: 3 });
    expect(queue('provider_event.process')).toMatchObject({ retryLimit: 10 });
    // `retention.drop_message_partitions` tu bývala s cronem `30 3 * * *`.
    // Politika fronty se opsat dala, obsluha ne: odpojení oddílu je DDL
    // a worker běží pod `mlain_app`, která schéma nevlastní. Úklid dělá
    // `mlain partitions` z plánovače hostitele, takže tu už není co ověřovat.
    expect(queueNames()).not.toContain('retention.drop_message_partitions');
  });

  it('kopíruje politiku front části 3, kapitoly 4.8', () => {
    expect(queue('content.brand_extract')).toMatchObject({ retryLimit: 0 });
    expect(queue('content.process_asset')).toMatchObject({ retryLimit: 3 });
    expect(queue('content.cleanup_versions')).toMatchObject({ cron: '10 3 * * *' });
    expect(queue('ai.cleanup_conversations')).toMatchObject({ cron: '40 3 * * *' });
  });

  it('extrakce značky se nikdy neopakuje, opakovaný SSRF pokus není žádoucí', () => {
    expect(queue('content.brand_extract').retryLimit).toBe(0);
  });

  it('žádný payload nedeklaruje osobní údaj ani obsah e-mailu (konvence 9.1)', () => {
    const forbidden = ['email', 'render_data', 'html', 'text', 'body', 'first_name', 'subject'];
    for (const entry of QUEUE_REGISTRY) {
      for (const field of entry.payloadFields) {
        expect(forbidden, `${entry.name} má v payloadu ${field}`).not.toContain(field);
      }
    }
  });

  it('dead letter fronta se jmenuje <fronta>.dlq', () => {
    expect(dlqName('contacts.import')).toBe('contacts.import.dlq');
    for (const entry of QUEUE_REGISTRY) {
      if (entry.deadLetter) {
        expect(queueNames()).not.toContain(dlqName(entry.name));
      }
    }
  });

  it('cron výrazy mají pět nebo šest polí', () => {
    for (const entry of cronQueues()) {
      const fields = entry.cron.trim().split(/\s+/);
      expect([5, 6], `${entry.name}: ${entry.cron}`).toContain(fields.length);
    }
  });

  it('nemá jedinou frontu na práci s oddíly, tu dělá CLI pod migrátorem', () => {
    // Tenhle test dřív hlídal pořadí trojice „zakládání → retence → přepočet
    // oken" přes časy v cronu. Dvě ze tří front z registru odešly a s nimi
    // i smysl toho hlídání.
    //
    // Společný důvod: práce s oddílem je DDL (`CREATE TABLE ... PARTITION OF`,
    // `ALTER TABLE ... DETACH PARTITION`) a worker běží pod `mlain_app`, která
    // schéma nevlastní. Obsluha proto ani jedné z nich nikdy nevznikla a vzniknout
    // nemohla; v registru jen vypadaly jako běžící údržba.
    //
    // Pořadí „nejdřív založit, pak uklidit" nezmizelo, přestěhovalo se z časů
    // v cronu do JEDNOHO příkazu, kde ho drží pořadí volání
    // (`runPartitionMaintenance`) a hlídá test v `ops/partition-retention.test.ts`.
    // To je silnější záruka než dva cronové časy patnáct minut od sebe, které
    // se míjely, jakmile se první úloha protáhla.
    //
    // Test je obrácený schválně: brání tomu, aby tyhle fronty někdo za rok
    // založil znovu, protože „chybí přece úklid oddílů".
    for (const name of [
      'platform.maintain_partitions',
      'retention.drop_message_partitions',
      'tracking.enforce_retention',
    ]) {
      expect(queueNames(), `fronta ${name} se vrátila do registru`).not.toContain(name);
    }
  });

  it('pokrývá všech šest domén', () => {
    const domains = new Set(QUEUE_REGISTRY.map((entry) => entry.domain));
    expect([...domains].sort()).toEqual([
      'campaigns',
      'contacts',
      'content',
      'platform',
      'sender',
      'tracking',
    ]);
  });

  it('queue() na neregistrované frontě hlásí uzávěr S8', () => {
    expect(() => queue('vymyslena.fronta')).toThrow(/uzávěr S8/);
  });

  it('zná fronty, které si vyžádaly plány P07, P10 a P16', () => {
    // Všechny čtyři doménové plány implementují nebo volají, ale v registru
    // chyběly. Fronta bez záznamu tady znamená, že se v úkolu 14 nezaloží
    // a doménový plán dostane při prvním boss.send chybu o neexistující frontě.
    for (const name of [
      'contacts.cleanup_pending',
      'consents.rebuild_state',
      'retention.run',
      'tracking.rebuild_engagement',
    ]) {
      expect(queueNames(), `fronta ${name} chybí`).toContain(name);
    }
  });

  it('má právě šedesát dva front (registr je uzavřený, uzávěr S8)', () => {
    // Exaktní číslo je záměr. Doménový plán frontu nezakládá, takže každá změna
    // téhle hodnoty musí projít změnou plánu P01, ne commitem z jiné větve.
    //
    // 61 → 62: přibyla `transactional.purge_render_data`. V `render_data`
    // transakční zprávy leží odkaz s jednorázovým tokenem na reset hesla
    // a obecná retence outboxu tehdy NEBĚŽELA. Rozhodnutí zadavatele z 5. 8. 2026.
    //
    // 62 → 59: odešly VŠECHNY TŘI fronty na práci s oddíly, tedy
    // `retention.drop_message_partitions`, `tracking.enforce_retention`
    // a `platform.maintain_partitions`. Slibovaly zakládání a úklid oddílů
    // a ani jedna to udělat nemohla: je to DDL a worker běží pod `mlain_app`,
    // která schéma nevlastní. Obsluha jim proto nikdy nevznikla a v registru
    // stály jako fronty, které se tváří, že něco dělají. Práci převzal příkaz
    // `mlain partitions` pod migrátorskou rolí, pouštěný z plánovače hostitele
    // (`packages/core/src/ops/partition-retention.ts`).
    expect(QUEUE_REGISTRY).toHaveLength(59);
  });
});
