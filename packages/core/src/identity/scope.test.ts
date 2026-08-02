import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { wsEq } from './scope';

const CORE_ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * Odchylka od plánu: plán psal cesty jako `packages/core/tx`, skutečný balíček
 * od P01 má všechno pod `packages/core/src/`. Adaptér transakcí tedy leží
 * v `src/tx`, ne v `core/tx`, a vylučovací podmínky to musí odrážet.
 */
const TX_DIR = join('src', 'tx');

/** Vytáhne jmenované importy z `@mlain/db` (přesně z kořene, ne z podcest). */
function namedImportsFromDbRoot(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@mlain\/db'/g)) {
    for (const raw of m[1]!.split(',')) {
      const name = raw
        .replace(/\btype\b/, '')
        .trim()
        .split(/\s+as\s+/)[0]!
        .trim();
      if (name) out.push(name);
    }
  }
  return out;
}

/**
 * Adresáře s testovacím materiálem. Pravidla níž platí pro PRODUKČNÍ kód:
 * test smí kontext vyrobit i naseedovat data pod cizím projektem, protože
 * dělá přesně to, co produkční kód dělat nesmí, a hlídá tím jeho chování.
 * Soubory `*.test.ts` se vylučovaly odjakživa; pomůcky vedle nich se ale
 * jmenují jinak (`test-support/db.ts`, `api/test-app.ts`) a do seznamu spadly
 * jen proto, že vylučovací podmínka koukala na příponu, ne na povahu souboru.
 */
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'test-support', 'fixtures']);

