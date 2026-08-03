import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * Tenhle soubor nepřidává funkci. Odpovídá na otázku, kterou zelené testy
 * nikdy nepoloží: KDO TU FUNKCI VOLÁ V PRODUKCI?
 *
 * Celý plán měl dřív jednu systémovou vadu: každá vrstva byla čistá funkce
 * s vlastním testem a nic je nespojovalo. Konektor s připnutou IP neměl
 * spotřebitele, `safeFetch` neměl přenos, kontrola prostředí se nikdy
 * nezavolala. Všechno svítilo zeleně.
 *
 * Kdyby některý z těchhle testů spadl, NEUPRAVUJ HO. Znamená to, že chybí
 * zapojení, ne že je vadný test.
 */
function productionUses(symbol: string, excludeFile: string): string[] {
  let out = '';
  try {
    out = execFileSync(
      'grep',
      ['-rn', '--include=*.ts', '--include=*.tsx', symbol, 'packages/core/src', 'apps/web/src'],
      { cwd: ROOT, encoding: 'utf8' },
    );
  } catch {
    return [];
  }
  return out
    .split('\n')
    .filter((line) => line !== '')
    .filter((line) => !line.includes('.test.'))
    .filter((line) => !line.includes('__tests__'))
    .filter((line) => !line.startsWith(excludeFile) && !line.includes(`/${excludeFile}:`))
    .filter(isCode)
    .filter(isNotBarrelReexport);
}

/**
 * `export { createBrandRuntime } from './runtime'` není volání, je to jen
 * propíchnutí symbolu skrz barrel. Kdyby se počítalo, stačilo by symbol
 * reexportovat a test by zezelenal, aniž by tu funkci kdokoliv spustil.
 * Tatáž třída falešné jistoty jako komentář, kterou řeší `isCode`.
 */
function isNotBarrelReexport(line: string): boolean {
  const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
  return !/^export\s+(type\s+)?\{[^}]*\}\s+from\s+/.test(code);
}

/**
 * Komentář o funkci není její volání. Bez tohohle filtru stačilo napsat
 * „skutečné implementace sestavuje createBrandRuntime()" a test zezelenal,
 * aniž by tu funkci kdokoliv zavolal. Přesně ta třída falešné jistoty, kvůli
 * které tenhle soubor vznikl.
 */
function isCode(line: string): boolean {
  const code = line.slice(line.indexOf(':', line.indexOf(':') + 1) + 1).trim();
  return !code.startsWith('*') && !code.startsWith('//') && !code.startsWith('/*');
}

