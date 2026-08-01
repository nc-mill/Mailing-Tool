import { and, eq, isNull, like } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { buildBaseTemplate, type BaseTemplateParams } from '@mlain/emails/base/build';
import { buildRenderSchema } from '@mlain/emails/compile/render-schema';
import { newBlockId } from '@mlain/emails/document/ids';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import { pgErrorCode, withWorkspace, type Tx } from '../tx';
import { syncAssetReferences } from './asset-references';
import { assetIdsInDocument, loadAssetRefs } from './assets';
import {
  createTemplateRow,
  findTemplateById,
  setValidationState,
  softDeleteTemplate,
  updateTemplateDesign,
  type TemplateRow,
} from './repository';
import { validateTemplateDocument } from './validate';
import { restoreVersion, type VersionRow } from './versions';

/** Maximum z `ck_templates__name_len`. */
const NAME_MAX = 120;
/** Nejdelší přípona, kterou `copyName` může přidat: " (kopie 99)". */
const COPY_SUFFIX_MAX = 12;

export type ServiceContext = {
  /**
   * Branded kontext projektu. Transakci otevírá tahle vrstva, ne volající.
   *
   * ODCHYLKA OD PLÁNU: plán měl vedle `ctx` ještě `workspaceId: string`.
   * Dvě hodnoty téhož nesmí být vedle sebe, protože se dají nastavit rozdílně
   * a nic by to nechytilo. Projekt se čte výhradně z `ctx`.
   */
  ctx: WorkspaceContext;
  fields: FieldCatalog;
  userId?: string;
};

export type CreateTemplateInput = {
  name: string;
  kind?: 'campaign' | 'transactional' | 'system';
  starter?: boolean;
} & ({ document: Document } | { baseTemplate: BaseTemplateParams });

/** Sjednocení použitých cest a podmínkových cest, aby pole použité jen v podmínce nezmizelo z dopadové analýzy. */
function computeUsedFields(ctx: ServiceContext, document: Document): string[] {
  const schemaOf = buildRenderSchema(document, { fields: ctx.fields, skippedBlockIds: new Set() });
  return [...new Set([...schemaOf.fields.map((field) => field.path), ...schemaOf.presence])];
}

async function validateAndStore(
  tx: Tx,
  ctx: ServiceContext,
  templateId: string,
  document: Document,
  kind: TemplateRow['kind'],
): Promise<void> {
  const assets = await loadAssetRefs(tx, ctx.ctx, assetIdsInDocument(document));
  const result = validateTemplateDocument(document, {
    templateKind: kind,
    fields: ctx.fields,
    assetIds: new Set(Object.keys(assets)),
  });
  await setValidationState(tx, ctx.ctx, templateId, result.state, result.issues);
}

export async function createTemplate(
  ctx: ServiceContext,
  input: CreateTemplateInput,
): Promise<TemplateRow> {
  const source =
    'document' in input
      ? input.document
      : buildBaseTemplate(input.baseTemplate, { nextId: newBlockId });
  const kind = input.kind ?? 'campaign';
  const document: Document = { ...source, meta: { ...source.meta, name: input.name } };

  return withWorkspace(ctx.ctx, async (tx) => {
    const row = await createTemplateRow(tx, ctx.ctx, {
      name: input.name,
      kind,
      design: document,
      // Rovnou při vložení, ne druhým průchodem. Druhý průchod se stejným
      // dokumentem skončí na shodě hashe a sloupec by zůstal prázdný.
      usedFields: computeUsedFields(ctx, document),
      ...(ctx.userId ? { createdBy: ctx.userId } : {}),
      ...(input.starter === undefined ? {} : { starter: input.starter }),
    });
    await syncAssetReferences(
      tx,
      ctx.ctx,
      { refType: 'template', refId: row.id },
      assetIdsInDocument(document),
    );
    await validateAndStore(tx, ctx, row.id, document, kind);
    return (await findTemplateById(tx, ctx.ctx, row.id))!;
  });
}

/** Autosave. Vrací `changed: false`, když se hash nezměnil, takže se řádek nepřepisuje. */
export async function saveDesign(
  ctx: ServiceContext,
  templateId: string,
  document: Document,
  expectedHash?: Buffer,
): Promise<{ changed: boolean; row: TemplateRow }> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const current = await findTemplateById(tx, ctx.ctx, templateId);
    if (!current) throw new Error('not_found');
    const result = await updateTemplateDesign(
      tx,
      ctx.ctx,
      templateId,
      document,
      computeUsedFields(ctx, document),
      expectedHash,
    );
    if (result.changed) {
      await syncAssetReferences(
        tx,
        ctx.ctx,
        { refType: 'template', refId: templateId },
        assetIdsInDocument(document),
      );
      await validateAndStore(tx, ctx, templateId, document, current.kind);
    }
    return result;
  });
}

