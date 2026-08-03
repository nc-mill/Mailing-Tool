import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isConsentEraserAvailable, resetConsentEraser } from '../../gdpr/consents-role';
import { installConsentEraser } from '../../gdpr/consents-role-runtime';

/**
 * Hlídač ZAPOJENÍ, ne hlídač chování. Stejný tvar jako
 * `platform/system-mail-wiring.test.ts` a ze stejného důvodu.
 *
 * `registerConsentEraser` existoval, měl zelené testy a v celém repozitáři ho
 * volaly JEDINĚ testy. Produkční cesta k roli `mlain_gdpr` tedy neexistovala
 * a výmaz podle článku 17 v režimu `anonymize`, tedy ve výchozím režimu,
 * nedoběhl nikdy. Jednotkové testy portu přitom byly celou dobu zelené: měřily,
 * že port zavolá to, co mu kdo podstrčí, a o tom, jestli mu někdo něco
 * podstrčí, nevypovídaly nic.
 *
 * Kdo ten řádek z workeru smaže, dozví se to tady, a ne až od zákazníka, kterému
 * uplyne lhůta na vyřízení žádosti.
 */
const ROOT = resolve(import.meta.dirname, '../../../../../..');

/**
 * Procesy, ve kterých se výmaz spouští. Je to JEN worker: `anonymizeContact`
 * volá úloha `gdpr.erase` a retenční cíl `inactive_contacts`, obojí běží tady.
 * Web anonymizaci nevolá vůbec, ověřeno hledáním volajících.
 */
const ENTRYPOINTS = ['apps/worker/src/main.ts'];

describe('zapojení mazače souhlasů', () => {
  it.each(ENTRYPOINTS)('%s zapojuje mazač souhlasů při startu procesu', (relative) => {
    const source = readFileSync(resolve(ROOT, relative), 'utf8');
    // Hledá se VOLÁNÍ, ne jméno. Samotné `source.includes('installConsentEraser')`
    // projde i tehdy, když v souboru zbyde jen import a volání někdo smaže;
    // ověřeno spuštěním nad souborem bez toho řádku, kde grep na jméno prošel
    // a databázový test výmazu přitom padal na `gdpr_role_unavailable`.
    expect(
      /installConsentEraser\s*\(\s*\)/.test(source),
      `${relative} nevolá installConsentEraser(), takže výmaz podle článku 17 v režimu ` +
        'anonymize selže na gdpr_role_unavailable při každé žádosti',
    ).toBe(true);
  });

  it('port je ve výchozím stavu NEDOSTUPNÝ a zapojení ho zpřístupní', () => {
    resetConsentEraser();
    expect(isConsentEraserAvailable()).toBe(false);
    installConsentEraser();
    expect(isConsentEraserAvailable()).toBe(true);
    resetConsentEraser();
  });
});
