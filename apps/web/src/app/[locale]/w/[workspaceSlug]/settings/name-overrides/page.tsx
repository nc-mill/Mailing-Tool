import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { NameOverridesTable, type NameOverrideRow } from '@/features/contacts/name-overrides-table';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SettingsPageShell, SettingsSection } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * SLOVNÍK PŘEPISŮ JMEN (ROD A PÁTÝ PÁD).
 *
 * OBRAZOVKA VZNIKLA 7. 8. 2026 A JE TO NÁPRAVA, NE NOVÁ FUNKCE. `GET`, `POST`
 * i `DELETE /api/v1/name-overrides` byly v API celou dobu, ale řetězec
 * `name-overrides` se v `apps/web` nevyskytoval ANI JEDNOU. Slovník se tedy dal
 * jedině plnit, a to nepřímo: ve frontě kontroly oslovení volbou „uložit i pro
 * budoucí kontakty".
 *
 * PROČ TO NESTAČILO, ačkoli cesta k funkci existovala. Přepis platí na všechny
 * BUDOUCÍ shody jména, takže překlep v pátém pádu se tiše propisoval do oslovení
 * každého dalšího kontaktu téhož jména a nešel ani najít, natož opravit. Fronta
 * kontroly ho nevrátí: jméno v ní přestane vyskakovat právě proto, že přepis
 * existuje. Je to táž vada, na kterou zadavatel narazil u vlastních polí
 * kontaktu (pole „boolen" ze 4. 8.), jen tišší, protože chybný výsledek odchází
 * v e-mailu ven.
 *
 * MÍSTO V NASTAVENÍ, NE U KONTAKTŮ, a se stejným tvarem jako `settings/fields`:
 * je to projektový číselník, ne práce s konkrétními kontakty. Třetí způsob
 * správy číselníků by znamenal, že se každý ovládá jinak.
 */

/**
 * Stránka závisí na přihlášeném uživateli, takže se NEPŘEDRENDEROVÁVÁ.
 *
 * Bez tohohle ji Next při `next build` vykreslí a spadne, protože v době
 * sestavení žádná relace neexistuje.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('nameOverrides.title') };
}

/** Tvar, ve kterém přepisy vydává `GET /api/v1/name-overrides`. */
type NameOverridesResponse = {
  data: {
    id: string;
    kind: 'first' | 'last';
    name_key: string;
    gender: 'female' | 'male' | 'unknown' | null;
    vocative: string | null;
    note: string | null;
    created_at: string;
  }[];
};

export default async function NameOverridesPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const t = await getTranslations('contacts');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  // `contacts:write`, ne `contacts:read`, a je to táž volba jako u vlastních
  // polí: obrazovka přepisy ZAKLÁDÁ a maže. Kdo smí jen číst, viděl by tabulku,
  // ve které je každé tlačítko zakázané.
  if (!hasPermission(access.data, 'contacts:write')) {
    return (
      <ForbiddenSection
        permission="contacts:write"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const response = await apiFetch<NameOverridesResponse>('/api/v1/name-overrides?limit=500', {
    workspaceId: access.data.workspace.id,
  });
  if (!response.ok) return <SettingsProblem problem={response.problem} />;

  const rows: NameOverrideRow[] = response.data.data.map((row) => ({
    id: row.id,
    kind: row.kind,
    nameKey: row.name_key,
    gender: row.gender,
    vocative: row.vocative,
    note: row.note,
  }));

  return (
    <SettingsPageShell title={t('nameOverrides.title')} lead={t('nameOverrides.lead')}>
      <SettingsSection>
        <NameOverridesTable workspaceId={access.data.workspace.id} overrides={rows} />
      </SettingsSection>
    </SettingsPageShell>
  );
}
