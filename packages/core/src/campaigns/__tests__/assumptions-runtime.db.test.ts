/**
 * Krok 4 úkolu 1 plánu P13. Je tady proto, že se plán na tomhle už jednou spálil:
 * původní podoba importovala `withTx` z `@mlain/db/tx` a volala `tx.query(text, params)`.
 * Ani jedno neexistuje. `@mlain/db` nemá zástupný export, takže podcesta skončí
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`, a `Tx` je Drizzle handle, jehož `query` je OBJEKT,
 * ne funkce. Test se schválně neptá zdrojáků P03 ani P04, ptá se běžícího modulu
 * a běžící databáze, protože přesně tam se ten rozdíl pozná.
 *
 * ODCHYLKA OD PLÁNU: plán měl tyhle testy ve stejném souboru jako kontrolu registrů.
 * Jsou oddělené, protože potřebují běžící Postgres, a slévat je dohromady by znamenalo
 * startovat kontejner i kvůli otázce „je kód v registru".
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withTestWorkspace, type TestWorkspace } from '../test/harness';

describe('predpoklady P13 o balickovem rozhrani', () => {
  let ctx: TestWorkspace;
  beforeAll(async () => {
    ctx = await withTestWorkspace();
  });

  it('@mlain/core/campaigns je importovatelny podcestou', async () => {
    const mod = await import('@mlain/core/campaigns');
    expect(mod).toBeTypeOf('object');
  });

  it('@mlain/core/providers je importovatelny podcestou', async () => {
    const mod = await import('@mlain/core/providers');
    expect(mod).toBeTypeOf('object');
  });

  it('transakcni vrstva je @mlain/core/tx a bere ctx bez poolu', async () => {
    const mod = await import('@mlain/core/tx');
    expect(typeof mod.withWorkspace).toBe('function');
    expect(typeof mod.withReadOnly).toBe('function');
    expect(typeof mod.pgErrorCode).toBe('function');
    // Dvouargumentova signatura. Kdyby P04 pridal pool jako prvni parametr,
    // vsech zhruba sto volani v P13 by se rozeslo.
    expect(mod.withWorkspace.length).toBe(2);
  });

  it('@mlain/db NEMA podcestu k repository, a je to zamerne', async () => {
    // Specifikator se sklada za behu. Napsany doslova ho Vite vyhodnoti uz pri
    // transformaci a shodil by cely soubor, misto aby test chytil odmitnuty slib.
    const specifier = ['@mlain/db', 'repo', 'campaigns', 'outbox'].join('/');
    await expect(import(/* @vite-ignore */ specifier)).rejects.toThrow(
      /ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find module|Failed to resolve|not exported/i,
    );
  });

  it('Tx nema metodu query, takze syrovy SQL musi jit pres rawSql', async () => {
    const { withWorkspace } = await import('@mlain/core/tx');
    await withWorkspace(ctx.workspace, async (tx) => {
      // Kdyby tohle byla funkce, rawSql by nebyl potreba. Neni.
      expect(typeof (tx as unknown as { query: unknown }).query).not.toBe('function');
      expect(typeof tx.execute).toBe('function');
    });
  });
});
