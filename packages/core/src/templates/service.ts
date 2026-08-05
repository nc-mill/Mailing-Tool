import { and, count, eq, isNull, like, ne } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { buildBaseTemplate, type BaseTemplateParams } from '@mlain/emails/base/build';
import { buildRenderSchema } from '@mlain/emails/compile/render-schema';
import { newBlockId } from '@mlain/emails/document/ids';
import type { Document } from '@mlain/emails/document/types';
import type { FieldCatalog } from '../contacts/fields/catalog';
// Závory e-mailů seznamu. Vlastní je doména kontaktů, protože jsou to jeho
// sloupce a jeho rozhodnutí; tahle doména volá jedinou funkci a o rolích
// `confirmation`, `welcome` a `goodbye` nic neví. Viz `saveDesign`.
import { assertListEmailDocument } from '../contacts/lists/list-email-guards';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import { pgErrorCode, withWorkspace, type Tx } from '../tx';
import { syncAssetReferences } from './asset-references';
import { assetIdsInDocument, loadAssetRefs } from './assets';
import { writeTemplatesAudit } from './audit';
import {
  createTemplateRow,
  findDeletedTemplateById,
  findTemplateById,
  loadTemplateUsage,
  renameTemplateRow,
  restoreTemplateRow,
  setValidationState,
  softDeleteTemplate,
  updateTemplateDesign,
  validationProfileFor,
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
    // Profil, ne `kind`. Pracovní obsah kampaně (`kind = 'system'`) se kontroluje
    // jako kampaň, jinak by editor mlčel tam, kde odeslání spadne.
    templateKind: validationProfileFor(kind),
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

    /*
     * ZÁVORY SEZNAMU. Nesmí se odstranit jako nadbytečné.
     *
     * Šablona připojená k seznamu jako potvrzovací, uvítací nebo rozloučovací
     * má dvě podmínky, které doména šablon nezná a znát nemá, protože jsou to
     * vlastnosti VAZBY, ne šablony: potvrzovací e-mail musí nést odkaz na
     * potvrzení a uvítací ani rozloučovací nesmí nést odhlašovací odkaz.
     *
     * Kontroluje se to i při připojení šablony k seznamu (`PATCH /lists/{id}`),
     * jenže obsah se dá upravit kdykoli potom. Bez téhle závory by se autor
     * o rozbitém potvrzovacím e-mailu dozvěděl až tím, že se lidem nedaří
     * dokončit přihlášení, a o odhlašovacím odkazu v uvítacím e-mailu vůbec:
     * odešel by s prázdným `href` a nic by nespadlo.
     *
     * Nepřipojené šablony se to netýká, funkce se pro ně vrátí bez dotazu navíc.
     */
    await assertListEmailDocument(tx, ctx.ctx, templateId, document, ctx.fields);

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
 * Přejmenování šablony.
 *
 * Jméno se OŘEZÁVÁ o mezery a prázdné se odmítne. Zod na trase hlídá délku
 * 1 až 120, jenže samé mezery projdou: `"   "` má délku tři a databázové
 * `ck_templates__name_len` ho pustí taky. Vznikla by šablona s neviditelným
 * jménem, kterou v knihovně nejde ani najít, ani odlišit od ostatních.
 *
 * Dokument se mění SPOLU s řádkem, důvod je rozepsaný u `renameTemplateRow`:
 * `meta.name` je předmět odesílaného e-mailu, ne kopie jména pro parádu.
 *
 * Stav kontroly se nepřepočítává. Změna `meta.name` nemůže platný dokument
 * zneplatnit ani naopak: schéma na něm chce jen délku 1 až 120, což je táž
 * podmínka, jakou tahle funkce právě ověřila.
 */
export async function renameTemplate(
  ctx: ServiceContext,
  templateId: string,
  name: string,
): Promise<TemplateRow> {
  const trimmed = name.trim();
  if (trimmed === '') throw new Error('template_name_empty');

  return withWorkspace(ctx.ctx, async (tx) => {
    const row = await findTemplateById(tx, ctx.ctx, templateId);
    if (!row) throw new Error('not_found');
    // Beze změny se nezapisuje: přejmenování na tutéž hodnotu by jen posunulo
    // `updated_at` a vystřelilo šablonu na začátek knihovny řazené podle
    // poslední změny, přestože se v ní nic nezměnilo.
    if (row.name === trimmed) return row;

    const design = row.design as Document;
    const renamed: Document = { ...design, meta: { ...design.meta, name: trimmed } };
    let updated: TemplateRow;
    try {
      updated = await renameTemplateRow(tx, ctx.ctx, templateId, trimmed, renamed);
    } catch (error) {
      // `uq_templates__workspace_name` je na `lower(name)` mezi nesmazanými.
      if (pgErrorCode(error) === '23505') throw new Error('template_name_conflict');
      throw error;
    }
    // Ve stejné transakci jako zápis (3.7). V metadatech je STARÉ i NOVÉ jméno:
    // bez starého se z auditu nedá poznat, která šablona se přejmenovala, protože
    // pod původním názvem ji už nikdo nenajde.
    await writeTemplatesAudit(tx, ctx.ctx, {
      action: 'template.renamed',
      targetId: templateId,
      metadata: { from: row.name, to: trimmed },
    });
    return updated;
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

/**
 * MĚKKÉ smazání, ne tvrdé, a je to rozhodnutí o důkazech, ne o pohodlí.
 *
 * Tabulka `templates` má sloupec `deleted_at` a oba výpisy i `findTemplateById`
 * podle něj filtrují, takže řádek po smazání z rozhraní zmizí. Kdyby se místo
 * toho mazal řádek, vzalo by to s sebou kaskádou `template_versions`, tedy
 * i verze označené `pinned = true`, což je uložený důkaz, co přesně se
 * rozeslalo. `campaigns.template_id` má sice `ON DELETE SET NULL`, takže by
 * kampaň nespadla, ale ztratila by stopu, z čeho vznikla.
 *
 * KAMPANĚ SMAZÁNÍ NEPOCIŤUJÍ. Kampaň si obsah drží ve vlastních sloupcích
 * (`campaigns.design`, `compiled_html`, `compiled_text`), šablona je jen
 * předloha, ze které se jednou převzal. Odkaz `template_id` po měkkém smazání
 * navíc dál ukazuje na existující řádek, takže se nemá co porušit.
 *
 * FORMULÁŘE A SEZNAMY ANO, A PROTO SE JIM ŠABLONA POD RUKAMA NESMAŽE.
 * `forms.delivery_template_id`, `lists.confirmation_template_id`
 * a `lists.welcome_template_id` neukazují na předlohu, ale na e-mail, který se
 * ŽIVĚ odesílá při každém vyplnění formuláře a při každém přihlášení. Měkce
 * smazaná šablona z `findTemplateById` nevypadne, takže by odesílání přestalo
 * fungovat tiše: formulář by dál sbíral adresy a jeho e-mail by nikam nechodil.
 * Tichá porucha je horší než odmítnutí, proto se maže až po odpojení.
 */
export async function deleteTemplate(ctx: ServiceContext, templateId: string): Promise<void> {
  await withWorkspace(ctx.ctx, async (tx) => {
    const row = await findTemplateById(tx, ctx.ctx, templateId);
    if (!row) throw new Error('not_found');
    // Dodávané šablony jde jen skrýt, ne smazat.
    if (row.starter) throw new Error('template_starter_immutable');
    const usage = (await loadTemplateUsage(tx, ctx.ctx, [templateId])).get(templateId);
    if (usage && (usage.forms.length > 0 || usage.lists.length > 0)) {
      throw new Error('template_in_use');
    }
    await softDeleteTemplate(tx, ctx.ctx, templateId);
    // Smazaná šablona přestává držet assety. Verze si je drží dál, ty se mažou
    // až retencí, takže obrázek použitý ve staré verzi zůstane.
    await syncAssetReferences(tx, ctx.ctx, { refType: 'template', refId: templateId }, []);
    // Audit ve stejné transakci (3.7). Počet kampaní je v metadatech schválně:
    // je to odpověď na otázku, kterou si po smazání položí každý, tedy „koho se
    // to dotklo". Nula znamená, že šablonu nikdy nikdo nepoužil.
    await writeTemplatesAudit(tx, ctx.ctx, {
      action: 'template.deleted',
      targetId: templateId,
      metadata: {
        name: row.name,
        kind: row.kind,
        campaigns_using: await countCampaignsUsing(tx, ctx.ctx, templateId),
      },
    });
  });
}

/**
 * Vrácení smazané šablony zpět. Existuje proto, aby smazání nebylo nenávratné:
 * měkké smazání řádek zachovává, takže obnova je jedno UPDATE a rozhraní může
 * hned po smazání nabídnout „Vrátit zpět" místo věty „tohle už nevrátíte".
 *
 * Jméno může být mezitím zabrané: `uq_templates__workspace_name` platí jen mezi
 * nesmazanými řádky, takže nic nebrání založit novou šablonu téhož jména.
 * Taková obnova skončí konfliktem, ne přejmenováním za zády uživatele.
 */
export async function restoreTemplate(
  ctx: ServiceContext,
  templateId: string,
): Promise<TemplateRow> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const row = await findDeletedTemplateById(tx, ctx.ctx, templateId);
    // Nesmazaná šablona není chyba volajícího, ale ani není co obnovovat:
    // 404 by tvrdilo, že neexistuje, což je nepravda.
    if (!row) {
      const alive = await findTemplateById(tx, ctx.ctx, templateId);
      if (alive) return alive;
      throw new Error('not_found');
    }
    try {
      await restoreTemplateRow(tx, ctx.ctx, templateId);
    } catch (error) {
      if (pgErrorCode(error) === '23505') throw new Error('template_name_conflict');
      throw error;
    }
    // Vazby na assety se obnovují taky: smazání je zahodilo, takže by po návratu
    // šablona používala obrázky, ke kterým se nehlásí, a úklid assetů by je
    // považoval za nepoužité.
    await syncAssetReferences(
      tx,
      ctx.ctx,
      { refType: 'template', refId: templateId },
      assetIdsInDocument(row.design as Document),
    );
    await writeTemplatesAudit(tx, ctx.ctx, {
      action: 'template.restored',
      targetId: templateId,
      metadata: { name: row.name, kind: row.kind },
    });
    return { ...row, deletedAt: null };
  });
}

/** Kolik kampaní z šablony vzniklo. Jen do auditu a do dopadu v rozhraní. */
async function countCampaignsUsing(
  tx: Tx,
  ctx: WorkspaceContext,
  templateId: string,
): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        eq(schema.campaigns.templateId, templateId),
        // Systémová kampaň není kampaň uživatele, je to schránka na testovací
        // odeslání šablony. Počítat ji sem by číslo nafouklo o něco, co si
        // vyrobila aplikace sama.
        ne(schema.campaigns.kind, 'system'),
      ),
    );
  return row?.value ?? 0;
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
