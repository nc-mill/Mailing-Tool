import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { checkIsolationPrerequisites, createPool } from '@mlain/db';
import { withAdminTx } from '../db';
import { cannotRun, type DoctorCheck } from './types';

/** Výchozí hodnoty poolů z kapitoly 7 části 1: web 10, worker 10, sender 8. */
const POOL_BUDGET = { web: 10, worker: 10, sender: 8 } as const;

/**
 * Nejvyšší číslo migrace, které tahle image zná.
 *
 * Čte se ze **stejného zdroje pravdy**, ze kterého ho počítá migrační runner
 * v P03 (`entries.length`) i readiness v P01 (`EXPECTED_SCHEMA_VERSION`), tedy
 * z `packages/db/migrations/meta/_journal.json`.
 *
 * Proč ne funkce z P03: `maxKnownSchemaVersion()` v P03 **neexistuje**,
 * runner si `entries.length` počítá lokálně a nevyváží ho. Dopsat ji do
 * `packages/db` P16 nesmí, protože ten balíček vlastní P03. Čtvrtý nezávislý
 * výpočet téhož čísla by se rozešel, takže se čte týž soubor.
 *
 * Cesta se odvozuje od resolvovaného balíčku `@mlain/db`, ne relativně od
 * tohohle souboru: `packages/core` se překládá do `dist/`, takže relativní
 * hloubka se mezi vývojovým stromem a image liší. Hledá se nahoru, dokud
 * se nenajde `migrations/meta/_journal.json`.
 *
 * Když journal chybí (build bez migrací), vrací 0 a kontrola se přeskočí,
 * shodně s rozhodnutím D3 plánu P01.
 */
export async function knownSchemaVersion(): Promise<number> {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('@mlain/db'));
    for (let up = 0; up < 5; up += 1) {
      const journal = join(dir, 'migrations', 'meta', '_journal.json');
      try {
        const parsed = JSON.parse(await readFile(journal, 'utf8')) as { entries?: unknown[] };
        return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
      } catch {
        dir = dirname(dir);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

const checkSchemaVersion: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('verze schématu', 'Chybí DATABASE_URL_MIGRATOR.')];
  const current = await withAdminTx(ctx.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ schema_version: number }>(
      sql`SELECT schema_version FROM system_settings WHERE id = true`,
    );
    return Number(rows[0]!.schema_version);
  });
  const known = await knownSchemaVersion();
  // Nula znamená build bez migrací, tam se nekontroluje nic (shodně s P01).
  if (known === 0 || current <= known) return [];
  return [
    {
      id: 'schema_version_ahead',
      severity: 'critical',
      title: `Databáze je na schématu ${current}, tahle image zná nejvýš ${known}`,
      detail:
        'Starší aplikace by zapisovala do novějšího schématu a tiše ho poškodila, proto start ' +
        'končí kódem 5 s hláškou schema_version_ahead.',
      action:
        'Nasaďte image, která odpovídá databázi, nebo obnovte zálohu pořízenou před upgradem.',
    },
  ];
};

const checkConnectionBudget: DoctorCheck = async (ctx) => {
  // Jediná kontrola, která SMÍ jet pod aplikační rolí, protože `max_connections`
  // je parametr serveru, ne data, a RLS se na něj nevztahuje.
  const pool = createPool(ctx.appUrl, 'app', 1);
  try {
    const { rows } = await pool.query<{ max_connections: string }>(
      "SELECT current_setting('max_connections') AS max_connections",
    );
    const max = Number(rows[0]!.max_connections);
    const sum = POOL_BUDGET.web + POOL_BUDGET.worker + POOL_BUDGET.sender;
    if (sum < max) return [];
    return [
      {
        id: 'connection_pool_over_budget',
        severity: 'warning',
        title: `Součet poolů ${sum} se nevejde do max_connections ${max}`,
        detail:
          `Při MODE=all běží tři procesy proti jedné databázi: web ${POOL_BUDGET.web}, ` +
          `worker ${POOL_BUDGET.worker}, sender ${POOL_BUDGET.sender}.`,
        action: 'Zvyšte max_connections Postgresu, nebo snižte DATABASE_POOL_MAX.',
      },
    ];
  } finally {
    await pool.end();
  }
};

/**
 * Ověří, že se na APLIKAČNÍ roli row level security skutečně vztahuje.
 *
 * Celý model izolace projektů mlčky předpokládá, že `mlain_app` nevlastní
 * schéma a nemá BYPASSRLS. U samohostitele s managed PostgreSQL, kde je
 * k dispozici jediná role (typicky vlastník databáze), ten předpoklad
 * neplatí a **aplikace se rozeběhne úplně normálně, jen bez izolace**.
 * Nic nespadne a zákazník se to nedozví.
 *
 * Predikát vlastní P03 a exportuje ho jako `checkIsolationPrerequisites`;
 * P16 ho jen volá, aby existoval jeden popis toho, co izolaci ruší.
 * Tahle kontrola jako jediná v celém souboru míří SCHVÁLNĚ na `appUrl`:
 * předmětem kontroly je právě ta role, pod kterou běží aplikace.
 */
const checkIsolation: DoctorCheck = async (ctx) => {
  const pool = createPool(ctx.appUrl, 'app', 1);
  try {
    const reasons = await checkIsolationPrerequisites(pool);
    if (reasons.length === 0) return [];
    return [
      {
        id: 'isolation_prerequisites_missing',
        severity: 'critical',
        title: 'Projekty nejsou izolované, přestože aplikace běží normálně',
        detail:
          `${reasons.join('; ')}. Politiky RLS se na takovou roli neuplatní, takže dotaz ` +
          'jednoho projektu vrátí i data ostatních. Nic přitom neselže a v logu nebude nic.',
        action:
          'Spusťte aplikaci pod rolí mlain_app, která schéma nevlastní a nemá BYPASSRLS. ' +
          'U managed databáze, kde je jediná role, izolace projektů neplatí a víc projektů ' +
          'v jedné instalaci není bezpečné provozovat.',
      },
    ];
  } finally {
    await pool.end();
  }
};

export const runtimeChecks: readonly DoctorCheck[] = [
  checkSchemaVersion,
  checkConnectionBudget,
  checkIsolation,
];
