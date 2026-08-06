import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { DomainScreen } from '@/features/sending/domain-screen';
import type { DnsRecord, DomainChecks } from '@/features/sending/dns-records';

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

type DomainResponse = {
  domain: {
    id: string;
    domain: string;
    checked_at: string | null;
    /** Verdikt poskytovatele. Zdroj pravdy o ověření, ne naše kontrola DNS. */
    ses_verification_status: string | null;
    verified_at: string | null;
  };
  records: DnsRecord[];
  checks: DomainChecks;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('campaigns.dns');
  return { title: t('checkNow') };
}

export default async function DomainPage({ params }: PageProps) {
  const { workspaceSlug, id } = await params;
  const access = await getWorkspaceAccess(workspaceSlug);
  /* 404 jen z opravdové 404, viz komentář u obrazovky předvoleb odesílatele. */
  if (!access.ok) {
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  const result = await apiFetch<DomainResponse>(`/api/v1/domains/${id}`, {
    workspaceId: access.data.workspace.id,
  });
  /*
   * Smazaná nebo cizí doména = 404, to je pravda o doméně. Vypršení požadavku
   * je pravda o požadavku a patří do chybového bloku: doména existuje dál a
   * druhý pokus obvykle projde.
   */
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    return <SettingsProblem problem={result.problem} />;
  }

  return (
    <DomainScreen
      workspaceId={access.data.workspace.id}
      domainId={id}
      domain={result.data.domain.domain}
      records={result.data.records}
      checks={result.data.checks}
      checkedAt={result.data.domain.checked_at}
      sesStatus={result.data.domain.ses_verification_status ?? null}
      verifiedAt={result.data.domain.verified_at ?? null}
      basePath={`/w/${workspaceSlug}`}
    />
  );
}
