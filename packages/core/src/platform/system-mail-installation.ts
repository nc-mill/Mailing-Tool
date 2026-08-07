import { sql } from 'drizzle-orm';
import type { Tx } from '../tx';

/**
 * Projekt, kterým instalace odesílá systémovou poštu, když ji nemá odkud vzít.
 *
 * PROČ TO EXISTUJE. Odesílací účty patří projektům a `sending_providers` má
 * izolaci po projektech, takže odesílatel musí vždycky nejdřív vědět, ZE
 * KTERÉHO projektu bere účet. U dvou z pěti systémových zpráv to nejde odvodit:
 * obnovu hesla si vyžádá nepřihlášený člověk a ten nemusí patřit nikam. Uživatel
 * odebraný z posledního projektu (stránka `no-workspace` takový stav zná) se pak
 * k obnově hesla nedostal vůbec, protože `resolveWorkspaceId` skončila chybou.
 *
 * Odpověď drží singleton `system_settings` pod klíčem `systemMail.workspace_id`.
 * Tabulka je jedna z mála BEZ RLS (`TABLES_WITHOUT_RLS` v `packages/db/src/rls.ts`)
 * a aplikační role do sloupce `settings` psát smí (migrace 0005, sloupcový grant),
 * takže se čte i zapisuje bez kontextu a bez migrace.
 *
 * PROČ SE PROJEKT NEHLEDÁ DOTAZEM PŘES CELOU INSTALACI, jak navrhoval plán
 * („nejstarší projekt s použitelným účtem přes `withoutContext`"): nejde to.
 * `workspaces` má politiku `ws_isolation_self` a `sending_providers` politiku
 * `ws_isolation`, takže pod aplikační rolí bez kontextu vrátí OBA dotazy nula
 * řádků. Vypadalo by to jako „instalace nemá žádný projekt", tedy jako správná
 * odpověď na špatnou otázku. Projekty umí projít jedině migrátorská role, kterou
 * má `mlain doctor`, a stavět obnovu hesla na přihlašovacích údajích migrátora
 * by bylo horší než ta chybějící zpráva.
 *
 * Klíč se proto plní SÁM: kdykoliv systémová pošta úspěšně vybere použitelný účet
 * pro nějaký projekt, zapíše se ten projekt jako projekt instalace, pokud tam
 * ještě žádný není. Po instalaci je tedy vyplněný od první odeslané zprávy
 * (typicky pozvánka nebo ověření adresy), a to je dřív, než může nastat případ
 * „uživatel bez projektu žádá o obnovu hesla".
 */
export const INSTALLATION_SYSTEM_MAIL_KEY = 'workspace_id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Přečte projekt systémové pošty instalace. `null` znamená „nikdo ho nenastavil
 * a ještě se nic neodeslalo".
 *
 * Nesmysl v klíči (ruční zásah do JSONu) se čte jako `null`, ne jako chyba:
 * odesílatel má na výběr ještě chybovou hlášku s návodem a ta je pro uživatele
 * srozumitelnější než pád na neplatném UUID uvnitř transakce.
 */
export async function readInstallationSystemMailWorkspace(tx: Tx): Promise<string | null> {
  const { rows } = await tx.execute<{ workspace_id: string | null }>(sql`
    SELECT settings #>> '{systemMail,workspace_id}' AS workspace_id
      FROM system_settings WHERE id = true LIMIT 1
  `);
  const value = rows[0]?.workspace_id ?? null;
  return value !== null && UUID_PATTERN.test(value) ? value : null;
}

/**
 * Zapamatuje si projekt instalace, POKUD tam ještě žádný není.
 *
 * Nepřepisuje: jakmile je klíč vyplněný, patří vlastníkovi instalace. Až
 * obrazovka Nastavení → Systémová pošta dostane volbu projektu (bod 10 plánu),
 * bude zapisovat do téhož klíče a tenhle mechanismus jí nesmí sahat pod ruku.
 *
 * `jsonb_set` s `create_missing = true` na dvouúrovňové cestě založí i chybějící
 * objekt `systemMail`, ale JEN když nadřazený klíč existuje. Proto se nejdřív
 * doplní prázdný objekt `systemMail` a teprve pak se do něj zapíše; jinak by se
 * na čerstvé instalaci (`settings = '{}'`) nezapsalo nic a tiše.
 *
 * Vrací `true`, když se opravdu zapsalo. Slouží testu, ne volajícímu.
 */
export async function rememberInstallationSystemMailWorkspace(
  tx: Tx,
  workspaceId: string,
): Promise<boolean> {
  const { rowCount } = await tx.execute(sql`
    UPDATE system_settings
       SET settings = jsonb_set(
             coalesce(settings, '{}'::jsonb) ||
               jsonb_build_object(
                 'systemMail',
                 coalesce(settings -> 'systemMail', '{}'::jsonb)
               ),
             '{systemMail,workspace_id}',
             to_jsonb(${workspaceId}::text),
             true
           ),
           updated_at = now()
     WHERE id = true
       AND settings #>> '{systemMail,workspace_id}' IS NULL
  `);
  return (rowCount ?? 0) > 0;
}
