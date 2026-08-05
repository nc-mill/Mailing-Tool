import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch } from '@/lib/api-client/fetch';
import { getWorkspaceAccess } from '@/lib/identity/workspace-access';
import {
  ImportResult,
  resultStatusOf,
  type ImportResultRow,
} from '@/features/import/import-result';

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
  params: Promise<{ locale: string; workspaceSlug: string; importId: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('import');
  return { title: t('wizard.title') };
}

/**
 * Rozpad výsledku chodí ve vlastních polích odpovědi, ne v `options`.
 * `options` jsou VOLBY importu zadané uživatelem (co dělat s duplicitami,
 * do jakého seznamu zařadit), počty tam nikdy nebyly. Dřívější znění je odtud
 * četlo, takže obrazovka po importu padesáti kontaktů hlásila
 * „Naimportováno žádný kontakt" a čtyři nuly v rozpadu.
 */
type ApiImport = {
  id: string;
  status: string;
  total_rows: number | null;
  checkpoint_row: number;
  created_rows: number;
  updated_rows: number;
  suppressed_rows: number;
  review_rows: number;
  error_rows: number;
  error_summary: Record<string, number>;
  failure_detail: string | null;
  options: Record<string, unknown>;
};

export default async function ImportResultPage({ params }: PageProps) {
  const { locale, workspaceSlug, importId } = await params;

  const access = await getWorkspaceAccess(workspaceSlug);
  if (!access.ok) notFound();
  const workspaceId = access.data.workspace.id;

  const found = await apiFetch<ApiImport>(`/api/v1/contacts/imports/${importId}`, { workspaceId });
  if (!found.ok) notFound();

  const raw = found.data;

  const row: ImportResultRow = {
    id: raw.id,
    // Převod stavu vlastní `import-result.tsx`, protože na něm stojí i to, co obrazovka
    // vykreslí. Dvě kopie výčtu stavů by se rozešly a rozdíl by se projevil tím, že
    // běžící import zase vypadá jako selhaný.
    status: resultStatusOf(raw.status),
    rawStatus: raw.status,
    totalRows: raw.total_rows ?? 0,
    createdRows: raw.created_rows,
    updatedRows: raw.updated_rows,
    suppressedRows: raw.suppressed_rows,
    errorRows: raw.error_rows,
    checkpointRow: raw.checkpoint_row,
    reviewRows: raw.review_rows,
    errorSummary: raw.error_summary,
    failureDetail: raw.failure_detail,
  };

  return (
    <ImportResult
      row={row}
      workspaceSlug={workspaceSlug}
      workspaceId={workspaceId}
      locale={locale}
    />
  );
}