describe('ochrany jsou zapojené, ne jen napsané', () => {
  it('createPinnedConnector má produkčního spotřebitele', () => {
    const uses = productionUses('createPinnedConnector', 'connector.ts');
    expect(uses.length, `konektor nikdo nevolá:\n${uses.join('\n')}`).toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('transport.ts'))).toBe(true);
  });

  it('safeFetch má produkčního volajícího mimo vlastní soubor', () => {
    const uses = productionUses('safeFetch(', 'safe-fetch.ts');
    expect(uses.length, 'safeFetch nikdo nevolá, extrakce by nikdy nešla ven').toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('runtime.ts'))).toBe(true);
  });

  it('kontrola prostředí se opravdu provádí při startu', () => {
    const uses = productionUses('assertNoLeakedProviderKeys', 'env-guard.ts');
    expect(uses.length, 'druhá vrstva kritéria 7b se nikdy nezavolá').toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('runtime.ts'))).toBe(true);
  });

  /**
   * OPRAVA VADNÉHO TESTU, ne změkčení pravidla. Vylučovací argument se porovnával
   * jako holé jméno souboru, takže `runtime.ts` vyhodilo ze seznamu i skutečného
   * spotřebitele `apps/web/src/lib/ai/runtime.ts`, který se jmenuje stejně.
   * Test proto hlásil „kompoziční kořen AI nikdo nevolá" v okamžiku, kdy ho
   * `instrumentation.ts` prokazatelně volal, což dokládá i test o dva níž.
   * Vylučuje se tedy CELÁ CESTA definičního souboru, ne jeho jméno.
   *
   * Zuby testu tím nepovolily, naopak: reexport z barelu se nově taky nepočítá,
   * takže `createBrandRuntime` je dál vidět jako nezapojený, což je pravda.
   */
  it('kompoziční kořen AI má volajícího v aplikaci', () => {
    const ai = productionUses('createAiRuntime', 'packages/core/src/ai/runtime.ts');
    expect(ai.length, 'kompoziční kořen AI nikdo nevolá').toBeGreaterThan(0);
  });

  /**
   * TENHLE TEST BYL ČERVENÝ A ZEZELENAL TÍM, ŽE CHYBĚJÍCÍ ŘETĚZ VZNIKL,
   * ne tím, že by se změkčilo jeho tvrzení. Tvrzení je doslova totéž jako
   * v době, kdy padal.
   *
   * Co chybělo a co to nahradilo:
   *
   * - Zápisová část repozitáře. `repo/extractions.repo.ts` uměl jen číst;
   *   dnes má `markRunning`, `finishExtraction` a `failStaleExtractions`
   *   a `repo/profiles.repo.ts` má `insertBrandProfile`.
   * - Továrna `BrandExtractDeps`. Skládá ji `brand/jobs/brand-extract-deps.ts`
   *   a je to jediné místo, kde vzniká skutečný resolver a skutečný přenos:
   *   volá `createBrandRuntime`, takže tenhle test měří právě ji.
   * - Obsluha fronty se srovnaným podpisem. `brand/jobs/brand-extract-handler.ts`
   *   vystavuje `QueueHandler` složený přes `perJob`; dřívější `handler`
   *   s podpisem `(job: { data, deps })` neměl worker čím zavolat.
   *
   * Kdyby test spadl znovu, znamená to, že někdo ten řetěz rozpojil.
   * NEUPRAVUJ HO, oprav zapojení.
   */
  it('kompoziční kořen značky má volajícího v aplikaci', () => {
    const brand = productionUses('createBrandRuntime', 'packages/core/src/brand/runtime.ts');
    expect(
      brand.length,
      'kompoziční kořen značky nikdo nevolá: extrakce by šla ven bez resolveru a bez přenosu',
    ).toBeGreaterThan(0);
  });

  /**
   * Řetěz musí být celý, ne jen jeho první článek. `createAiRuntime` sice má
   * volajícího (`lib/ai/runtime.ts`), ale kdyby ten modul nikdo nespustil,
   * kontrola prostředí by se pořád neprovedla. Startovní bod web procesu je
   * `instrumentation.ts`, takže se hlídá jmenovitě.
   */
  it('kompoziční kořen AI se skládá při startu web procesu', () => {
    const uses = productionUses('getAiRuntime', 'lib/ai/runtime.ts');
    expect(uses.some((line) => line.includes('instrumentation.ts'))).toBe(true);
  });

  /**
   * Skládání šablony bylo hotové, otestované a NIKDO HO NEVOLAL: nástroj
   * `compose_template` vracel `ai_tool_unavailable`, takže panel asistenta byl
   * formulář bez následku. Uživatel odeslal zadání, viděl kroky generování
   * a pak nic. Tatáž třída vady jako I71, o patro níž.
   */
  it('composeTemplateDraft má produkčního volajícího, ne jen testy', () => {
    const uses = productionUses('composeTemplateDraft(', 'packages/core/src/ai/compose.ts');
    expect(
      uses.length,
      'skládání šablony nikdo nevolá, panel asistenta by nic nevygeneroval',
    ).toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('api/internal/ai/chat/route.ts'))).toBe(true);
  });

  /**
   * Druhá polovina téhož. Kdyby `composeTemplateDraft` někdo volal jinde, ale
   * nástroj by dál hlásil nedostupnost, byl by test výš zelený a asistent by
   * pořád nefungoval.
   */
  it('nástroj compose_template už nehlásí nedostupnost', () => {
    let out = '';
    try {
      out = execFileSync(
        'grep',
        ['-rn', '--include=*.ts', "unavailableTool('compose_template')", 'apps/web/src'],
        { cwd: ROOT, encoding: 'utf8' },
      );
    } catch {
      out = '';
    }
    expect(out, 'compose_template je pořád zaslepený, i když implementace existuje').toBe('');
  });

  /**
   * Bez tohohle se do `ai_messages` ukládal celý návrh šablony, tedy desítky
   * kilobajtů na jednu zprávu. Funkce existovala, jen se z jejího modulu bralo
   * pouze `MAX_RAW_OUTPUT_CHARS`, takže modul v grafu byl a rozhodnutí v něm ne.
   */
  it('compactToolResult se opravdu použije při ukládání zprávy', () => {
    const uses = productionUses(
      'compactToolResult(',
      'packages/core/src/ai/conversation-service.ts',
    );
    expect(uses.length, 'výsledky nástrojů se ukládají celé').toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('api/internal/ai/chat/route.ts'))).toBe(true);
  });

  it('truncateRawOutput se opravdu použije, surová odpověď se nikam nevejde celá', () => {
    const uses = productionUses(
      'truncateRawOutput(',
      'packages/core/src/ai/conversation-service.ts',
    );
    expect(uses.length, 'surová odpověď modelu se nikde nezkracuje').toBeGreaterThan(0);
    expect(uses.some((line) => line.includes('src/ai/compose.ts'))).toBe(true);
  });

  it('měřený fetch se v produkci opravdu používá, klíč tedy neteče do logu', () => {
    const uses = productionUses('createMeteredFetch(', 'metered-fetch.ts');
    expect(uses.length, 'odchozí volání jde mimo měřený fetch').toBeGreaterThan(0);
  });

  it('v brand nezůstal globální stav místo předané závislosti', () => {
    let out = '';
    try {
      out = execFileSync('grep', ['-rn', '__mlainResolver', 'packages/core/src'], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    } catch {
      out = '';
    }
    // ODCHYLKA OD PLÁNU, oprava vadného testu: plánované znění grepovalo
    // i tenhle soubor, ve kterém to slovo z podstaty věci je, a stejně tak
    // komentář „dřív se to četlo z globálního stavu, dnes už ne". Věta o tom,
    // že se něco nedělá, není dělání té věci.
    const hits = out
      .split('\n')
      .filter((line) => line !== '')
      .filter((line) => !line.includes('.test.'))
      .filter(isCode);
    expect(hits.join('\n'), 'resolver se zase čte z globálního stavu').toBe('');
  });
});
