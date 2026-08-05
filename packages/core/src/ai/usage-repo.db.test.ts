import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { seedWorkspaceForCoreTests, type SeededWorkspace } from '../identity/test-helpers';
import { startPgHarness, type PgHarness } from '../test-support/pg-harness';
import { closePools, withWorkspace } from '../tx';
import { buildUsageReport, recordUsage } from './usage';
import { loadUsageRows, upsertDailyUsage } from './repo';

/**
 * DŮKAZ NAD SKUTEČNOU DATABÁZÍ, ne nad mockem.
 *
 * Jednotkové testy v `usage.test.ts` hlídají, co `recordUsage` POŠLE do
 * repozitáře. To je ale jen půlka cesty: mezi tím voláním a obrazovkou leží
 * `numeric(20,10)`, `ON CONFLICT DO UPDATE` a ovladač, který `numeric` vrací
 * jako řetězec. Každá z těch tří věcí umí částku tiše zkomolit, aniž by
 * jakýkoli mock cokoli poznal, a právě proto tenhle soubor existuje.
 *
 * Běží pod `mlain_app` s nastaveným kontextem projektu, tedy pod rolí, na
 * kterou dopadá RLS. Pod migrátorem by prošel, i kdyby politika chyběla.
 */
let harness: PgHarness;
let seeded: SeededWorkspace;

beforeAll(async () => {
  harness = await startPgHarness();
  seeded = await seedWorkspaceForCoreTests();
}, 180_000);

afterAll(async () => {
  await closePools();
  await harness?.stop();
}, 120_000);

/** Denní agregát tak, jak leží v tabulce, bez mapování repozitáře. */
async function rawRow(day: string, model: string) {
  const table = schema.aiUsageDaily;
  return withWorkspace(seeded.ctx, async (tx) => {
    const rows = await tx
      .select()
      .from(table)
      .where(and(eq(table.day, day), eq(table.model, model)));
    return rows[0];
  });
}

const deps = {
  upsertDailyUsage: (input: Parameters<typeof upsertDailyUsage>[1]) =>
    withWorkspace(seeded.ctx, (tx) => upsertDailyUsage(tx, input)),
};

