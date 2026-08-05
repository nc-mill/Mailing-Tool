import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { trialAudienceNotice } from '@mlain/core/providers';
import { campaignTarget } from '@/features/campaigns/campaign-target';
import { SendScreen } from '@/features/campaigns/send-screen';
import { PreflightProblem } from '@/features/campaigns/preflight-problem';
import type { Preflight } from '@/features/campaigns/readiness-checklist';
import type { TrialView } from '@/features/sending/trial-mode-panel';

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

type PageProps = { params: Promise<{ locale: string; workspaceSlug: string; id: string }> };

type CampaignDetail = {
  id: string;
  name: string;
  status: string;
  subject: string;
  from_name: string;
  from_email: string;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.send');
  return { title: t('checklistTitle') };
}

/**
 * Obrazovka odeslání. Ukazuje, KOMU se to pošle, včetně rozpadu publika a počtu
 * vyřazených. Všechna čísla pocházejí z jednoho volání preflightu, aby se řádek
 * Publikum, tlačítko a potvrzovací dialog nemohly rozejít.
 */
export default async function SendPage({ params }: PageProps) {
  const { locale, workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const [campaign, preflight, trial] = await Promise.all([
    apiFetch<CampaignDetail>(`/api/v1/campaigns/${id}`, { workspaceId }),
    apiFetch<Preflight>(`/api/v1/campaigns/${id}/preflight`, { workspaceId }),
    apiFetch<TrialView>('/api/v1/settings/trial', { workspaceId }),
  ]);

  /*
   * Čtyřistačtyřka patří JEN kampani, která opravdu není. Dřív sem spadlo
   * i selhání předodeslací kontroly, takže uživatel dostal „stránka nenalezena"
   * nad kampaní, kterou měl v seznamu. Vypršelá relace i nedostupný odesílací
   * účet vypadaly stejně jako smazaná kampaň a nešlo je rozeznat.
   */
  if (!campaign.ok) {
    /*
     * `validation_failed` je tu taky čtyřistačtyřka, ne chybový blok. `GET` kampaně
     * nemá tělo, takže jediné, co může neprojít validací, je identifikátor v adrese.
     * Zkomolené id v odkazu znamená „taková kampaň není", ne „něco se pokazilo".
     * Naměřeno v prohlížeči: adresa s nesprávně tvarovaným UUID vracela 422 a
     * obrazovka na ni tvrdila „Kampaň existuje".
     */
    if (campaign.problem.code === 'not_found' || campaign.problem.code === 'validation_failed') {
      notFound();
    }
    return (
      <PreflightProblem
        problem={campaign.problem}
        occurredAt={new Date().toISOString()}
        settingsHref={`/w/${workspaceSlug}/campaigns/${id}?step=settings`}
      />
    );
  }
  /*
   * ROZJETÁ ANI DOJETÁ KAMPAŇ SE UŽ NEODESÍLÁ, takže tady nemá co dělat.
   *
   * `POST /campaigns/{id}/send` pustí jen `draft`, `scheduled` a
   * `schedule_missed` (`SENDABLE_FROM` v `campaigns.routes.ts`), přesně ty tři
   * stavy, pro které `campaignTarget` vrací `settings`. Kontrolní seznam se
   * přesto vykreslil i nad odeslanou kampaní a nabízel tlačítko, které mohlo
   * skončit jedině chybou. Ručně napsaná adresa proto padá tam, kde se stavem
   * kampaně dá něco dělat: běžící na průběh, dojetá na report.
   *
   * Kontroluje se PŘED preflightem: ten u odeslané kampaně stejně nemá co
   * počítat a jeho chyba by se ukázala jako problém obrazovky.
   */
  const target = campaignTarget(campaign.data.status);
  if (target !== 'settings') {
    redirect(`/${locale}/w/${workspaceSlug}/campaigns/${id}/${target}`);
  }

  if (!preflight.ok) {
    return (
      <PreflightProblem
        problem={preflight.problem}
        occurredAt={new Date().toISOString()}
        settingsHref={`/w/${workspaceSlug}/campaigns/${id}?step=settings`}
      />
    );
  }

  /*
   * Čísla do pruhu skládá `trialAudienceNotice()` z jádra, ne stránka. Je to
   * tatáž funkce, kterou pokrývají jednotkové testy zkušebního režimu, takže
   * se text na obrazovce nemůže rozejít s tím, co doména tvrdí.
   *
   * Zkušební režim vypnutý znamená `null`, tedy žádný pruh: varování, které visí
   * pořád, přestane být varováním.
   */
  const trialNotice =
    trial.ok && trial.data.trial_mode
      ? trialAudienceNotice({
          audienceSize: preflight.data.audience_estimate,
          verifiedCount: trial.data.verified_count,
        })
      : null;

  const fromLine =
    campaign.data.from_name === ''
      ? campaign.data.from_email
      : `${campaign.data.from_name} <${campaign.data.from_email}>`;

  return (
    <SendScreen
      workspaceId={workspaceId}
      campaignId={id}
      campaignName={campaign.data.name}
      fromLine={fromLine}
      subject={campaign.data.subject}
      preflight={preflight.data}
      trialNotice={
        trialNotice === null
          ? null
          : { audience: trialNotice.audience, willReceive: trialNotice.willReceive }
      }
      basePath={`/w/${workspaceSlug}`}
    />
  );
}
