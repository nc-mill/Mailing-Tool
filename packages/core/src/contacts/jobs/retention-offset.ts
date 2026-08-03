import { createHash } from 'node:crypto';

/**
 * Rozprostření denních retenčních běhů v čase. ČISTÝ VÝPOČET, nic jiného.
 *
 * PROČ SAMOSTATNÝ SOUBOR. Modul bydlel v `retention-dispatch.ts` a shazoval
 * test disciplíny izolace `identity/scope.test.ts`: pravidlo hlídá exportované
 * funkce, které berou `workspaceId: string` bez `ctx: WorkspaceContext` nebo
 * `tx: Tx` v téže signatuře, a to v souborech, které SAHAJÍ DO DATABÁZE.
 * `retentionOffsetSeconds` do databáze nesahá a o izolaci nerozhoduje, jenže
 * sousedila s dispečerem, který do databáze sahá, takže premisa pravidla
 * platila pro celý soubor.
 *
 * Rozdělení tu premisu ODSTRAŇUJE, místo aby pravidlo obcházelo: tenhle soubor
 * neimportuje `drizzle-orm`, `@mlain/db` ani adaptér `../../tx` a nikdy nesmí.
 * Jakmile by sem někdo dotaz přidal, pravidlo znovu platí a test zčervená, což
 * je přesně to, co má dělat.
 *
 * `workspaceId` tu není klíč k datům, ale VSTUP HASHE. Špatně předané id vyrobí
 * jiné číslo sekund, nic víc; žádný řádek se podle něj nevybírá.
 */

/**
 * Šířka okna, do kterého se běhy rozprostřou. Cron tiká ve 4:20, poslední
 * projekt jde na řadu v 7:20.
 */
export const RETENTION_SPREAD_SECONDS = 3 * 60 * 60;

/**
 * Deterministický offset projektu uvnitř okna.
 *
 * Hash, ne pořadí v seznamu: pořadí se mění přibytím projektu, takže by se
 * všem ostatním posunul čas běhu. Hash drží projekt na svém místě navždy.
 *
 * Recept se NESMÍ měnit bez důvodu: prvních 32 bitů SHA-256 nad textem id,
 * modulo šířka okna. Změna receptu přesune všem projektům noční okno naráz.
 */
export function retentionOffsetSeconds(
  workspaceId: string,
  spreadSeconds: number = RETENTION_SPREAD_SECONDS,
): number {
  if (spreadSeconds <= 0) return 0;
  const digest = createHash('sha256').update(workspaceId).digest();
  return digest.readUInt32BE(0) % spreadSeconds;
}
