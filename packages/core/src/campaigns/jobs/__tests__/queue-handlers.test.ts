import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { handlerModulePath, missingDependenciesOf, queue } from '../../../queues';
import { handlers } from '../queue-handlers';

const ROOT = path.resolve(import.meta.dirname, '../../../../../..');

describe('registrace obsluh domény kampaní pro codegen workeru', () => {
  it('fronta campaign.materialize má obsluhu', () => {
    // Bez téhle jedné položky se kampaň NIKDY neodešle: úloha se zařadí,
    // nikdo si ji nevyzvedne a kampaň zůstane ve stavu queueing navždy.
    expect(handlers['campaign.materialize']).toBeTypeOf('function');
  });

  /**
   * Soubor musí ležet tam, kde ho codegen workeru DOOPRAVDY najde, a to se
   * neověřuje úvahou, ale spuštěním codegenu: jediné, co rozhoduje, je glob
   * přes `packages/core/src/<uroven>/jobs/queue-handlers.ts`.
   *
   * `handlerModulePath` z registru tady záměrně NENÍ jako tvrzení o cestě.
   * Odvozuje adresář z PREFIXU JMÉNA FRONTY, takže pro `campaign.materialize`
   * vrací `packages/core/src/campaign/jobs/…`, tedy JEDNOTNÉ číslo, kdežto
   * doména se jmenuje `campaigns`. Držet se jeho výsledku by znamenalo založit
   * druhou, poloprázdnou doménu `campaign` vedle té skutečné. Rozpor je tady
   * zapsaný jako fakt, ať ho příští čtenář nemusí hledat znovu.
   */
  it('codegen workeru soubor doopravdy najde', () => {
    const generated = execFileSync(
      process.execPath,
      [path.join(ROOT, 'apps/worker/codegen.mjs'), '--stdout'],
      { encoding: 'utf8' },
    );
    expect(generated).toContain("from '@mlain/core/campaigns/jobs'");
  });

  it('handlerModulePath odvozuje jméno domény z prefixu fronty, ne z adresáře', () => {
    expect(handlerModulePath(queue('campaign.materialize'))).toBe(
      'packages/core/src/campaign/jobs/queue-handlers.ts',
    );
  });

  /**
   * Past mapy `exports`: Node bere v jednom vzoru jen JEDEN zástupný znak
   * a vyhrává nejdelší shoda základu, ne pořadí deklarace. Bez explicitního
   * klíče `./campaigns/jobs` by se import z workeru nerozřešil a spadlo by to
   * až při stavbě produkční image, tedy daleko od příčiny. Totéž hlídá
   * `assertExportsMapCovers` v `apps/worker/codegen.mjs`.
   */
  it('mapa exports má explicitní klíč pro doménu campaigns', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as { exports: Record<string, string> };
    expect(manifest.exports['./campaigns/jobs']).toBe('./src/campaigns/jobs/queue-handlers.ts');
  });

  /**
   * Obsluha bez zapojených závislostí musí SPADNOUT, a to hlasitě. Kdyby se
   * fronta jen vynechala, nebyl by rozdíl mezi „na obsluhu se zapomnělo"
   * a „obsluha existuje, ale nemá kdo dodat její závislosti".
   */
  it('nezapojené fronty hlásí chybějící závislost, ne ticho', async () => {
    const handler = handlers['outbox.reconcile'];
    await expect(handler([{ id: 'j1', name: 'outbox.reconcile', data: {} }])).rejects.toThrow(
      /nemá zapojené závislosti/,
    );

    // Kontrolní vzorek pro test o kus níž: značka se na náhradní obsluhu
    // DOOPRAVDY věší. Bez tohohle řádku by `toBeUndefined()` u zapojených front
    // procházelo i tehdy, kdyby `missingDependenciesOf` vracelo undefined vždy.
    expect(missingDependenciesOf(handler)).toMatch(/reconcile/);
  });

  /**
   * Tři cronové skeny UŽ ZAPOJENÉ JSOU, od chvíle, kdy má worker roli
   * `mlain_maintenance` (migrace 0009). Test to drží zafixované ze dvou stran,
   * protože samotné `toBeTypeOf('function')` by tady neznamenalo nic:
   * `needsDependencies` vrací taky funkci, jen shodí každou úlohu.
   *
   * Proto se ptáme na značku `missingDependencies`. Kdyby se někdo pokusil
   * závislosti zase odpojit, tenhle test spadne dřív, než se na to přijde
   * podle toho, že se kampaň naplánovaná na dnešek neodeslala.
   */
  it('cronové skeny mají skutečné závislosti, ne náhradní obsluhu', () => {
    for (const name of ['campaign.scheduler', 'campaign.watchdog', 'campaign.resume_on_quota']) {
      const handler = handlers[name as keyof typeof handlers];
      expect(handler).toBeTypeOf('function');
      expect(missingDependenciesOf(handler)).toBeUndefined();
    }
  });

  /**
   * pg-boss volá obsluhu s DÁVKOU úloh. Kdyby `campaign.materialize` neprošla
   * adaptérem `perJob`, dostala by pole tam, kde čeká náklad, sáhla by na
   * `.data` do prázdna a `createSystemContext` by spadl na neplatném UUID.
   * Fronta by se přitom zaregistrovala a worker naběhl.
   */
  it('campaign.materialize rozbaluje dávku po jedné úloze', async () => {
    await expect(
      handlers['campaign.materialize']([
        { id: 'j1', name: 'campaign.materialize', data: { campaignId: 'k1', workspaceId: 'nic' } },
      ]),
    ).rejects.toMatchObject({ message: expect.stringMatching(/workspace_id|validation/i) });
  });
});
