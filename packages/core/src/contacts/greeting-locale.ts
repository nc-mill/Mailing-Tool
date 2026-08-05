import { sql } from 'drizzle-orm';
import { assertPermission } from '../identity/permissions';
import type { WorkspaceContext } from '../identity/types';
import { withWorkspace } from '../tx';
import { writeAudit } from './audit';
import { enqueue } from './jobs/enqueue';

/**
 * JAZYK, VE KTERÉM SE KONTAKT OSLOVUJE.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Oslovení se skládá podle jazyka KONTAKTU
 * (`contacts.locale`): z něj se bere věta („Dobrý den" versus „Hello") a podle něj se
 * počítá 5. pád, protože ten dávají jen čeština a slovenština. Kontakt ale svůj jazyk
 * ve většině případů nikdy nedostal od člověka: zdědil ho od projektu v okamžiku
 * vzniku. Projekt založený anglickým průvodcem tedy uložil `locale = 'en'` i lidem
 * s českými jmény a po přepnutí projektu na češtinu se nic nezměnilo, protože změna
 * nastavení projektu sama do žádného kontaktu nesahá.
 *
 * NAMĚŘENÝ PŘÍZNAK: kontakt „Petr Novák" s ručně potvrzeným tvarem „Petře" nesl
 * v databázi oslovení „Hello Petře", tedy anglickou předlohu s českým 5. pádem.
 *
 * ZDROJ PRAVDY ZŮSTÁVÁ `contacts.locale`, ne jazyk projektu. Jazyk je vlastnost
 * ČLOVĚKA, ne nastavení: v jednom projektu můžou být Češi, Slováci i cizinci a
 * odvozovat oslovení od projektu by je hodilo do jednoho pytle. Sloupec se ale nesmí
 * plnit potichu, jinak nejde poznat volbu od dědictví. Proto platí tři pravidla:
 *
 *  1. Jazyk projektu je jen VÝCHOZÍ hodnota pro nově zakládaný kontakt. Zápis, který
 *     jazyk nenese, ho u existujícího kontaktu nepřepisuje (`repo/contacts.ts`).
 *  2. Změna jazyka projektu srovná kontakty, které měly jazyk dosavadní, tedy ty,
 *     které si ho nezvolily (`identity/workspace-service.ts`).
 *  3. Zbytek spraví uživatel sám a hromadně tímhle modulem, kdykoliv se mu to
 *     rozejde. Jednotlivé kontakty se přes tisíc řádků opravovat nedají.
 */

export type GreetingLocaleSummary = {
  /** Jazyk projektu, tedy cíl sjednocení. */
  workspaceLocale: string;
  /** Živé kontakty projektu celkem. */
  total: number;
  /** Kolik z nich má jiný jazyk než projekt. Právě těch se sjednocení týká. */
  mismatched: number;
  /** Rozpad podle jazyka, sestupně. Bez něj by uživatel netušil, co vlastně srovnává. */
  byLocale: { locale: string; count: number }[];
};

/**
 * Podklad pro obrazovku nastavení. Čte se jedním dotazem: seznam jazyků je krátký
 * (jednotky hodnot), takže se počty dopočítají v aplikaci a databáze nemusí týž
 * dotaz vyhodnocovat třikrát.
 */
export async function greetingLocaleSummary(ctx: WorkspaceContext): Promise<GreetingLocaleSummary> {
  return withWorkspace(ctx, async (tx) => {
    const workspace = await tx.execute<{ locale: string }>(sql`
      SELECT locale FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
    `);
    const workspaceLocale = workspace.rows[0]?.locale ?? 'cs';

    const { rows } = await tx.execute<{ locale: string; count: string }>(sql`
      SELECT locale, count(*)::text AS count
        FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
         AND anonymized_at IS NULL
       GROUP BY locale
       ORDER BY count(*) DESC, locale
    `);

    const byLocale = rows.map((row) => ({ locale: row.locale, count: Number(row.count) }));
    const total = byLocale.reduce((sum, row) => sum + row.count, 0);
    const mismatched = byLocale
      .filter((row) => row.locale !== workspaceLocale)
      .reduce((sum, row) => sum + row.count, 0);

    return { workspaceLocale, total, mismatched, byLocale };
  });
}

/**
 * Hromadné sjednocení jazyka oslovení na jazyk projektu.
 *
 * VŽDY přes frontu, i pro tři kontakty. Přepočet sahá na jazyk, vokativ i hotovou
 * větu u každého kontaktu projektu a nad desítkami tisíc řádků to není práce pro
 * jeden HTTP požadavek. Rozhraní na 202 spoléhá: hlásí „přepočítáváme", ne
 * „přepočítáno".
 *
 * `from` se ZÁMĚRNĚ neposílá: tohle je výslovné rozhodnutí uživatele „srovnej to
 * všechno", takže se týká i kontaktů s jazykem, který nikdy jazykem projektu nebyl.
 * Automatické zařazení při změně jazyka projektu je opatrnější a `from` uvádí.
 *
 * Ručně potvrzené tvary přežijí: job je z konstrukce nepřepisuje a SQL to hlídá
 * podruhé (`jobs/recompute-greeting.ts`).
 */
export async function alignGreetingLocale(
  ctx: WorkspaceContext,
): Promise<{ mode: 'queued'; locale: string; affected: number }> {
  assertPermission(ctx, 'contacts:write');

  const summary = await greetingLocaleSummary(ctx);

  await withWorkspace(ctx, async (tx) => {
    await enqueue(
      tx,
      'contacts.recompute_greeting',
      { workspaceId: ctx.workspaceId, alignLocale: { to: summary.workspaceLocale, from: null } },
      { singletonKey: ctx.workspaceId },
    );
    await writeAudit(tx, ctx, {
      action: 'contact.greeting_locale_aligned',
      targetType: 'workspace',
      targetId: ctx.workspaceId,
      metadata: { locale: summary.workspaceLocale, affected: summary.mismatched },
    });
  });

  return { mode: 'queued', locale: summary.workspaceLocale, affected: summary.mismatched };
}
