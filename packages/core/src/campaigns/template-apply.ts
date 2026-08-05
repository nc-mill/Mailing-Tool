import { ApiError } from '../errors/api-error';
import { withWorkspace, type WorkspaceContext } from '../tx';
import { compileCampaign } from './compile-service';
import type { CampaignCompilation } from './compile';
import { rawSql } from './repo/raw-sql';

/**
 * Použití šablony na kampaň: dokument se ZKOPÍRUJE do `campaigns.design`.
 *
 * `template_id` zůstává jen záznamem o původu. Odkaz by měnil minulost, protože
 * úprava šablony po odeslání by změnila obsah odeslané kampaně.
 *
 * Je to JEDINÁ cesta, která smí obsah kampaně PŘEPSAT. `PATCH /campaigns/{id}`
 * umí `design` nanejvýš poprvé vyplnit, když je prázdný, a přepsat ho neumí
 * vůbec; kdyby uměl, ztratila by se práce jediným uložením nastavení a uživatel
 * by se na to nikdy nestihl zeptat.
 *
 * Kompilace běží ve stejném volání. „Vezmi šablonu a připrav kampaň k odeslání"
 * je z pohledu uživatele jedna operace a rozdělená by nechala kampaň ve stavu,
 * kdy má nový obsah a staré `compiled_html`, tedy připravená odeslat něco jiného,
 * než co je na obrazovce.
 *
 * KAMPAŇ BEZ PŘEDMĚTU SE JEN NEZKOMPILUJE, PŘEVZETÍ OBSAHU TÍM NEPADÁ.
 *
 * Naměřeno v prohlížeči: uživatel odešel z rozepsané kampaně do editoru, napsal
 * e-mail a při návratu dostal 422 `campaign_subject_missing`. Obsah se přitom
 * zkopíroval (kopie a kompilace jsou dvě různé transakce a ta první už byla
 * potvrzená), takže chyba hlásila neúspěch operace, která se povedla, a uživatel
 * měl důvod myslet si, že o práci přišel.
 *
 * Předmět navíc patří do KROKU ZA obsahem: e-mail se píše první, předmět se
 * doplňuje potom. Vynucovat ho dřív, než se dá vůbec vstoupit do editoru, by
 * obracelo pořadí práce naruby. Kompilace je technická příprava k odeslání, ne
 * podmínka pro to, aby obsah v kampani vůbec směl být, takže se prostě odloží.
 *
 * Odeslat kampaň bez předmětu se tím NEDÁ: kontrola před odesláním hlásí
 * `campaign_subject_missing` jako chybu, `POST /campaigns/{id}/compile` na
 * chybějící předmět dál padá a odesílací cesta si kompilaci ověřuje znovu.
 * Kompilace se doplní sama při uložení nastavení, tedy hned jak předmět je.
 */
export type ApplyTemplateResult = {
  /** Měla kampaň obsah PŘED tímhle voláním? Rozhoduje o tom, co UI hlásí uživateli. */
  overwritten: boolean;
  /**
   * Výsledek kompilace, nebo `null`, když kampaň nemá předmět a kompilace se
   * proto odložila. `null` NENÍ chyba: obsah je v kampani uložený tak jako tak.
   */
  compilation: CampaignCompilation | null;
};

type ApplyRow = { status: string; had_content: boolean; has_subject: boolean; updated: number };

export async function applyTemplateToCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
  templateId: string,
): Promise<ApplyTemplateResult> {
  const row = await withWorkspace(ctx, async (tx) => {
    /*
     * Předchozí stav se čte ve VLASTNÍ větvi dotazu, ne z `RETURNING`. V Postgresu
     * vidí `RETURNING` řádek PO změně, takže `design IS NOT NULL` by tam vyšlo
     * pravdivě vždycky a UI by u každé kampaně hlásilo přepsání obsahu.
     *
     * Ze tří návratových hodnot se rozliší všechny tři možné výsledky: kampaň
     * neexistuje (prázdný výsledek), kampaň se nesmí měnit (`updated = 0`
     * u nepovoleného stavu) a šablona neexistuje (`updated = 0` u povoleného).
     */
    const r = await tx.execute<ApplyRow>(
      rawSql(
        `WITH before AS (
           SELECT status,
                  (design IS NOT NULL) AS had_content,
                  (btrim(coalesce(subject, '')) <> '') AS has_subject
             FROM campaigns
            WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND kind = 'campaign'
         ), upd AS (
           UPDATE campaigns c
              SET design = t.design,
                  template_id = t.id,
                  revision = c.revision + 1,
                  updated_at = now()
             FROM templates t
            WHERE c.id = $1 AND c.workspace_id = $2
              AND c.deleted_at IS NULL AND c.kind = 'campaign'
              AND c.status IN ('draft','schedule_missed','failed')
              AND t.id = $3 AND t.workspace_id = $2 AND t.deleted_at IS NULL
           RETURNING c.id
         )
         SELECT b.status, b.had_content, b.has_subject,
                (SELECT count(*) FROM upd)::int AS updated
           FROM before b`,
        [campaignId, ctx.workspaceId, templateId],
      ),
    );
    return r.rows[0] ?? null;
  });

  if (row === null) throw new ApiError('not_found', { params: { resource: 'campaign' } });
  if (row.updated === 0) {
    if (row.status !== 'draft' && row.status !== 'schedule_missed' && row.status !== 'failed') {
      // Obsah rozeslané kampaně je doklad o tom, co komu odešlo (rozhodnutí D18).
      throw new ApiError('campaign_locked', { params: { status: row.status } });
    }
    throw new ApiError('not_found', { params: { resource: 'template' } });
  }

  return {
    overwritten: row.had_content,
    compilation: row.has_subject ? await compileCampaign(ctx, campaignId) : null,
  };
}
