import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { FieldsTable, type ContactFieldRow } from '@/features/contacts/fields-table';
import { ForbiddenSection } from '@/features/settings/forbidden-section';
import { SettingsPageShell, SettingsSection } from '@/features/settings/settings-page-shell';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess, hasPermission } from '@/lib/identity/workspace-access';

/**
 * SPRÁVA VLASTNÍCH POLÍ KONTAKTU.
 *
 * OBRAZOVKA VZNIKLA AŽ 7. 8. 2026, A JE TO NÁPRAVA, NE NOVÁ FUNKCE. Komponenta
 * `features/contacts/fields-table.tsx` existovala i s vlastními testy, serverové
 * akce (archivace, dopad, smazání) taky, a `revalidatePath` v nich mířil přesně
 * sem, na `/settings/fields`. Chyběla jediná věc: trasa. Vlastní pole se tedy
 * dala založit JEDINĚ oklikou ze stavitele polí formuláře a archivovat ani
 * smazat je nešlo nikde.
 *
 * Položka v navigaci má proto od téhle chvíle `mvp0: true`; hlídá to
 * `packages/ui/src/patterns/navigation/registry-screens.test.ts`, který spadne
 * v obou směrech, tedy i kdyby obrazovka zase zmizela.
 *
 * NUTNÉ MINIMUM JE VYPSAT, ZALOŽIT, PŘEJMENOVAT A ARCHIVOVAT NEBO SMAZAT, a to
 * obrazovka umí. Přejmenování je z té čtveřice to nejdůležitější a nejtišší:
 * bez něj bylo omylem založené pole (naměřeno na poli „boolen" ze 4. 8.)
 * v projektu napořád.
 *
 * CO OBRAZOVKA ZATÍM NEUMÍ, je zapsané v STAV-UKOLU.md: vrácení z archivu, výpis
 * archivovaných polí, přepínač zrychleného hledání (`/contact-fields/{id}/index`)
 * a dvojjazyčné popisky. Všechno to API má, ale je to ovládání navíc.
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
  return { title: t('fields.title') };
}

/** Tvar, ve kterém pole vydává `GET /api/v1/contact-fields`. */
type ContactFieldResponse = {
  data: {
    id: string;
    key: string;
    label: Record<string, string>;
    type: string;
    indexed: boolean;
    archived_at: string | null;
  }[];
  limits: { used: number; limit: number; indexed_used: number; indexed_limit: number };
};

export default async function ContactFieldsPage({
  params,
}: {
  params: Promise<{ locale: string; workspaceSlug: string }>;
}) {
  const { locale, workspaceSlug } = await params;
  const t = await getTranslations('contacts');

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) {
    // Nečlen dostane 404, ne 403: z 403 by šlo zjistit, které projekty existují.
    if (access.problem.status === 404) notFound();
    return <SettingsProblem problem={access.problem} />;
  }

  // `contacts:write`, ne `contacts:read`, a je to táž volba jako v registru
  // navigace: obrazovka pole ZAKLÁDÁ, archivuje a maže. Kdo smí jen číst, viděl
  // by tabulku, ve které je každé tlačítko zakázané.
  if (!hasPermission(access.data, 'contacts:write')) {
    return (
      <ForbiddenSection
        permission="contacts:write"
        currentRole={access.data.role}
        workspaceSlug={workspaceSlug}
      />
    );
  }

  const response = await apiFetch<ContactFieldResponse>('/api/v1/contact-fields', {
    workspaceId: access.data.workspace.id,
  });
  if (!response.ok) return <SettingsProblem problem={response.problem} />;

  const rows: ContactFieldRow[] = response.data.data.map((field) => ({
    id: field.id,
    key: field.key,
    // Popisek je mapa jazyků s povinným `en`. Bere se jazyk rozhraní, pak
    // angličtina, a teprve pak klíč: prázdná buňka by vypadala jako vada
    // načítání, kdežto klíč aspoň řekne, o které pole jde.
    label: field.label[locale] ?? field.label['en'] ?? field.key,
    labels: field.label,
    type: field.type,
    indexed: field.indexed,
    archived: field.archived_at !== null,
  }));

  return (
    <SettingsPageShell title={t('fields.title')} lead={t('fields.lead')}>
      <SettingsSection>
        <FieldsTable
          workspaceId={access.data.workspace.id}
          fields={rows}
          limits={{
            fields: response.data.limits.limit,
            indexed: response.data.limits.indexed_limit,
          }}
          locale={locale}
        />
      </SettingsSection>
    </SettingsPageShell>
  );
}
