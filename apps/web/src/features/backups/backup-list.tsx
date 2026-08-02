'use client';

import { useTranslations } from 'next-intl';
import { BackupRunButton } from './backup-run-button';

export type BackupListEntry = {
  name: string;
  createdAt: string;
  bytes: number;
  contacts: number;
  verifiedAt: string | null;
  verifiedOk: boolean | null;
};

/**
 * ODCHYLKA OD PLÁNU, VYNUCENÁ DESIGN SYSTÉMEM. Plán skládal obrazovku
 * z `Alert`, `DataTable` a `EmptyState`. V `packages/ui` **žádná z těch tří
 * neexistuje v tom tvaru**: `Alert` ani `EmptyState` v balíčku nejsou vůbec
 * a `DataTable` má povinné `tableId`, `labels`, `count` a `pagination`, tedy
 * stránkovací aparát, který seznam záloh nemá čím naplnit. Obrazovka proto
 * používá sémantickou tabulku a sdílený `Button`. Až P05 `Alert` dodá,
 * je výměna otázkou jednoho prvku.
 *
 * Varování o klíči je `role="note"` a je vidět VŽDY, i u prázdného seznamu.
 * Záloha bez keyringu je obnovitelná jen zdánlivě: data se vrátí, ale uložené
 * přístupy nikdo nedešifruje a otisky smazaných adres přestanou platit.
 */
export function BackupList({ entries }: { entries: readonly BackupListEntry[] }) {
  const t = useTranslations('onboarding.backups');

  const keyWarning = (
    <p role="note" className="rounded border border-warning-border bg-warning-bg p-3 text-sm">
      {t('keyWarning')}
    </p>
  );

  if (entries.length === 0) {
    return (
      <div className="space-y-4">
        {keyWarning}
        <p>{t('empty')}</p>
        <BackupRunButton />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {keyWarning}
      <table>
        <caption>{t('title')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('columnCreated')}</th>
            <th scope="col">{t('columnSize')}</th>
            <th scope="col">{t('columnRows')}</th>
            <th scope="col">{t('columnVerified')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.name}>
              <th scope="row">{new Date(e.createdAt).toLocaleString()}</th>
              <td>{`${Math.round(e.bytes / 1_000_000)} MB`}</td>
              <td>{e.contacts.toLocaleString('cs-CZ')}</td>
              <td>
                {e.verifiedAt === null
                  ? t('neverVerified')
                  : e.verifiedOk
                    ? t('verifiedOk', { when: new Date(e.verifiedAt).toLocaleDateString() })
                    : t('verifiedFailed', { when: new Date(e.verifiedAt).toLocaleDateString() })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <BackupRunButton />
    </div>
  );
}