/**
 * Jméno kopie. Dvě omezení naráz, obě z P03:
 * `ck_templates__name_len` povoluje 1 až 120 znaků a `uq_templates__workspace_name`
 * je unikátní na `lower(name)` mezi nesmazanými. Bez zkrácení by nešla zkopírovat
 * šablona se 118znakovým jménem, bez pořadového čísla by druhá kopie spadla
 * na unikátním indexu, a obojí by skončilo jako 500.
 */
export function copyName(source: string, ordinal: number): string {
  const suffix = ordinal <= 1 ? ' (kopie)' : ` (kopie ${ordinal})`;
  const room = NAME_MAX - suffix.length;
  return `${source.slice(0, Math.max(1, room))}${suffix}`;
}

export async function duplicateTemplate(
  ctx: ServiceContext,
  templateId: string,
): Promise<TemplateRow> {
  const source = await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.ctx, templateId));
  if (!source) throw new Error('not_found');

  const base = source.name.slice(0, NAME_MAX - COPY_SUFFIX_MAX);
  const taken = await withWorkspace(ctx.ctx, async (tx) => {
    const rows = await tx
      .select({ name: schema.templates.name })
      .from(schema.templates)
      .where(
        and(
          wsEq(ctx.ctx, schema.templates),
          isNull(schema.templates.deletedAt),
          like(schema.templates.name, `${base}%`),
        ),
      );
    return new Set(rows.map((row) => row.name.toLowerCase()));
  });

  for (let ordinal = 1; ordinal <= 99; ordinal += 1) {
    const name = copyName(source.name, ordinal);
    if (taken.has(name.toLowerCase())) continue;
    try {
      return await createTemplate(ctx, {
        name,
        kind: source.kind,
        document: source.design as Document,
      });
    } catch (error) {
      // 23505 je souběh: mezi dotazem a vložením stihl jméno zabrat někdo jiný.
      // Kód se čte přes pgErrorCode, protože na `error.code` je undefined.
      if (pgErrorCode(error) !== '23505') throw error;
    }
  }
  throw new Error('template_name_conflict');
}

export async function deleteTemplate(ctx: ServiceContext, templateId: string): Promise<void> {
  await withWorkspace(ctx.ctx, async (tx) => {
    const row = await findTemplateById(tx, ctx.ctx, templateId);
    if (!row) throw new Error('not_found');
    // Dodávané šablony jde jen skrýt, ne smazat.
    if (row.starter) throw new Error('template_starter_immutable');
    await softDeleteTemplate(tx, ctx.ctx, templateId);
    // Smazaná šablona přestává držet assety. Verze si je drží dál, ty se mažou
    // až retencí, takže obrázek použitý ve staré verzi zůstane.
    await syncAssetReferences(tx, ctx.ctx, { refType: 'template', refId: templateId }, []);
  });
}

/**
 * Obnovení verze. Bydlí ve službě, ne v `versions.ts`, ze dvou důvodů:
 * transakci otevírá tahle vrstva a `usedFields` se počítá z katalogu polí,
 * který je doména P07 a repository o něm nesmí vědět.
 */
export async function restoreTemplateVersion(
  ctx: ServiceContext,
  templateId: string,
  version: number,
): Promise<VersionRow> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const [source] = await tx
      .select()
      .from(schema.templateVersions)
      .where(
        and(
          wsEq(ctx.ctx, schema.templateVersions),
          eq(schema.templateVersions.templateId, templateId),
          eq(schema.templateVersions.version, version),
        ),
      );
    if (!source) throw new Error('not_found');
    const template = await findTemplateById(tx, ctx.ctx, templateId);
    if (!template) throw new Error('not_found');
    const document = source.design as Document;
    const restored = await restoreVersion(
      tx,
      ctx.ctx,
      templateId,
      version,
      computeUsedFields(ctx, document),
    );
    // Obnovený dokument je starší, takže může být proti aktuálnímu katalogu polí
    // neplatný. Stav se přepočítá hned, jinak by šablona zůstala označená jako
    // platná podle návrhu, který v ní už není.
    await validateAndStore(tx, ctx, templateId, document, template.kind);
    return restored;
  });
}
