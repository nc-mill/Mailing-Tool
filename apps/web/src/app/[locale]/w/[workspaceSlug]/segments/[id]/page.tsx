import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { campaignSegmentDefinition, isCampaignSegmentKind } from '@mlain/core/segments';
/**
 * Tvar AST se bere ze STAVITELE, ne z jádra.
 *
 * Obojí popisuje tentýž JSON, ale jádro si typ odvozuje ze zodu, takže má
 * `not?: boolean | undefined`, kdežto stavitel `not?: boolean`. Při
 * `exactOptionalPropertyTypes: true` v tsconfigu monorepa to nejsou zaměnitelné
 * typy a přiřazení neprojde. Hranicí je tenhle soubor, tak se převod dělá tady,
 * jednou a viditelně, ne rozvolněním typu na jedné z obou stran.
 */
import type { SegmentAst } from '@mlain/ui/patterns/query-builder';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { buildFieldCatalog } from '@/features/segments/field-catalog';
import type { FieldClass } from '@/features/segments/operator-matrix';
import { SegmentEditor } from '@/features/segments/segment-editor';

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje:
 *
 *   TypeError: Cannot read properties of null (reading 'useContext')
 *   Export encountered an error on <cesta>, exiting the build.
 *
 * Chyba nemíří na příčinu, takže se hledá v komponentách. Statická podoba
 * téhle stránky přitom neexistuje: obsah je pro každého jiný.
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string; workspaceSlug: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/** Jediná hodnota, kterou z parametru bereme. Cokoliv jiného se ignoruje. */
function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const value = params[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * Předvyplněný návrh segmentu z reportu kampaně.
 *
 * VZNIKLO ZE STÍŽNOSTI. Report nabízí „Vytvořit segment z těch, kdo klikli"
 * a odkazuje sem s `?from_campaign=…&preset=clicked`. Ty parametry ale nikdo
 * nečetl, takže se otevřel PRÁZDNÝ stavitel a podmínku si musel uživatel
 * naklikat sám, přestože ji produkt umí složit jedním voláním.
 *
 * Návrh se schválně jen předvyplní a NEUKLÁDÁ se sám. Odkaz je GET a založit
 * jím trvalý pojmenovaný segment by znamenalo, že každé omylem znovu otevřené
 * tlačítko (nebo předběžné načtení odkazu prohlížečem) vyrobí další kopii.
 * Uživatel tedy vidí hotovou podmínku, hotový název i živý počet lidí
 * a zbývá mu jediné kliknutí na Uložit.
 *
 * Jméno kampaně se dotahuje ze souhrnu reportu, protože z něj vzniká název
 * segmentu. Když se nepodaří (smazaná kampaň, nedostupné API), návrh se
 * NEZAHODÍ: podmínka na `campaign_id` platí dál a název se doplní bez jména.
 */
async function campaignDraft(
  workspaceId: string,
  searchParams: Record<string, string | string[] | undefined>,
): Promise<{
  name: string;
  definition: SegmentAst;
  notices: string[];
  campaign: { id: string; name: string };
} | null> {
  const campaignId = readParam(searchParams, 'from_campaign');
  const preset = readParam(searchParams, 'preset');
  if (campaignId === null || !isCampaignSegmentKind(preset)) return null;

  const stats = await apiFetch<{ name: string }>(`/api/v1/campaigns/${campaignId}/stats`, {
    workspaceId,
  });
  const t = await getTranslations('segments');
  const campaignName =
    stats.ok && stats.data.name !== '' ? stats.data.name : t('fromCampaign.unknownCampaign');

  return {
    name:
      preset === 'clicked'
        ? t('fromCampaign.clickedName', { campaign: campaignName })
        : t('fromCampaign.notOpenedName', { campaign: campaignName }),
    definition: campaignSegmentDefinition(preset, campaignId) as SegmentAst,
    notices: [
      t('fromCampaign.prefilledNotice'),
      ...(preset === 'not_opened' ? [t('fromCampaign.notOpenedNotice')] : []),
    ],
    // Katalog polí ho potřebuje, jinak výběr pole u předvyplněné podmínky
    // zůstane prázdný. Viz `CatalogInput.campaign`.
    campaign: { id: campaignId, name: campaignName },
  };
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('segments');
  return { title: t('title') };
}

type ApiSegment = { id: string; name: string; definition: unknown };

/**
 * Katalog polí. Skládá se TADY, v serverové komponentě: matice operátorů
 * bydlí v `@mlain/core/segments`, který s sebou nese i přístup k databázi
 * a v prohlížeči by shodil celou stránku.
 */
type ApiContactField = {
  key: string;
  label: Record<string, string>;
  type: string;
  archived_at: string | null;
};

async function fieldCatalog(
  workspaceId: string,
  locale: string,
  greetingEnabled: boolean,
  selfId: string | null,
  campaign?: { id: string; name: string },
  definition?: unknown,
) {
  // Štítky a vlastní pole se dotahují STEJNĚ jako seznamy.
  //
  // Bez štítků nemá podmínka „Má štítek" z čeho vybírat a zbývá volný text,
  // ze kterého vznikne dotaz s neplatným uuid a pětistovka; viz komentář
  // u `CatalogInput.tags`. Vlastní pole se sem nedotahovala vůbec, takže je
  // ve stavitelli nešlo použít, přestože kompilátor je umí přeložit a jádro
  // pro ně má celou třídu operátorů.
  const [lists, segments, tags, contactFields] = await Promise.all([
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/segments', { workspaceId }),
    apiFetch<{ data: { id: string; name: string }[] }>('/api/v1/tags?limit=200', { workspaceId }),
    apiFetch<{ data: ApiContactField[] }>('/api/v1/contact-fields?limit=200', { workspaceId }),
  ]);
  const t = await getTranslations('segments');
  return buildFieldCatalog((key, values) => t(key, values), {
    greetingEnabled,
    lists: lists.ok ? lists.data.data.map((list) => ({ id: list.id, name: list.name })) : [],
    tags: tags.ok ? tags.data.data.map((tag) => ({ id: tag.id, name: tag.name })) : [],
    attributes: (contactFields.ok ? contactFields.data.data : [])
      // Archivované pole nové kontakty neplní, takže do nabídky nepatří.
      // Podmínku v UŽ ULOŽENÉM segmentu to nezneplatní, tu vyhodnocuje jádro.
      .filter((field) => field.archived_at === null)
      .map((field) => ({
        key: field.key,
        label: field.label[locale] ?? field.label['cs'] ?? field.key,
        fieldClass: field.type as FieldClass,
      })),
    segments: (segments.ok ? segments.data.data : [])
      .filter((segment) => segment.id !== selfId)
      .map((segment) => ({ id: segment.id, name: segment.name })),
    ...(campaign === undefined ? {} : { campaign }),
    ...(definition === undefined ? {} : { definition }),
  });
}

export default async function SegmentDetailPage({ params, searchParams }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  // `new` je pseudoidentita pro založení segmentu, ne uuid. Bez téhle větve
  // by odkaz „Postavit vlastní" skončil na 404 dřív, než uživatel něco napíše.
  if (id === 'new') {
    // Pořadí je dané: katalog musí vědět, ze které kampaně návrh přišel,
    // aby uměl pojmenovat pole předvyplněné podmínky.
    const draft = await campaignDraft(workspaceId, await searchParams);
    const fields = await fieldCatalog(
      workspaceId,
      locale,
      access.data.workspace.greeting_enabled,
      null,
      draft?.campaign,
      draft?.definition,
    );
    return (
      <SegmentEditor
        workspaceId={workspaceId}
        workspaceSlug={workspaceSlug}
        locale={locale}
        segment={null}
        {...(draft === null
          ? {}
          : { draft: { name: draft.name, definition: draft.definition, notices: draft.notices } })}
        fields={fields}
      />
    );
  }

  const found = await apiFetch<ApiSegment>(`/api/v1/segments/${id}`, { workspaceId });
  if (!found.ok) notFound();

  const fields = await fieldCatalog(
    workspaceId,
    locale,
    access.data.workspace.greeting_enabled,
    id,
    undefined,
    found.data.definition,
  );

  return (
    <SegmentEditor
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      locale={locale}
      segment={{ id: found.data.id, name: found.data.name, definition: found.data.definition }}
      fields={fields}
    />
  );
}