describe('skutečná cena od poskytovatele se uloží a přečte zpátky', () => {
  it('částka i jednotka přežijí zápis, součet přes den i cestu zpět do sestavy', async () => {
    const day = '2026-08-03';
    const model = 'openrouter/skutecna-cena';

    // Dvě volání téhož dne, aby se ověřilo i sčítání přes ON CONFLICT.
    await recordUsage(
      {
        workspaceId: seeded.ctx.workspaceId,
        provider: 'openrouter',
        model,
        inputTokens: 1_200,
        outputTokens: 300,
        failed: false,
        day,
        reported: { cost: 0.0001234567, cacheReadTokens: 64, cacheWriteTokens: 8 },
      },
      deps,
    );
    await recordUsage(
      {
        workspaceId: seeded.ctx.workspaceId,
        provider: 'openrouter',
        model,
        inputTokens: 800,
        outputTokens: 200,
        failed: false,
        day,
        reported: { cost: 0.0000765433, cacheReadTokens: 36, cacheWriteTokens: 0 },
      },
      deps,
    );

    const row = await rawRow(day, model);
    expect(row).toBeDefined();
    expect(row!.requests).toBe(2);
    expect(row!.inputTokens).toBe(2_000);
    /*
     * 0,0001234567 + 0,0000765433 = 0,0002 PŘESNĚ. Ta rovnost je celý smysl
     * sloupce `numeric`: kdyby se částka sčítala v plovoucí čárce, vyjde
     * 0,00019999999999999998 a v přehledu se to za pár set volání nasčítá do
     * viditelného rozdílu. Kdyby sloupec spadl na `integer` (což se stane, když
     * se v součtu zapomene přetypovat na `numeric`), vyjde rovnou nula.
     */
    expect(Number(row!.reportedCost)).toBeCloseTo(0.0002, 12);
    expect(row!.reportedCostUnit).toBe('openrouter_credit');
    expect(Number(row!.cacheReadTokens)).toBe(100);
    expect(Number(row!.cacheWriteTokens)).toBe(8);

    // A teď celá cesta zpátky: repozitář, sestava, tedy to, co uvidí obrazovka.
    const rows = await withWorkspace(seeded.ctx, (tx) => loadUsageRows(tx, { from: day, to: day }));
    const stored = rows.find((r) => r.model === model);
    expect(stored).toBeDefined();
    // Ovladač vrací `numeric` jako řetězec. Repozitář z něj musí udělat číslo,
    // jinak by se v sestavě „sčítalo" spojováním řetězců.
    expect(typeof stored!.reportedCost).toBe('number');
    expect(stored!.reportedCost).toBeCloseTo(0.0002, 12);

    const report = buildUsageReport(rows.filter((r) => r.model === model));
    const entry = report.byModel[0]!;
    expect(entry.priceStatus).toBe('reported');
    expect(entry.reportedCost).toBeCloseTo(0.0002, 12);
    expect(entry.reportedCostUnit).toBe('openrouter_credit');
    expect(report.reportedCost).toBeCloseTo(0.0002, 12);
    expect(report.reportedCostUnit).toBe('openrouter_credit');
  });

  it('u poskytovatele bez hlášené ceny zůstanou sloupce prázdné, nevymýšlí se nula', async () => {
    const day = '2026-08-04';
    const model = 'claude-opus-5';

    await recordUsage(
      {
        workspaceId: seeded.ctx.workspaceId,
        provider: 'anthropic',
        model,
        inputTokens: 500,
        outputTokens: 100,
        failed: false,
        day,
      },
      deps,
    );

    const row = await rawRow(day, model);
    expect(row).toBeDefined();
    expect(row!.requests).toBe(1);
    /*
     * NULL, ne nula. Nula by v přehledu znamenala „poskytovatel nám za tenhle
     * den naúčtoval nic", což je tvrzení o cizí faktuře, které jsme nikde
     * nečetli. NULL říká pravdu: tuhle veličinu u tohohle poskytovatele
     * neměříme.
     */
    expect(row!.reportedCost).toBeNull();
    expect(row!.reportedCostUnit).toBeNull();
    expect(row!.cacheReadTokens).toBeNull();
    expect(row!.cacheWriteTokens).toBeNull();

    const rows = await withWorkspace(seeded.ctx, (tx) => loadUsageRows(tx, { from: day, to: day }));
    const stored = rows.find((r) => r.model === model)!;
    expect(stored.reportedCost).toBeNull();
    const report = buildUsageReport([stored]);
    // Anthropic je v ceníku, takže odhad ano, skutečná částka ne.
    expect(report.byModel[0]!.priceStatus).toBe('estimated');
    expect(report.byModel[0]!.reportedCost).toBeNull();
    expect(report.reportedCost).toBeNull();
    expect(report.reportedCostUnit).toBeNull();
  });

  it('další volání bez hlášené ceny nepřepíše dřív uloženou částku nulou', async () => {
    const day = '2026-08-05';
    const model = 'openrouter/zachovej-castku';

    await recordUsage(
      {
        workspaceId: seeded.ctx.workspaceId,
        provider: 'openrouter',
        model,
        inputTokens: 100,
        outputTokens: 10,
        failed: false,
        day,
        reported: { cost: 0.005, cacheReadTokens: 12, cacheWriteTokens: null },
      },
      deps,
    );
    /*
     * Druhé volání téhož modelu, u kterého poskytovatel cenu nevrátil (stane
     * se to při přerušeném proudu). Sloupec se NESMÍ dotknout: kdyby se
     * přepočítal z `coalesce(…, 0)`, spadla by uložená částka na nulu a den
     * by od té chvíle tvrdil, že byl zadarmo.
     */
    await recordUsage(
      {
        workspaceId: seeded.ctx.workspaceId,
        provider: 'openrouter',
        model,
        inputTokens: 100,
        outputTokens: 10,
        failed: true,
        day,
      },
      deps,
    );

    const row = await rawRow(day, model);
    expect(row!.requests).toBe(2);
    expect(row!.errors).toBe(1);
    expect(Number(row!.reportedCost)).toBeCloseTo(0.005, 12);
    expect(row!.reportedCostUnit).toBe('openrouter_credit');
    expect(Number(row!.cacheReadTokens)).toBe(12);
    expect(row!.cacheWriteTokens).toBeNull();
  });

  it('databáze sama nepustí částku bez jednotky', async () => {
    /*
     * Poslední záchranná brzda. Aplikace tuhle kombinaci nepošle (hlídá to
     * `recordUsage`), ale do tabulky se dá zapsat i ručním UPDATE při údržbě.
     * Omezení `ck_ai_usage_daily__reported_cost` to zastaví na úrovni databáze,
     * takže bezejmenné číslo, ke kterému si čtenář dosadí měnu podle citu,
     * v tabulce vzniknout nemůže.
     */
    const attempt = withWorkspace(seeded.ctx, (tx) =>
      tx.insert(schema.aiUsageDaily).values({
        workspaceId: seeded.ctx.workspaceId,
        day: '2026-08-06',
        provider: 'openrouter',
        model: 'openrouter/bez-jednotky',
        requests: 1,
        inputTokens: 1,
        outputTokens: 1,
        errors: 0,
        reportedCost: 1.5,
        reportedCostUnit: null,
      }),
    );

    /*
     * Ptáme se na JMÉNO OMEZENÍ, ne na text hlášky. Drizzle chybu ovladače
     * zabalí do vlastní se shrnutím dotazu, takže v `message` jméno omezení
     * není; původní chyba PostgreSQL zůstává v `cause` a v ní je pole
     * `constraint`. Test na text hlášky by prošel i tehdy, kdyby zápis spadl
     * na úplně jiném omezení.
     */
    await expect(attempt).rejects.toThrow();
    const error = await attempt.then(
      () => null,
      (caught: unknown) => caught,
    );
    const cause = (error as { cause?: { constraint?: string } } | null)?.cause;
    expect(cause?.constraint).toBe('ck_ai_usage_daily__reported_cost');
  });
});
