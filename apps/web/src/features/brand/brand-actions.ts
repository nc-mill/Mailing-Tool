'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { findDefaultBrandProfile, saveDefaultBrandProfile } from '@mlain/core/brand';
import { getFieldCatalog } from '@mlain/core/contacts';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { redressTemplatesToBrand } from '@mlain/core/templates';
import { withWorkspace } from '@mlain/core/tx';
import type { Problem } from '@/lib/api-client/problem';
import { failed, succeeded, type ActionState } from '@/lib/feedback/action-result';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

const BRAND_PAGE_PATH = '/[locale]/w/[workspaceSlug]/settings/brand';

/**
 * Uzavřený seznam písem. Jsou to identifikátory `FontStackId` z `@mlain/emails`,
 * NE hotové CSS stacky, a je to podstatné: `brandToTheme` mapuje uloženou
 * hodnotu zpátky na `FontStackId` regulárními výrazy, a stack systémového
 * písma obsahuje „Segoe UI", takže by se z „system" stalo „tahoma". Uložený
 * identifikátor se namapuje sám na sebe u všech devíti hodnot.
 */
const FONT_STACKS = [
  'system',
  'arial',
  'helvetica',
  'verdana',
  'tahoma',
  'trebuchet',
  'georgia',
  'times',
  'courier',
] as const;

