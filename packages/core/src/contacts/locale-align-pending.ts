import { sql } from 'drizzle-orm';
import type { Tx } from '../tx';

/**
 * ČEKAJÍCÍ SJEDNOCENÍ JAZYKA KONTAKTŮ, ULOŽENÉ MIMO NÁKLAD ÚLOHY.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Fronta `contacts.recompute_greeting` má politiku
 * `stately` a klíč projektu: dokud jedna úloha leží ve stavu `created`, další
 * se ZAHODÍ a ve frontě přežije ta STARŠÍ i se svým nákladem. `discardNote`
 * v registru front to obhajuje slibem, že „čekající běh si nastavení načte, až
 * začne, takže pokryje i tu změnu, kvůli které byl požadavek zahozen".
 *
 * U textu oslovení to platí, protože vykání i tykání se čte z databáze. U JAZYKA
 * to neplatilo: směr sjednocení ležel výhradně v nákladu a se zahozenou úlohou
 * se ztratil. Naměřené následky:
 *
 *  1. Kdo přepnul projekt na angličtinu a hned zpátky na češtinu, dostal běh se
 *     směrem `cs → en` nad projektem, který je česky. Tedy PROJEKT V ČEŠTINĚ
 *     A KONTAKTY V ANGLIČTINĚ, přesně ten stav, kvůli kterému běh vznikl.
 *  2. Kontakt založený mezi oběma přepnutími zdědil jazyk mezikroku a nepokryl
 *     ho ani jeden z obou směrů.
 *  3. Změna vykání zařadila úlohu BEZ sjednocení jazyka; následná změna jazyka
 *     se o ni sloučila a zmizela celá, protože přeživší úloha o jazyku nevěděla.
 *
 * ŘEŠENÍM NENÍ ZRUŠIT SLUČOVÁNÍ. Přepočet sahá na každý kontakt projektu a
 * rozklikané nastavení by frontu zahltilo desítkami běhů nad týmiž řádky. Klíč
 * projektu zůstává; z nákladu se stěhuje jen to, co se nesmí ztratit.
 *
 * CO SE UKLÁDÁ. Množina VÝCHOZÍCH jazyků, tedy `from` jednotlivých požadavků.
 * Cíl v ní není a být nesmí: tím je vždy aktuální `workspaces.locale`, který si
 * běh přečte, až na něj přijde řada. Prvek `null` znamená „srovnej všechno",
 * tedy ruční hromadnou akci z nastavení.
 *
 * Chování na řetězci `cs → en → cs` je pak tohle: množina je `{cs, en}`, cíl
 * `cs`, takže kontakty se starou češtinou zůstanou a kontakt založený nad
 * angličtinou se srovná na češtinu. Přesně to, co by udělaly oba běhy za sebou.
 *
 * KDE SE UKLÁDÁ. Vlastní větev `workspaces.settings -> 'greeting_locale_align'`.
 * Do větve `contacts` to nepatří: ta má schéma `.strict()` s `.catch()`, takže
 * by neznámý klíč tiše shodil ČTENÍ CELÉ větve na výchozí hodnoty a projekt by
 * po každé změně jazyka přišel o nastavení vokativu. Vlastní větev je zároveň
 * důvod, proč tu není migrace: sloupec `settings` je `jsonb` bez schématu a
 * každá doména čte jen tu svou větev (viz hlavička `contacts/settings.ts`).
 *
 * Nejde o uživatelské nastavení a ven se nevydává: `toPublicWorkspace` vypisuje
 * jmenovaná pole, ne celý sloupec.
 */

/**
 * Výchozí jazyky, které čekají na sjednocení. `null` je „všechny kontakty
 * s jiným jazykem, než má projekt".
 */
export type PendingLocaleAlign = readonly (string | null)[];

/** Cesta k větvi. Jedno místo, aby se čtení a zápis nemohly rozejít. */
const BRANCH = 'greeting_locale_align';

/**
 * Zapíše požadavek na sjednocení. Volá se v TÉŽE transakci jako změna jazyka
 * projektu a jako zařazení úlohy, takže po odvolání transakce nezůstane ani
 * požadavek, ani úloha.
 *
 * Zapisuje se SLOUČENÍM přes `||`, ne `SET settings = ...`: vedle téhle větve
 * bydlí poštovní adresa, soukromí, měření i průvodce prvním spuštěním a
 * přepsání celého sloupce by je zahodilo. Množina se drží unikátní přes
 * `jsonb_agg(DISTINCT ...)`, protože týž směr se může zařadit vícekrát.
 */
export async function recordPendingLocaleAlign(
  tx: Tx,
  workspaceId: string,
  from: string | null,
): Promise<void> {
  await tx.execute(sql`
    UPDATE workspaces
       SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
             ${BRANCH}::text,
             jsonb_build_object('pending', (
               SELECT coalesce(jsonb_agg(DISTINCT v), '[]'::jsonb)
                 FROM jsonb_array_elements(
                        coalesce(settings -> ${BRANCH}::text -> 'pending', '[]'::jsonb)
                        || ${JSON.stringify([from])}::jsonb
                      ) AS v
             ))
           )
     WHERE id = ${workspaceId}::uuid
  `);
}

/**
 * Co v projektu čeká. Vrací prázdné pole i tehdy, když větev nikdy nevznikla
 * nebo v ní leží něco jiného než pole řetězců: požadavek na sjednocení se
 * neopraví tím, že běh spadne, a poškozený zápis nesmí zablokovat přepočet
 * oslovení, který na jazyku nezávisí.
 */
export async function readPendingLocaleAlign(
  tx: Tx,
  workspaceId: string,
): Promise<PendingLocaleAlign> {
  const { rows } = await tx.execute<{ pending: unknown }>(sql`
    SELECT coalesce(settings -> ${BRANCH}::text -> 'pending', '[]'::jsonb) AS pending
      FROM workspaces WHERE id = ${workspaceId}::uuid
  `);
  const pending = rows[0]?.pending;
  if (!Array.isArray(pending)) return [];
  return pending.filter((item): item is string | null => item === null || typeof item === 'string');
}

/**
 * Smaže PRÁVĚ TY položky, které běh zpracoval, ne celou větev.
 *
 * Rozdíl je vidět jen v souběhu, a přesně proto tu je: `stately` pustí jednu
 * úlohu běžící a jednu čekající, takže během přepočtu může přibýt další změna
 * jazyka. Vymazat větev celou by ten nový požadavek zahodilo a přeživší úloha
 * by o něm nevěděla, tedy tatáž ztráta, kvůli které tenhle soubor vznikl.
 *
 * Volá se AŽ PO doběhnutí průchodu. Kdyby se mazalo předem, ztratil by se
 * požadavek s během, který spadl v půlce, a opakování by ho už nenašlo.
 */
export async function clearPendingLocaleAlign(
  tx: Tx,
  workspaceId: string,
  consumed: PendingLocaleAlign,
): Promise<void> {
  if (consumed.length === 0) return;
  await tx.execute(sql`
    UPDATE workspaces
       SET settings = coalesce(settings, '{}'::jsonb) || jsonb_build_object(
             ${BRANCH}::text,
             jsonb_build_object('pending', (
               SELECT coalesce(jsonb_agg(v), '[]'::jsonb)
                 FROM jsonb_array_elements(
                        coalesce(settings -> ${BRANCH}::text -> 'pending', '[]'::jsonb)
                      ) AS v
                WHERE NOT (${JSON.stringify(consumed)}::jsonb @> jsonb_build_array(v))
             ))
           )
     WHERE id = ${workspaceId}::uuid
  `);
}