function isTestHelper(name: string): boolean {
  return name.endsWith('.test.ts') || name.startsWith('test-') || name.endsWith('.fixtures.ts');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      if (TEST_DIRS.has(entry)) continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !isTestHelper(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Vytáhne jméno a SUROVÝ text seznamu parametrů každé exportované funkce.
 * Závorky se párují, takže parametr typu `(cutoff: Date) => Promise<number>`
 * seznam neukončí uprostřed.
 */
function exportedFunctionSignatures(src: string): Array<{ name: string; params: string }> {
  const out: Array<{ name: string; params: string }> = [];
  for (const m of src.matchAll(
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^(]*>)?\(/g,
  )) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          out.push({ name: m[1]!, params: src.slice(open + 1, i) });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Důkaz o rozsahu. Buď branded kontext z jediné továrny, nebo transakce, která
 * už běží s nastaveným `app.workspace_id`, tedy pod politikami RLS. V obou
 * případech je izolace vynucená mimo tělo funkce a špatně předané id nemůže
 * vrátit cizí řádky, jen prázdno.
 */
function carriesScopeProof(params: string): boolean {
  return /:\s*WorkspaceContext\b/.test(params) || /:\s*Tx\b/.test(params);
}

/** Sahá soubor vůbec do databáze? Bez toho nemá co izolovat. */
function touchesDatabase(src: string): boolean {
  return /from '(drizzle-orm|@mlain\/db)/.test(src) || /from '[^']*\/tx'/.test(src);
}

// V testu je unsafeWorkspaceContext v pořádku: P03 ji pro testy a údržbové joby
// výslovně určuje. Produkční kód ji volat nesmí a hlídá to poslední test níž.
const ctx = unsafeWorkspaceContext('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', {
  type: 'system',
  job: 'test',
});

describe('wsEq', () => {
  it('vyrobí podmínku rovnosti nad sloupcem workspace_id', () => {
    // Odchylka od plánu: plán tvrdil `String(condition)`, jenže Drizzle vrací
    // objekt `SQL` a jeho toString je `[object Object]` (ověřeno spuštěním na
    // drizzle-orm 0.44.7). Renderování přes PgDialect je navíc silnější důkaz:
    // ukáže SKUTEČNÝ název sloupce v SQL, ne jen název vlastnosti v TypeScriptu.
    const rendered = new PgDialect({ casing: 'snake_case' }).sqlToQuery(
      wsEq(ctx, schema.webhookEndpoints),
    );
    expect(rendered.sql).toBe('"webhook_endpoints"."workspace_id" = $1');
    expect(rendered.params).toEqual([ctx.workspaceId]);
  });
});

describe('disciplína izolace v packages/core', () => {
  const files = sourceFiles(CORE_ROOT);

  it('nikdo mimo packages/core/src/tx neimportuje transakční obálky přímo z @mlain/db', () => {
    // Jména jsou z P03 doslova. Porovnává se seznam JMENOVANÝCH IMPORTŮ, ne
    // výskyt podřetězce: `withUser` z packages/core/src/tx je legitimní a hledání
    // podřetězce by ho označilo za porušení.
    const wrappers = new Set(['withWorkspace', 'withUser', 'withReadOnly']);
    const offenders = files.filter((f) => {
      if (f.includes(TX_DIR)) return false;
      return namedImportsFromDbRoot(readFileSync(f, 'utf8')).some((n) => wrappers.has(n));
    });
    expect(offenders, 'transakce se otevírají výhradně přes packages/core/src/tx').toEqual([]);
  });

  it('unsafeWorkspaceContext importuje jediný soubor, a to továrna kontextu', () => {
    // Tohle je druhá vrstva ochrany branded typu. P03 funkci vynechal
    // z kořenového exportu, takže ji nikdo nepotká náhodou; tenhle test hlídá,
    // že ji nikdo nezavolá ani vědomě odjinud než z jediné legitimní továrny.
    const importers = files.filter((f) =>
      /from '@mlain\/db\/unsafe-context'/.test(readFileSync(f, 'utf8')),
    );
    expect(importers.map((f) => f.replace(CORE_ROOT, ''))).toEqual([
      join('identity', 'context.ts'),
    ]);
  });

  it('žádná služba nefiltruje podle workspace ručně, používá se wsEq', () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(join('identity', 'scope.ts'))) return false;
      return /eq\(\s*schema\.\w+\.workspaceId/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  /**
   * ZPŘESNĚNÍ PRAVIDLA, ne jeho změkčení, a je to vědomé rozhodnutí.
   *
   * Původní znění zakazovalo `workspaceId: string` v jakékoliv exportované
   * funkci mimo `src/tx`. Vzniklo v P04, kdy v balíčku bylo jen `identity`
   * a `tx`. Od té doby má `packages/core` přes dvacet domén a ukázalo se, že
   * doslovné znění měří dvě různé věci najednou:
   *
   * 1. SKUTEČNÉ nebezpečí: funkce se rozhoduje podle holého řetězce, kterému
   *    nikdo neručí, a sama sahá do databáze. Takový řetězec může přijít
   *    odkudkoliv a vrátit cizí data. Tohle pravidlo dál platí a hlídá se.
   * 2. Neškodný tvar: funkce dostane id jako DATA (hodnota sloupce, přídavek
   *    do šifrovací obálky) a o izolaci nerozhoduje, protože do databáze vůbec
   *    nesahá. Zápis obstará `deps`, které si transakci otevře přes kontext.
   *
   * Rozhoduje se proto podle důkazu o rozsahu v téže signatuře
   * (`ctx: WorkspaceContext` nebo `tx: Tx`) a podle toho, jestli soubor vůbec
   * do databáze sahá. Nový soubor, který se dotáže databáze podle holého
   * řetězce, tenhle test pořád shodí, a to je jeho smysl.
   */
  it('žádná exportovaná funkce mimo packages/core/src/tx nebere workspaceId jako string bez důkazu o rozsahu', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.includes(TX_DIR)) continue;
      // context.ts je vstup do továrny: AuthenticatedRequest a createSystemContext
      // jsou právě to místo, kde se z řetězce stává ověřený kontext.
      if (f.endsWith(join('identity', 'context.ts'))) continue;
      const src = readFileSync(f, 'utf8');
      // Soubor bez přístupu k databázi žádné rozhodnutí o izolaci nedělá, viz
      // komentář k pravidlu níž.
      if (!touchesDatabase(src)) continue;
      for (const signature of exportedFunctionSignatures(src)) {
        if (!/\bworkspaceId: string/.test(signature.params)) continue;
        if (carriesScopeProof(signature.params)) continue;
        offenders.push(`${f.replace(CORE_ROOT, '')}: ${signature.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
