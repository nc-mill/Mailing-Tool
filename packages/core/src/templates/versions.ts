import { and, asc, desc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { designHash } from '@mlain/emails/document/canonical';
import type { Document } from '@mlain/emails/document/types';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';
import { syncAssetReferences } from './asset-references';
import { assetIdsInDocument } from './assets';

export type VersionReason = 'manual' | 'pre_send' | 'ai_apply' | 'restore' | 'import';
export type VersionRow = typeof schema.templateVersions.$inferSelect;

export type CreateVersionInput = {
  reason: VersionReason;
  design?: Document;
  label?: string;
  pinned?: boolean;
  createdBy?: string;
  /**
   * Vyplňuje **P13** při `reason: "pre_send"`, viz požadavek R12. Tenhle plán
   * sám kompilovanou podobu do verze neukládá, takže bez P13 zůstanou sloupce
   * `compiled_html`, `compiled_text`, `compile_meta` a `renderer_version` NULL.
   */
  compiled?: { html: string; text: string; meta: unknown; rendererVersion: string };
};

/**
 * Číslo verze je max(version) + 1 pod zámkem řádku šablony. Bez `FOR UPDATE`
 * by dvě souběžná uložení vyrobila dvě verze se stejným číslem a unikátní index
 * by jedno z nich shodil až v okamžiku commitu.
 *
 * `tx` je UŽ uvnitř transakce, kterou otevřel volající přes `withWorkspace`.
 * Vlastní `tx.transaction()` se tady nesmí objevit: vydá druhý `BEGIN` na témž
 * spojení a jeho `COMMIT` potvrdí vnější transakci, takže zápis přežije i její
 * `ROLLBACK`. Ověřeno spuštěním, viz kapitola 0.7.
 */
export async function createVersion(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
  input: CreateVersionInput,
): Promise<VersionRow> {
  const [template] = await tx
    .select()
    .from(schema.templates)
    .where(and(eq(schema.templates.id, templateId), wsEq(ctx, schema.templates)))
    .for('update');
  if (!template) throw new Error('not_found');

  const design = input.design ?? (template.design as Document);
  const hash = designHash(design);

  const [latest] = await tx
    .select()
    .from(schema.templateVersions)
    .where(
      and(wsEq(ctx, schema.templateVersions), eq(schema.templateVersions.templateId, templateId)),
    )
    .orderBy(desc(schema.templateVersions.version))
    .limit(1);
  // Verze se nevytvoří při shodě hashe s poslední verzí (3.10.1).
  if (latest && latest.designHash.equals(hash)) return latest;

  const [row] = await tx
    .insert(schema.templateVersions)
    .values({
      workspaceId: ctx.workspaceId,
      templateId,
      version: (latest?.version ?? 0) + 1,
      schemaVersion: design.schemaVersion,
      design,
      designHash: hash,
      compiledHtml: input.compiled?.html ?? null,
      compiledText: input.compiled?.text ?? null,
      compileMeta: input.compiled?.meta ?? null,
      rendererVersion: input.compiled?.rendererVersion ?? null,
      label: input.label ?? null,
      reason: input.reason,
      pinned: input.pinned ?? false,
      createdBy: input.createdBy ?? null,
    })
    .returning();

  // Verze drží vlastní kopii dokumentu, takže drží i vlastní reference na assety.
  // Bez toho by úklid smazal obrázek, který je jen ve staré verzi, a obnovení
  // té verze by vrátilo šablonu s rozbitým obrázkem.
  await syncAssetReferences(
    tx,
    ctx,
    { refType: 'template_version', refId: row!.id },
    assetIdsInDocument(design),
  );

  await tx
    .update(schema.templates)
    .set({ currentVersionId: row!.id, updatedAt: new Date() })
    .where(and(eq(schema.templates.id, templateId), wsEq(ctx, schema.templates)));
  return row!;
}

export async function listVersions(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
): Promise<VersionRow[]> {
  return tx
    .select()
    .from(schema.templateVersions)
    .where(
      and(wsEq(ctx, schema.templateVersions), eq(schema.templateVersions.templateId, templateId)),
    )
    .orderBy(desc(schema.templateVersions.createdAt));
}

/**
 * Obnovení je vždy dopředné: historie se nikdy nepřepisuje ani nemaže.
 *
 * `usedFields` musí spočítat volající, protože k tomu potřebuje katalog polí,
 * a ten je doména P07, ne repository. Bez něj by po obnovení zůstala v
 * `used_fields` pole z PŘEDCHOZÍHO návrhu: dopadová analýza by ukazovala pole,
 * která v šabloně nejsou, a neukazovala ta, která v ní po obnovení jsou.
 */
export async function restoreVersion(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
  version: number,
  usedFields: string[],
): Promise<VersionRow> {
  const [source] = await tx
    .select()
    .from(schema.templateVersions)
    .where(
      and(
        wsEq(ctx, schema.templateVersions),
        eq(schema.templateVersions.templateId, templateId),
        eq(schema.templateVersions.version, version),
      ),
    );
  if (!source) throw new Error('not_found');
  const design = source.design as Document;
  await tx
    .update(schema.templates)
    .set({
      design,
      designHash: designHash(design),
      // Verze uložená před migrací dokumentu má JINÝ schemaVersion než šablona.
      // Kdyby se nepřepsal, sloupec by hlásil novou verzi u starého dokumentu
      // a `loadDocument` by migraci nespustil.
      schemaVersion: design.schemaVersion,
      usedFields,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.templates.id, templateId), wsEq(ctx, schema.templates)));

  await syncAssetReferences(
    tx,
    ctx,
    { refType: 'template', refId: templateId },
    assetIdsInDocument(design),
  );

  return createVersion(tx, ctx, templateId, {
    reason: 'restore',
    design,
    label: `Obnoveno z verze ${version}`,
  });
}

