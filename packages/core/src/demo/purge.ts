import { sql } from 'drizzle-orm';
import { writeAuditLog } from '../audit/write';
import { clearAssetReferences } from '../templates/asset-references';
import type { Tx } from '../tx';
import { DemoAuditActions } from './audit';
import { parseDemoManifest, type DemoManifest } from './manifest';

export type PurgeInput = { workspaceId: string };

export type PurgeReport = {
  deleted: {
    contacts: number;
    lists: number;
    tags: number;
    segments: number;
    templates: number;
    campaigns: number;
  };
};

const EMPTY: PurgeReport = {
  deleted: { contacts: 0, lists: 0, tags: 0, segments: 0, templates: 0, campaigns: 0 },
};

/**
 * Maže se podle manifestu, ne podle značky `source_ref`. Uživatel může
 * ukázkový kontakt upravit a značku smazat; kdyby se mazalo podle značky,
 * takový kontakt by v projektu zůstal navždy a nešlo by se ho zbavit.
 * Manifest drží přesné identifikátory a je zdrojem pravdy.
 *
 * Bere `tx: Tx` a transakci otevírá volající přes `withWorkspace`. Bez
 * nastaveného kontextu projektu by `SELECT ... FOR UPDATE` nad `workspaces`
 * vrátil prázdno, funkce by vrátila `EMPTY` a **ohlásila by hotovo, aniž by
 * cokoli smazala.** To je tichá porucha přesně toho druhu, kterou uživatel
 * odhalí až po druhém pokusu.
 */
export async function purgeDemoData(tx: Tx, input: PurgeInput): Promise<PurgeReport> {
  const { rows: ws } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE`,
  );
  const manifest = parseDemoManifest(ws[0]?.settings['demoData']);
  if (manifest === null) return EMPTY;

  const report = await deleteAll(tx, input.workspaceId, manifest);

  await tx.execute(sql`
    UPDATE workspaces SET settings = settings - 'demoData', updated_at = now()
     WHERE id = ${input.workspaceId}`);
  await writeAuditLog(tx, {
    action: DemoAuditActions['demo_data.purged'],
    workspaceId: input.workspaceId,
    actor: { actorType: 'system', actorId: null, actorLabel: 'demo.purge' },
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: report.deleted,
  });
  return report;
}

/**
 * CO SE MAZAT NEDÁ A PROČ TO NENÍ CHYBA.
 *
 * Ukázková kampaň se nikdy neodesílala, takže po ní nezůstávají zprávy ani
 * události. Když ale uživatel z ukázkové šablony pošle zkušební e-mail nebo
 * projede zlatou cestu, vzniknou řádky v `messages` a `message_events`.
 * `messages` smazat jde, `message_events` **ne**: migrace 0006 odebírá roli
 * `mlain_app` právo UPDATE i DELETE na téhle tabulce, protože je append only.
 * Totéž platí pro `web_events`.
 *
 * Je to záměr, ne mezera. `message_events` je auditní stopa doručování
 * a otvírat aplikaci právo ji mazat kvůli úklidu ukázkových dat by bylo
 * horší než pár osiřelých řádků, které nikdo nevidí, protože kampaň i kontakt
 * jsou pryč. Slib „beze zbytku" se proto vztahuje na objekty z manifestu,
 * ne na auditní stopu, a test to takhle ověřuje.
 */
async function deleteAll(
  tx: Tx,
  workspaceId: string,
  manifest: DemoManifest,
): Promise<PurgeReport> {
  const ws = workspaceId;

  // sql.param() je u seznamů povinné. Holé pole se rozloží na $1, $2, $3
  // a dotaz spadne na 42809 op ANY/ALL (array) requires array on right side.
  const ids = (list: readonly string[]) => sql.param([...list]);

  /**
   * ODKAZY NA OBRÁZKY SE RUŠÍ PRVNÍ, JEŠTĚ PŘED SAMOTNÝM MAZÁNÍM.
   *
   * `asset_references.ref_id` je polymorfní (šablona, verze šablony, kampaň),
   * takže na něm nemůže být cizí klíč a `DELETE FROM templates` ani
   * `DELETE FROM campaigns` po sobě odkazy neuklidí. Dokud se rušily jen
   * v mazacích službách (`deleteTemplate`, `softDeleteCampaign`), byl tenhle
   * tvrdý úklid ukázkových dat třetí cestou, která je vyráběla.
   *
   * Zůstat po nich osiřelý řádek NENÍ kosmetická vada: `listPurgeCandidates`
   * bere jen assety s `reference_count = 0`, takže by osiřelá reference
   * NATRVALO zablokovala fyzický úklid obrázku, a knihovna médií by u něj
   * hlásila použití v šabloně, kterou nikdo nevidí.
   *
   * VERZE ŠABLON SE MUSÍ DOHLEDAT TEĎ. `template_versions` visí na `templates`
   * cizím klíčem `ON DELETE CASCADE`, takže po smazání šablony se už nedá
   * zjistit, které verze existovaly, a jejich odkazy by osiřely bez šance na
   * nápravu. Proto se čtou dřív, než se cokoli smaže.
   */
  const { rows: versions } = await tx.execute<{ id: string }>(sql`
    SELECT id FROM template_versions
     WHERE workspace_id = ${ws} AND template_id = ANY(${ids(manifest.templateIds)})`);
  await clearAssetReferences(tx, ws, [
    { refType: 'campaign', refIds: manifest.campaignIds },
    { refType: 'template', refIds: manifest.templateIds },
    { refType: 'template_version', refIds: versions.map((row) => row.id) },
  ]);

  // Pořadí je dané cizími klíči: nejdřív listy stromu, potom jeho kořeny.
  for (const campaignId of manifest.campaignIds) {
    await tx.execute(sql`
      DELETE FROM campaign_stats WHERE campaign_id = ${campaignId} AND workspace_id = ${ws}`);
    await tx.execute(sql`
      DELETE FROM messages WHERE campaign_id = ${campaignId} AND workspace_id = ${ws}`);
  }
  const { rows: campaigns } = await tx.execute<{ id: string }>(sql`
    DELETE FROM campaigns WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.campaignIds)})
    RETURNING id`);

  const { rows: templates } = await tx.execute<{ id: string }>(sql`
    DELETE FROM templates WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.templateIds)})
    RETURNING id`);
  const { rows: segments } = await tx.execute<{ id: string }>(sql`
    DELETE FROM segments WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.segmentIds)})
    RETURNING id`);

  await tx.execute(sql`
    DELETE FROM contact_tags
     WHERE workspace_id = ${ws} AND contact_id = ANY(${ids(manifest.contactIds)})`);
  await tx.execute(sql`
    DELETE FROM list_subscriptions
     WHERE workspace_id = ${ws} AND contact_id = ANY(${ids(manifest.contactIds)})`);
  const { rows: contacts } = await tx.execute<{ id: string }>(sql`
    DELETE FROM contacts WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.contactIds)})
    RETURNING id`);

  const { rows: lists } = await tx.execute<{ id: string }>(sql`
    DELETE FROM lists WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.listIds)})
    RETURNING id`);
  const { rows: tags } = await tx.execute<{ id: string }>(sql`
    DELETE FROM tags WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.tagIds)})
    RETURNING id`);

  return {
    deleted: {
      contacts: contacts.length,
      lists: lists.length,
      tags: tags.length,
      segments: segments.length,
      templates: templates.length,
      campaigns: campaigns.length,
    },
  };
}
