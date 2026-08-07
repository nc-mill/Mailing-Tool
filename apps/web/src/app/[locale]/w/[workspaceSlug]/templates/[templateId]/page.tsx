import { Link } from '@mlain/i18n/navigation';
import { ForbiddenState, NotFoundState } from '@mlain/ui/patterns/states';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations } from 'next-intl/server';
import { getProvider } from '@mlain/core/ai';
import { AiAssistantPanel } from '@/features/ai/assistant-panel';
import { validationProfileFor, type TemplateKind } from '@mlain/emails/document/profile';
import { PAGE_SURFACES } from '@mlain/emails/document/page-surfaces';
import { loadEditorData } from '@/features/editor/ports/server-ports';
import { TemplateDetailActions } from '@/features/templates/template-detail-actions';
import {
  aiWorkspaceContext,
  fetchBrandProfiles,
  fetchCredentials,
  fetchUsage,
} from '@/lib/ai/queries';
import { requireUser } from '@/lib/identity/require-user';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';
import { EditorClient } from './editor-client';

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

/**
 * Identitu ani přístup si tenhle plán neřeší sám: `requireUser` a `getWorkspaceAccess`
 * dodává P06 a používá je každá obrazovka pod `/w/{slug}`. Vlastní varianta by se
 * s nimi rozešla v tom, co dělá nečlen, a to je bezpečnostní rozhodnutí, ne detail.
 */
/**
 * Návrat do kampaně.
 *
 * Adresa se bere z parametru `return_to`, ale POUZE tehdy, když míří do TOHOTO
 * projektu. Otevřené přesměrování je jinak učebnicová díra: `?return_to=https://…`
 * by z editoru udělalo odrazový můstek na cizí web pod naší doménou. Kontroluje
 * se proto celý začátek cesty, ne jen „začíná lomítkem".
 */
function safeReturnTo(raw: string | undefined, workspaceSlug: string): string | null {
  if (!raw) return null;
  const prefix = `/w/${workspaceSlug}/`;
  if (!raw.startsWith(prefix)) return null;
  // Dvojí lomítko na začátku je adresa s protokolem bez schématu (`//zlo.cz`).
  if (raw.startsWith('//')) return null;
  return raw;
}

