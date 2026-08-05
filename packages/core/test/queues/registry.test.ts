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
    expect(queue('retention.drop_message_partitions')).toMatchObject({
      cron: '30 3 * * *',
      retryLimit: 1,
    });
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

  it('drží pořadí denních úloh: partition se zakládají před retencí', () => {
    const minutes = (cron: string): number => {
      const [minute, hour] = cron.trim().split(/\s+/);
      return Number(hour) * 60 + Number(minute);
    };
    expect(minutes(queue('platform.maintain_partitions').cron ?? '')).toBeLessThan(
      minutes(queue('tracking.enforce_retention').cron ?? ''),
    );
    expect(minutes(queue('tracking.enforce_retention').cron ?? '')).toBeLessThan(
      minutes(queue('tracking.recompute_engagement_windows').cron ?? ''),
    );
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
    // a obecná retence outboxu dnes NEBĚŽÍ: `retention.drop_message_partitions`
    // je v registru bez obsluhy, `dropPartitionsBefore()` nemá volajícího
    // a `MESSAGE_RETENTION_DAYS` se v běhovém kódu nečte. Bez téhle fronty by
    // token v databázi zůstal navždy. Rozhodnutí zadavatele z 5. 8. 2026.
    expect(QUEUE_REGISTRY).toHaveLength(62);
  });
});
