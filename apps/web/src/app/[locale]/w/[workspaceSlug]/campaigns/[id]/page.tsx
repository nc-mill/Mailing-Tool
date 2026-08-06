import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { updateCampaignSettingsAction } from '@/features/campaigns/actions';
import { CampaignLoadProblem } from '@/features/campaigns/campaign-load-problem';
import { isFinishedCampaign } from '@/features/campaigns/campaign-target';
import { canEditCampaignContent } from '@/features/campaigns/campaign-state';
import {
  CampaignSettingsForm,
  type CampaignSettings,
  type NamedOption,
} from '@/features/campaigns/settings-form';
import type { SenderIdentityOption } from '@/features/campaigns/sender-identity-picker';
import { parseCampaignStep, STEP_PARAM } from '@/features/campaigns/steps';

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
  /**
   * `?step=content|basics|settings`. Krok patří do adresy, aby šel poslat
   * odkazem a aby „Upravit nastavení" z kontrolního seznamu vedlo rovnou do
   * nastavení. Cokoli jiného padá na krok obsahu, obrazovka se kvůli adrese
   * nerozbije.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  /**
   * Klíče jsou ploché, ne vnořený objekt: čtou se přímo z těla odpovědi.
   *
   * `has_design` říká, jestli kampaň má vlastní dokument (podle toho se pozná,
   * že převzetí knihovní šablony obsah přepíše). `has_content` říká, jestli
   * v tom dokumentu doopravdy něco je: dokument s pouhou patičkou má `has_design`
   * pravdivé a `has_content` nepravdivé, a právě takový e-mail odešel prázdný.
   */
  has_design: boolean;
  has_content: boolean;
  audience: unknown;
  provider_id: string | null;
  sender_domain_id: string | null;
  /** Předvolba, ze které se odesílatel naposledy vyplnil. `null` = ručně. */
  sender_identity_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
};

/*
 * Stavy, ve kterých se kampaň ještě smí měnit, drží sdílený `campaign-state.ts`
 * pod jménem `canEditCampaignContent`. Odpovídají bráně v `PATCH /campaigns/{id}`,
 * která pro ostatní stavy vrací 409 `campaign_locked`; naplánovaná kampaň mezi ně
 * schválně nepatří, protože u ní projdou jen tři klíče plánu a ty nastavuje jiná
 * akce, ne tenhle formulář.
 */

/**
 * `audience` je v odpovědi `unknown`, protože schéma kampaně nechává výčet
 * otevřený. Rozebírá se opatrně: obrazovka na chybějící nebo cizí tvar reaguje
 * prázdným výběrem, nikdy pádem.
 */
function audienceIds(audience: unknown, side: 'include' | 'exclude', key: 'lists' | 'segments') {
  const root = audience as Record<string, unknown> | null | undefined;
  const branch = root?.[side] as Record<string, unknown> | undefined;
  const values = branch?.[key];
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Titulek okna nesmí tvrdit „Nastavení kampaně": stránka nese VŠECHNY kroky
 * a otevírá se obsahem. Popisek kroku patří na obrazovku, ne do záložky
 * prohlížeče, která se s přepnutím kroku nemění.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.settings');
  return { title: t('documentTitle') };
}

/**
 * Nastavení kampaně. Vzniklo proto, že obrazovka odeslání uměla vypsat, co
 * kampani chybí, ale předmět, publikum ani šablonu nešlo nikde vyplnit: cesta
 * `/campaigns/{id}` vracela 404, přestože `PATCH /api/v1/campaigns/{id}` existuje.
 */