export default async function TemplateEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; workspaceSlug: string; templateId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceSlug, templateId } = await params;
  const query = await searchParams;
  const t = await getTranslations('editor');

  // `NotFoundState` a `ForbiddenState` mají povinné `body` i `backLink`, respektive
  // `code` a `requestId`. Není to buzerace: stav bez vysvětlení a bez cesty pryč
  // je slepá ulička, a to je přesně ta obrazovka, na které uživatel odchází.
  const backLink = (
    <Link href={`/w/${workspaceSlug}/templates`} className="underline">
      {t('state.backToList')}
    </Link>
  );
  const notFoundState = (
    <NotFoundState title={t('state.notFound')} body={t('state.notFoundBody')} backLink={backLink} />
  );

  const me = await requireUser(`/w/${workspaceSlug}/templates/${templateId}`);
  if (!me.ok) return notFoundState;

  const access = await getWorkspaceAccess(workspaceSlug);
  // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
  if (!access.ok) notFound();
  if (!hasPermission(access.data, 'templates:read')) {
    return (
      <ForbiddenState
        title={t('state.forbidden')}
        body={t('state.forbiddenBody')}
        whoCanHelp={t('state.forbiddenWhoCanHelp')}
        code="forbidden"
        // Prázdné schválně: tohle rozhodnutí padlo tady podle role, ne odpovědí
        // serveru, takže žádné číslo požadavku k němu neexistuje. Vymyslet ho
        // by znamenalo poslat podporu hledat něco, co v logu není.
        requestId=""
      />
    );
  }

  const data = await loadEditorData({ userId: me.data.user.id, workspaceSlug, templateId });
  if (!data) return notFoundState;

  /*
   * Podklady pro panel asistenta (P15, úkol 37). Čtou se týmiž funkcemi jako na
   * obrazovce nastavení, aby existoval jediný zdroj pravdy o tom, jestli
   * projekt má klíč. Panel bez klíče není chyba: vysvětlí, co je potřeba.
   */
  const aiCtx = await aiWorkspaceContext({ userId: me.data.user.id, workspaceSlug });
  const [credentials, brandProfiles, usage] = await Promise.all([
    fetchCredentials(aiCtx),
    fetchBrandProfiles(aiCtx),
    fetchUsage(aiCtx, 30),
  ]);
  const format = await getFormatter();
  const defaultBrand = brandProfiles.find((profile) => profile.defaultProfile) ?? brandProfiles[0];
  const defaultCredential =
    credentials.find((credential) => credential.default_credential) ?? credentials[0];
  const providerLabel =
    defaultCredential === undefined ? undefined : getProvider(defaultCredential.provider).label;
  const spendLabel =
    usage.estimatedCostUsd === null
      ? undefined
      : format.number(usage.estimatedCostUsd, { style: 'currency', currency: 'USD' });

  /*
   * KONTRAKT PRO KAMPANĚ (úkol 3 zadání).
   *
   * Kampaň si otevře editor odkazem
   *   /w/{slug}/templates/{id}?return_to=/w/{slug}/campaigns/{campaignId}&apply_to={campaignId}
   * a editor pak nabídne tlačítko „Uložit a zpět do kampaně". To po uložení
   * převezme obsah do kampaně (`POST /campaigns/{id}/apply-template`) a vrátí
   * uživatele zpátky. Tím odpadá berlička „Načíst obsah ze šablony“, kterou
   * dnes musí uživatel v kampani zmáčknout ručně, a hlavně past, kdy odejde
   * bez ní a odešle prázdný e-mail.
   *
   * `apply_to` je nepovinné: bez něj se editor jen vrátí, obsah nepřevezme.
   * Oba parametry vyplňuje strana kampaní, editor si je nevymýšlí.
   */
  const returnHref = safeReturnTo(
    typeof query.return_to === 'string' ? query.return_to : undefined,
    workspaceSlug,
  );
  const applyTo = typeof query.apply_to === 'string' ? query.apply_to : undefined;
  const returnTo = returnHref
    ? {
        href: returnHref,
        label: t('header.backToCampaign'),
        ...(applyTo === undefined ? {} : { campaignId: applyTo }),
      }
    : undefined;

  /*
   * POVRCH VEŘEJNÉ STRÁNKY, tedy pro které místo se návrh dělá.
   *
   * Všechny čtyři povrchy jsou tentýž `kind = 'page'` a tentýž validační profil.
   * Liší se JEN tím, co o návštěvníkovi vědí: děkovací stránka a „už jste
   * přihlášeni" jsou cíl přesměrování bez tokenu, kdežto stránka po potvrzení
   * a po odhlášení se otevírají z odkazu v e-mailu a kontakt znají. Editor tedy
   * potřebuje vědět, kam se návrh vykreslí, aby paletka personalizace nenabídla
   * údaj, který se u návštěvníka vykreslí jako prázdno.
   *
   * Adresu skládá strana formulářů a seznamů (`?surface=confirmed`), editor si
   * ji nevymýšlí. Je to týž vzor jako `return_to` u kampaní o kus výš.
   *
   * NEZNÁMÁ HODNOTA SE ZAHAZUJE a editor pak použije nejužší povrch. Přepsat
   * cizí řetězec rovnou do kontroly by znamenalo, že překlep v adrese rozhodne
   * o tom, co se nabídne; nejužší volba je jediná, u které se chyba projeví
   * hláškou v editoru, ne prázdným místem u návštěvníka.
   */
  const surfaceParam = typeof query.surface === 'string' ? query.surface : undefined;
  const pageSurface = PAGE_SURFACES.find((value) => value === surfaceParam);

  /*
   * SMAZÁNÍ PATŘÍ JEN K SAMOSTATNÉ ŠABLONĚ.
   *
   * Když se sem uživatel proklikl z kampaně (`returnTo`), je pod editorem
   * pracovní obsah TÉ kampaně, ne šablona z knihovny. Smazat ho odsud by
   * kampani vzalo obsah cestou, kterou nikdo nečeká, takže se tlačítko
   * v tom případě vůbec nenabízí.
   */
  const canDelete = returnTo === undefined && hasPermission(access.data, 'templates:write');

  const editor = (
    <EditorClient
      templateId={templateId}
      workspaceId={access.data.workspace.id}
      /*
       * Profil kontroly dokumentu. Skládá ho stránka, editor si ho nevymýšlí,
       * a odvozuje se TOUŽ funkcí, jakou používá server (`validationProfileFor`),
       * aby si obě strany nemohly o téže šabloně myslet každá něco jiného.
       *
       * Bez toho editor kontroloval transakční šablonu kampaňovými pravidly:
       * proměnná v odkazu tlačítka je v transakčním profilu normální stav,
       * kdežto v kampaňovém je to chyba `liquid_in_trackable_href`. Uživatel
       * tak v editoru neuložil obsah, který server přijme.
       */
      templateKind={validationProfileFor(data.kind as TemplateKind)}
      {...(pageSurface === undefined ? {} : { pageSurface })}
      {...(returnTo === undefined ? {} : { returnTo })}
      // Obsah kampaně se v editoru nesmí tvářit jako obecná šablona. Poznáme
      // to podle toho, že se sem uživatel proklikl z kampaně.
      contentKind={returnTo === undefined ? 'template' : 'campaign'}
      /*
       * NÁZEV SE DÁ UPRAVIT JEN U SKUTEČNÉ ŠABLONY.
       *
       * Rozhoduje `kind`, ne `returnTo`. Pracovní obsah kampaně (`system`) je
       * řádek, který si vyrobila aplikace, v knihovně se neukazuje a jméno má
       * odvozené od kampaně. Přejmenovat ho by znamenalo změnit něco, co
       * uživatel nikde neuvidí. `returnTo` by na to nestačilo: na tentýž řádek
       * se dá dostat i přímou adresou bez návratového parametru a pole by se
       * objevilo.
       */
      {...(data.kind === 'system' ? {} : { templateName: data.name })}
      assistant={
        <AiAssistantPanel
          templateId={templateId}
          workspaceId={access.data.workspace.id}
          hasCredential={credentials.length > 0}
          brandName={defaultBrand?.name ?? null}
          {...(providerLabel === undefined ? {} : { providerLabel })}
          settingsHref={`/w/${workspaceSlug}/settings/ai`}
          {...(spendLabel === undefined ? {} : { spendLabel })}
        />
      }
      document={data.document}
      designHash={data.designHash}
      fieldCatalog={data.fieldCatalog}
      // Vzorová věta na plátně se skládá podle nastavení PROJEKTU, ne podle
      // výchozích hodnot. Bez toho editor v projektu s tykáním sliboval
      // „Dobrý den, Jano" u e-mailu, který odejde s „Ahoj Jano".
      greeting={data.greeting}
      // ODCHYLKA OD PLÁNU: oprávnění `templates:write_html` v registru P04
      // **není** (jsou tam jen `templates:read` a `templates:write`). Editor ho
      // nesmí zavést sám, protože registr oprávnění vlastní P04, takže se
      // vlastní HTML zatím řídí právem na zápis. Až oprávnění vznikne, je to
      // změna jediného řádku.
      canWriteHtml={hasPermission(access.data, 'templates:write')}
      readOnly={!hasPermission(access.data, 'templates:write')}
    />
  );

  if (!canDelete) return editor;

  return (
    <>
      <TemplateDetailActions
        workspaceSlug={workspaceSlug}
        workspaceId={access.data.workspace.id}
        templateId={templateId}
        name={data.name}
      />
      {editor}
    </>
  );
}