/** Šestimístný hex s křížkem, malými písmeny. Tvar, který čeká `brandToTheme`. */
const hex = z
  .string()
  .trim()
  .transform((value) => value.toLowerCase())
  .pipe(z.string().regex(/^#[0-9a-f]{6}$/));

const SaveSchema = z.object({
  workspace_slug: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  primary: hex,
  secondary: hex,
  accent: hex,
  background: hex,
  text: hex,
  heading_stack: z.enum(FONT_STACKS),
  body_stack: z.enum(FONT_STACKS),
  radius: z.coerce.number().int().min(0).max(16),
  /** Prázdný řetězec znamená „bez loga", ne chybějící pole. */
  logo_asset_id: z.union([z.literal(''), z.string().uuid()]),
});

function problemOf(status: number, code: string, detail: string): Problem {
  return {
    type: `https://docs.mlain.dev/errors/${code}`,
    title: code,
    status,
    detail,
    instance: '/w/brand',
    code,
    request_id: '',
  };
}

function validationProblem(
  issues: Array<{ path: string; code: string; message: string }>,
): Problem {
  return { ...problemOf(422, 'validation_failed', ''), errors: issues };
}

/**
 * Uložení značky projektu.
 *
 * ODCHYLKA OD ZVYKLOSTI „zápis jde vždy přes /api/v1": doména značky má
 * v `packages/core/src/brand/api/index.ts` jen trasy EXTRAKCE.
 *
 * Soubor `brand/api/profiles.routes.ts` se čtyřmi trasami (seznam, založení,
 * úprava, smazání profilu) byl 4. 8. 2026 SMAZÁN. Byly to definice bez obsluhy,
 * které nikdo neregistroval, takže do OpenAPI dokumentu nikdy nešly a nikdo je
 * nemohl zavolat. Popisovaly navíc produkt, který nemáme: projekt má právě
 * jednu značku (specifikace, obrazovka 8.5.4), takže „seznam profilů"
 * a „smazání profilu" nemá co obsluhovat.
 *
 * Obrazovka potřebuje jednu operaci, „ulož značku projektu", a ta je upsert
 * jediného řádku, ne REST kolekce.
 *
 * Zapisuje se proto stejnou cestou, jakou se značka už dnes ČTE: přes
 * `withWorkspace` a repozitář jádra (viz `apps/web/src/lib/ai/queries.ts`
 * a `apps/web/src/app/api/internal/ai/chat/route.ts`, které to dělají taky).
 * Politiky RLS platí stejně, protože transakci otevírá `withWorkspace`.
 *
 * Oprávnění se kontroluje TADY, ne jen na stránce. Serverová akce je veřejný
 * vstupní bod: kdo zná její identifikátor, může ji zavolat bez toho, aby
 * obrazovku vůbec otevřel.
 */
export async function saveBrandProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = SaveSchema.safeParse({
    workspace_slug: formData.get('workspace_slug'),
    name: formData.get('name'),
    primary: formData.get('primary'),
    secondary: formData.get('secondary'),
    accent: formData.get('accent'),
    background: formData.get('background'),
    text: formData.get('text'),
    heading_stack: formData.get('heading_stack'),
    body_stack: formData.get('body_stack'),
    radius: formData.get('radius'),
    logo_asset_id: formData.get('logo_asset_id') ?? '',
  });

  if (!parsed.success) {
    return failed(
      'inline',
      validationProblem(
        parsed.error.issues.map((issue) => ({
          path: String(issue.path[0] ?? ''),
          code: issue.code,
          message: issue.message,
        })),
      ),
    );
  }

  const slug = parsed.data.workspace_slug;
  const me = await requireUser(`/w/${slug}/settings/brand`);
  if (!me.ok) return failed('inlineBlock', me.problem);

  const access = await getWorkspaceAccess(slug);
  if (!access.ok) return failed('inlineBlock', access.problem);
  if (!hasPermission(access.data, 'templates:write')) {
    return failed('inlineBlock', problemOf(403, 'forbidden', 'templates:write'));
  }

  const ctx = await createWorkspaceContext({
    kind: 'session',
    userId: me.data.user.id,
    workspaceRef: slug,
  });

  /*
   * Katalog polí se vyzvedává PŘED transakcí, stejně jako u ukázkových dat
   * (`demo/api/demo-data.routes.ts`). Uvnitř by si otevřel druhé spojení
   * z poolu, zatímco to první drží zámek nad řádky šablon. Potřebuje ho
   * převlečení, které u každého dokumentu přepočítává stav validace.
   */
  const fields = await getFieldCatalog(ctx);

  try {
    await withWorkspace(ctx, async (tx) => {
      /*
       * Předchozí značka se čte PŘED zápisem a bez ní by převlečení neumělo
       * rozlišit zděděné písmo od ručně nastaveného: `redressTemplatesToBrand`
       * přebírá písmo a rádius jen tehdy, když v dokumentu pořád stojí hodnota
       * ze staré značky nebo výchozí.
       */
      const previous = await findDefaultBrandProfile(tx);

      await saveDefaultBrandProfile(tx, access.data.workspace.id, {
        name: parsed.data.name,
        palette: {
          primary: parsed.data.primary,
          secondary: parsed.data.secondary,
          accent: parsed.data.accent,
          background: parsed.data.background,
          text: parsed.data.text,
          /*
           * `source` je původ barvy, ne barva sama: obrazovka u každé hodnoty
           * ukazuje, odkud se vzala. Ručně zadaná barva má původ „manual",
           * ať se netváří jako nález z extrakce webu.
           */
          source: {
            primary: 'manual',
            secondary: 'manual',
            accent: 'manual',
            background: 'manual',
            text: 'manual',
          },
        },
        typography: {
          headingStack: parsed.data.heading_stack,
          bodyStack: parsed.data.body_stack,
          radius: parsed.data.radius,
        },
        logoAssetId: parsed.data.logo_asset_id === '' ? null : parsed.data.logo_asset_id,
      });

      /*
       * PŘEVLEČENÍ ULOŽENÝCH E-MAILŮ, ve stejné transakci jako uložení značky.
       *
       * Bez něj řeší značka jen nově zakládané e-maily a stížnost „změnil jsem
       * barvy a v kampani mám pořád staré" platí dál. Motiv je součást
       * uloženého dokumentu, takže se musí přepsat, ne dopočítat při zobrazení.
       *
       * SYNCHRONNĚ, ne úlohou na pozadí, a je to rozhodnutí podle rozsahu:
       * převlékají se šablony JEDNOHO projektu, kterých jsou řádově desítky
       * (v běžící instalaci šestnáct). Na pozadí by mezi uložením značky
       * a převlečením vzniklo okno, ve kterém uživatel otevře kampaň a uvidí
       * staré barvy, tedy přesně tu vadu, kvůli které to vzniká. Až by projekty
       * měly stovky šablon, patří to do fronty úloh; hranice je v tom, kdy
       * začne být transakce znatelně dlouhá, ne v počtu samotném.
       *
       * Nová značka se čte z databáze, ne skládá z formuláře: `saveDefaultBrandProfile`
       * je upsert a jediný pravdivý tvar profilu je ten uložený.
       */
      const saved = await findDefaultBrandProfile(tx);
      if (saved !== null) {
        await redressTemplatesToBrand(tx, ctx, { previous, next: saved, fields });
      }
    });
  } catch {
    // Skutečný důvod (porušení cizího klíče u loga, výpadek spojení) se
    // uživateli nehodí. Hlásí se jedna věta a stav zůstane vyplněný.
    return failed('inlineBlock', problemOf(500, 'brand_save_failed', ''));
  }

  revalidatePath(BRAND_PAGE_PATH, 'page');
  return succeeded({ channel: 'inline', messageKey: 'brand.saved' });
}
