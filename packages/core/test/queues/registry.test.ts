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

  it('má na práci s oddíly JEDINOU frontu, a ta nesmí běžet pod aplikační rolí', () => {
    // Tenhle test dřív hlídal pořadí trojice „zakládání → retence → přepočet
    // oken" přes časy v cronu. Všechny tři fronty odešly a s nimi i smysl toho
    // hlídání: práce s oddílem je DDL (`CREATE TABLE ... PARTITION OF`,
    // `ALTER TABLE ... DETACH PARTITION`) a aplikační role `mlain_app` schéma
    // nevlastní, takže obsluha ani jedné z nich nikdy nevznikla a vzniknout
    // nemohla; v registru jen vypadaly jako běžící údržba.
    //
    // 7. 8. 2026 se JEDNA z nich vrátila, protože náhrada za ně, tedy
    // `mlain partitions` z plánovače hostitele, se v dodávané instalaci
    // nespouštěla nikde. Vrátila se s obsluhou, která si otvírá vlastní
    // spojení pod migrátorem, takže původní důvod zrušení odpadl.
    //
    // Test tedy hlídá dvě věci naráz. Za prvé, že na tuhle práci je JEDNA
    // fronta, ne zase tři: dva úklidy téhož ze dvou míst by znamenaly dvě
    // různá pravidla. Za druhé, že pořadí „nejdřív založit, pak uklidit"
    // zůstává uvnitř jedné úlohy (`runPartitionMaintenance`), ne rozdělené do
    // dvou cronových časů patnáct minut od sebe, které se míjely, jakmile se
    // první úloha protáhla.
    for (const name of ['retention.drop_message_partitions', 'tracking.enforce_retention']) {
      expect(queueNames(), `fronta ${name} se vrátila do registru`).not.toContain(name);
    }
    expect(queueNames()).toContain('platform.maintain_partitions');
    const entry = QUEUE_REGISTRY.find((q) => q.name === 'platform.maintain_partitions')!;
    // `exclusive` je podmínka, ne styl: dva souběžné běhy by odpojovaly týž
    // oddíl a druhý by skončil chybou nad polovičním stavem katalogu.
    expect(entry.policy).toBe('exclusive');
    // Před zálohou ve 3:00, aby dump nezastihl tabulku uprostřed odpojování.
    expect(entry.cron).toBe('5 2 * * *');
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
    // Doménové plány je implementují nebo volají, ale v registru chyběly. Fronta
    // bez záznamu tady znamená, že se v úkolu 14 nezaloží a doménový plán dostane
    // při prvním boss.send chybu o neexistující frontě.
    //
    // `tracking.rebuild_engagement` z výčtu ZMIZELA i s frontou: P16 ji z CLI
    // nevolá, `mlain rebuild-engagement` sahá na dávkovač ops/rebuild-engagement.ts
    // přímo. Tvrzení „P16 ji volá", kvůli kterému se sem kdysi dostala, tedy
    // nikdy neplatilo.
    for (const name of ['contacts.cleanup_pending', 'consents.rebuild_state', 'retention.run']) {
      expect(queueNames(), `fronta ${name} chybí`).toContain(name);
    }
  });

  it('má právě padesát devět front (registr je uzavřený, uzávěr S8)', () => {
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
    //
    // 59 → 60: přibyla `platform.webhook_retry`. Není to nová funkce, je to druhá
    // polovina opravy nálezu, že odchozí webhooky neodejdou vůbec. Doručovací fronta
    // má schválně `retryLimit: 0`, protože odstupy mezi pokusy předepisuje kontrakt
    // vlastní tabulkou, ne pg-boss; bez skenu podle `next_attempt_at` by tedy první
    // neúspěch byl zároveň poslední a ruční opakování z obrazovky by nedělalo nic.
    //
    // 60 → 59: odešla `tracking.erase_contact`. Neměla producenta ani obsluhu
    // a nebyla to odložená funkce, byla to druhá cesta k témuž: stopu kontaktu
    // ve `web_events` i `message_engagement` odpojuje `gdpr.sever_links`, kterou
    // volají oba producenti výmazu. Dvě cesty k výmazu podle článku 17 znamenají
    // dva výklady toho, co znamená vymazat kontakt.
    //
    // 59 → 58: odešla `tracking.rebuild_engagement`. Rekonstrukci dělá příkaz
    // `mlain rebuild-engagement` přímým voláním dávkovače; fronta vedle něj byla
    // cesta, kterou nikdo nikdy nespustil, což bylo vidět na její obsluze
    // přijímající náklad ve dvou tvarech naslepo. Rozhodnutí zadavatele.
    //
    // 58 → 59 (7. 8.): VRÁTILA SE `platform.maintain_partitions`, jediná fronta, která
    // se kdy vrátila ze seznamu zrušených. Zrušit ji bylo správně (obsluha pod aplikační
    // rolí DDL neumí), jenže náhrada, tedy `mlain partitions` z plánovače hostitele, se
    // v dodávané instalaci nespouštěla NIKDE: compose žádný plánovač nemá a na PaaS ho
    // nejde doplnit. Obsluha si teď otvírá vlastní spojení pod migrátorem, přesně jako
    // `platform.backup`, takže aplikační role žádné právo na DDL nedostává.
    //
    // 59 → 60 (7. 8.): přibyla `contacts.recover_stale_imports`. Není to nová schopnost,
    // je to ZAPOJENÍ existující: `recoverStaleImportsJob` měl obsluhu, vlastní test
    // i migraci 0024 s grantem a politikou pro sken napříč projekty, ale nevolal ho nikdo,
    // protože fronta v registru nebyla. Následek nebyl kosmetický: `confirmImport` odmítne
    // KAŽDÝ další import v projektu, dokud v něm leží řádek ve stavu `importing`, takže
    // zabitý worker uprostřed importu zamkl projektu importování natrvalo a ven vedl
    // jedině ruční zásah do databáze. Ve vývojové instalaci se to 7. 8. stalo.
    //
    // 60 → 59 (7. 8.): odešla `platform.cleanup_audit_log`. Nebyla to úspora, byla to
    // oprava fronty, která NEUSPĚLA ANI JEDNOU za celou dobu své existence: mazala
    // `DELETE FROM audit_log` pod aplikační rolí, jenže migrace 0005, 0009, 0022 i 0026
    // dělají `REVOKE UPDATE, DELETE ON audit_log FROM mlain_app`, takže každý běh skončil
    // na `permission denied` (SQLSTATE 42501). To odebrání práva není překážka, je to ta
    // vlastnost, kvůli které je audit k něčemu: záznam, který smí aplikace smazat, není
    // důkaz. Retenci proto převzala údržba oddílů, která ODPOJUJE celý oddíl pod
    // migrátorem (`ops/partition-retention.ts`), takže se maže bez práva mazat řádky.
    expect(QUEUE_REGISTRY).toHaveLength(59);
  });
});