/**
 * Retence: nepřipnuté verze starší než N dní a nad rámec M nejnovějších.
 * Připnuté verze se nemažou nikdy, jsou důkazem, co přesně se rozeslalo.
 *
 * Z obou mazání je vyloučená verze, na kterou míří `templates.current_version_id`.
 * Cizí klíč má `ON DELETE SET NULL`, takže její smazání by NIKDE nespadlo:
 * šablona by jen tiše ztratila ukazatel a API by začalo vracet
 * `current_version: null` bez zjevné příčiny. Příznak `pinned` ji nechrání,
 * ten drží jen verze použité kampaní.
 */
export async function pruneVersions(
  tx: Tx,
  ctx: WorkspaceContext,
  options: { retentionDays: number; maxUnpinned: number },
): Promise<number> {
  const currentIds = await tx
    .select({ id: schema.templates.currentVersionId })
    .from(schema.templates)
    .where(and(wsEq(ctx, schema.templates), sql`${schema.templates.currentVersionId} IS NOT NULL`));
  const protectedIds = new Set(currentIds.map((row) => row.id!).filter(Boolean));
  // ODCHYLKA OD PLÁNU. Plán psal `sql`... <> ALL(${[...protectedIds]}::uuid[])``.
  // Drizzle interpolované pole ROZLOŽÍ na jednotlivé parametry, takže do `$n`
  // dorazí jediné UUID a Postgres ho odmítne jako „malformed array literal"
  // (22P02). Ověřeno spuštěním. `notInArray` vydá `id not in ($4, $5, …)`,
  // tedy totéž bez ručního skládání pole.
  const notProtected =
    protectedIds.size === 0 ? undefined : notInArray(schema.templateVersions.id, [...protectedIds]);

  let removed = 0;

  if (options.retentionDays > 0) {
    const cutoff = new Date(Date.now() - options.retentionDays * 86_400_000);
    const result = await tx
      .delete(schema.templateVersions)
      .where(
        and(
          wsEq(ctx, schema.templateVersions),
          eq(schema.templateVersions.pinned, false),
          lt(schema.templateVersions.createdAt, cutoff),
          ...(notProtected ? [notProtected] : []),
        ),
      )
      .returning({ id: schema.templateVersions.id });
    removed += result.length;
    for (const row of result) await releaseVersionAssets(tx, ctx, row.id);
  }

  const templates = await tx
    .selectDistinct({ id: schema.templateVersions.templateId })
    .from(schema.templateVersions)
    .where(wsEq(ctx, schema.templateVersions));
  for (const template of templates) {
    const unpinned = await tx
      .select({ id: schema.templateVersions.id })
      .from(schema.templateVersions)
      .where(
        and(
          wsEq(ctx, schema.templateVersions),
          eq(schema.templateVersions.templateId, template.id),
          eq(schema.templateVersions.pinned, false),
          ...(notProtected ? [notProtected] : []),
        ),
      )
      .orderBy(asc(schema.templateVersions.createdAt));
    const excess = unpinned.slice(0, Math.max(0, unpinned.length - options.maxUnpinned));
    if (excess.length === 0) continue;
    await tx.delete(schema.templateVersions).where(
      inArray(
        schema.templateVersions.id,
        excess.map((row) => row.id),
      ),
    );
    for (const row of excess) await releaseVersionAssets(tx, ctx, row.id);
    removed += excess.length;
  }
  return removed;
}

/** Se smazanou verzí zaniká i její nárok na assety, jinak reference_count nikdy neklesne. */
async function releaseVersionAssets(
  tx: Tx,
  ctx: WorkspaceContext,
  versionId: string,
): Promise<void> {
  await syncAssetReferences(tx, ctx, { refType: 'template_version', refId: versionId }, []);
}
