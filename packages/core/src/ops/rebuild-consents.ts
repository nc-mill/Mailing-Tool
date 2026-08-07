import { sql } from 'drizzle-orm';
import { rebuildConsentStateIn } from '../contacts/jobs/consents-rebuild-state';
import { withAdminTx } from './db';

export type RebuildConsentsInput = {
  /**
   * `DATABASE_URL_MIGRATOR`. `consents` i `contact_consent_state` mají
   * `ws_isolation`, takže pod aplikační rolí bez kontextu by přepočet prošel,
   * zpracoval nula řádků a ohlásil hotovo.
   */
  adminUrl: string;
  workspaceId: string;
};

export type RebuildConsentsReport = { rebuilt: number };

/**
 * Přepočet `contact_consent_state` z append-only logu `consents` pro jeden projekt.
 *
 * PROČ TO EXISTUJE. Frontu `consents.rebuild_state` popisuje registr jako něco, co
 * se „zařazuje ručně po obnově ze zálohy nebo po migraci". Jenže žádný ruční způsob
 * v produktu nebyl: obsluha existovala, ale nevedla k ní ani cesta API, ani příkaz,
 * takže jediná možnost byl ruční INSERT do tabulky úloh pg-bossu. Je to nástroj na
 * obnovu a je potřeba přesně ve chvíli, kdy je nejmíň času psát SQL rukou.
 *
 * VZOREC SE NEOPISUJE. Vlastní příkaz vydává `rebuildConsentStateIn` z domény
 * kontaktů, tedy tentýž, který pouští obsluha fronty. Dvě definice toho, co znamená
 * „stav souhlasu", by se rozešly u obnovy ze zálohy, tedy v jediné chvíli, kdy na
 * tom záleží. Je to totéž rozhodnutí jako u `rebuildEngagement` a vzorce zapojení.
 *
 * BĚŽÍ TO POD MIGRÁTOREM, ne pod aplikační rolí s kontextem projektu jako obsluha
 * fronty. Důvod je stejný jako u ostatních provozních příkazů: obnova se pouští nad
 * instalací, o které operátor teprve zjišťuje, v jakém je stavu, a tichý nulový
 * výsledek kvůli RLS je tam ta nejdražší možná odpověď. Dotaz sám je omezený na
 * `workspace_id` v `WHERE`, takže obejití RLS nerozšiřuje jeho rozsah.
 */
export async function rebuildConsents(input: RebuildConsentsInput): Promise<RebuildConsentsReport> {
  const exists = await withAdminTx(input.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM workspaces
           WHERE id = ${input.workspaceId} AND deleted_at IS NULL`,
    );
    return rows.length > 0;
  });
  if (!exists) {
    throw new Error(
      `Projekt ${input.workspaceId} neexistuje. Přepočet se nespustil, aby se nulový výsledek ` +
        'nedal splést s hotovou prací.',
    );
  }

  return withAdminTx(input.adminUrl, (tx) => rebuildConsentStateIn(tx, input.workspaceId));
}