export default async function CampaignSettingsPage({ params, searchParams }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const requestedStep = (await searchParams)[STEP_PARAM];
  const step = parseCampaignStep(requestedStep);
  const access = await getWorkspaceAccess(workspaceSlug);
  /*
   * 404 JEN Z OPRAVDOVÉ 404, viz `CampaignLoadProblem`.
   *
   * Dřív tu stálo `if (!access.ok) notFound()`, takže se na „stránku
   * nenalezena" překlopilo i vypršení požadavku (`apiFetch` má desetisekundový
   * limit), nedostupné API i vnitřní chyba. Uživatel z toho čte, že kampaň
   * neexistuje, jenže o její existenci žádný z těch případů nic neříká, a
   * hlášení „kampaň vrací 404" se pak nedá zopakovat, protože příčina mezitím
   * pominula. Nečlen projektu dál dostane 404, ta je správně (3.4 části 1).
   */
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <CampaignLoadProblem problem={access.problem} occurredAt={new Date().toISOString()} />;
  }
  const workspaceId = access.data.workspace.id;

  const [campaign, lists, segments, templates, providers, domains, senders] = await Promise.all([
    apiFetch<CampaignDetail>(`/api/v1/campaigns/${id}`, { workspaceId }),
    apiFetch<{ data: NamedOption[] }>('/api/v1/lists', { workspaceId }),
    apiFetch<{ data: NamedOption[] }>('/api/v1/segments', { workspaceId }),
    /*
     * `view=summary` vynechá dokument `design`, který je zdaleka největší sloupec
     * tabulky šablon a do rozbalovacího seznamu není k ničemu. Úsporná podoba
     * se neořezává až z odpovědi: bez ní tahá `design` z databáze i dotaz.
     */
    apiFetch<{ items: Array<{ id: string; name: string }> }>(
      '/api/v1/templates?kind=campaign&view=summary',
      { workspaceId },
    ),
    apiFetch<{ data: Array<{ id: string; name: string }> }>('/api/v1/providers', { workspaceId }),
    apiFetch<{ data: Array<{ id: string; domain: string }> }>('/api/v1/domains', { workspaceId }),
    /*
     * Uložené předvolby odesílatele. Vrací je API seřazené VÝCHOZÍ PRVNÍ, takže
     * se pořadí nedopočítává tady; kdyby se řadilo na dvou místech, rozešlo by
     * se to hned, jak se jedno z nich změní.
     */
    apiFetch<{ data: SenderIdentityOption[] }>('/api/v1/senders', { workspaceId }),
  ]);

  /*
   * Smazaná ani cizí kampaň = 404, to je pravda o kampani. Cokoli jiného je
   * pravda o požadavku a patří do chybového bloku s kódem a číslem požadavku,
   * ne pod větu „stránka nenalezena". Viz komentář u čtení projektu výš.
   */
  if (!campaign.ok) {
    if (campaign.problem.status === 404) notFound();
    return <CampaignLoadProblem problem={campaign.problem} occurredAt={new Date().toISOString()} />;
  }

  /*
   * DOJETÁ KAMPAŇ SEM VŮBEC NEPATŘÍ a nestačí schovat tlačítko.
   *
   * `PATCH /campaigns/{id}` na cokoli mimo `draft` a `schedule_missed` vrací
   * 409 `campaign_locked`, takže zápis neprojde ani odsud. Obrazovka nastavení
   * se ale pořád otevřela, ručně napsanou adresou i ze staré záložky, a
   * uživatel se na ni díval jako na kartu odeslané kampaně, přestože jediné,
   * co u ní zbývá, jsou výsledky. Odeslaná, částečně odeslaná, zrušená a
   * selhaná kampaň proto rovnou padají na svůj report.
   *
   * Naplánovaná, odesílající se a pozastavená tu zůstávají: u nich je nastavení
   * pořád živá informace a naplánovaná odsud jde odemknout („Zrušit plán a
   * upravit"). Formulář je u nich jen ke čtení, viz `canEdit` níž.
   */
  if (isFinishedCampaign(campaign.data.status)) {
    redirect(`/${locale}/w/${workspaceSlug}/campaigns/${id}/report`);
  }

  /*
   * KROK 1 JE JINÁ ADRESA: editor na `/campaigns/{id}/content`.
   *
   * Tahle stránka nese kroky 2 a 3, takže `?step=content` i holá adresa bez
   * parametru sem nepatří. Holá adresa je běžný případ, ne okrajový: takhle
   * se na kampaň chodí ze seznamu a kampaň začíná obsahem, ne předmětem.
   *
   * Výslovné `?step=content` vede na krok 1 VŽDY. I u zamčené kampaně a i té
   * bez pracovní kopie: první ukáže obsah jen ke čtení, druhá nabídne obsah
   * založit. Poslat kliknutí na krok 1 do kroku 2 by bylo horší než obojí.
   *
   * Holá adresa se přesměruje jen u kampaně, která se ještě dodělává a obsah
   * má. U zamčené je zajímavější nastavení (jde z něj zrušit plán) a bez
   * pracovní kopie by editor neměl co otevřít.
   */
  if (
    step === 'content' &&
    (requestedStep !== undefined ||
      (canEditCampaignContent(campaign.data.status) && campaign.data.template_id !== null))
  ) {
    redirect(`/${locale}/w/${workspaceSlug}/campaigns/${id}/content`);
  }

  /*
   * Číselníky se načítají tolerantně. Když jeden z nich selže, obrazovka se
   * vykreslí s prázdnou nabídkou a uživatel může vyplnit zbytek; kdyby se
   * kvůli výpadku seznamu segmentů poslalo 404, nedal by se změnit ani předmět.
   */
  const options = {
    lists: lists.ok ? lists.data.data : [],
    segments: segments.ok ? segments.data.data : [],
    templates: templates.ok ? templates.data.items : [],
    providers: providers.ok ? providers.data.data : [],
    domains: domains.ok
      ? domains.data.data.map((row) => ({ id: row.id, name: row.domain }))
      : ([] as NamedOption[]),
    /*
     * Přepisuje se pole po poli, ne rozprostřením celé odpovědi. Předvolba nese
     * i účet, doménu a časy, které rozbalovací seznam k ničemu nepotřebuje;
     * bez tohohle výběru by se všechno posílalo do prohlížeče a rostlo by to
     * s každým polem, které API někdy přidá.
     */
    senderIdentities: senders.ok
      ? senders.data.data.map((row) => ({
          id: row.id,
          name: row.name,
          from_name: row.from_name,
          from_email: row.from_email,
          reply_to: row.reply_to,
          provider_id: row.provider_id,
          sender_domain_id: row.sender_domain_id,
          domain_verified: row.domain_verified,
        }))
      : ([] as SenderIdentityOption[]),
  };

  const data = campaign.data;
  const settings: CampaignSettings = {
    id: data.id,
    name: data.name,
    status: data.status,
    subject: data.subject,
    preheader: data.preheader,
    from_name: data.from_name,
    from_email: data.from_email,
    reply_to: data.reply_to,
    template_id: data.template_id,
    provider_id: data.provider_id,
    sender_domain_id: data.sender_domain_id,
    sender_identity_id: data.sender_identity_id,
    unsubscribe_list_id: data.unsubscribe_list_id,
    track_opens: data.track_opens,
    track_clicks: data.track_clicks,
    has_design: data.has_design,
    has_content: data.has_content,
    include_lists: audienceIds(data.audience, 'include', 'lists'),
    include_segments: audienceIds(data.audience, 'include', 'segments'),
    exclude_lists: audienceIds(data.audience, 'exclude', 'lists'),
    exclude_segments: audienceIds(data.audience, 'exclude', 'segments'),
  };

  return (
    <CampaignSettingsForm
      action={updateCampaignSettingsAction}
      workspaceId={workspaceId}
      campaign={settings}
      options={options}
      canEdit={canEditCampaignContent(data.status)}
      basePath={`/w/${workspaceSlug}`}
      initialStep={step}
    />
  );
}
