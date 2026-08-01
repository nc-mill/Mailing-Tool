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

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
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

  it('žádná exportovaná funkce mimo packages/core/src/tx nebere workspaceId jako string', () => {
    const offenders = files.filter((f) => {
      if (f.includes(TX_DIR)) return false;
      // context.ts je vstup do továrny: AuthenticatedRequest a createSystemContext
      // jsou právě to místo, kde se z řetězce stává ověřený kontext.
      if (f.endsWith(join('identity', 'context.ts'))) return false;
      const src = readFileSync(f, 'utf8');
      return /export (async )?function [^(]*\([^)]*workspaceId: string/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
