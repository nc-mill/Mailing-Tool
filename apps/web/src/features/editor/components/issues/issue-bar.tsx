'use client';

import { useTranslations } from 'next-intl';
import type { EditorIssue } from '../../model/document-types';
import { ISSUE_CODES } from '../../model/issue-codes';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { AlertTriangle, XCircle } from '../icons';

const KNOWN: ReadonlySet<string> = new Set(ISSUE_CODES);

export function IssueBar() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const issues = useEditorState((state) => state.issues);

  /**
   * Text nálezu. Klientská validace vrací **kód a parametry**, ne hotovou větu,
   * aby šla přeložit a neskládala se ze zřetězených fragmentů (kritérium 71).
   *
   * Neznámý kód se nezahazuje: zobrazí se `detail` ze serveru, přesně jak žádá
   * kritérium 76. Až úplně nakonec se ukáže holý kód, aby uživatel měl co poslat
   * podpoře, i kdyby server neposlal nic.
   */
  const textOf = (issue: EditorIssue): string => {
    if (KNOWN.has(issue.code)) {
      // `as never` na klíči i na parametrech: `useTranslations` má klíče
      // i jejich sloty odvozené z katalogu a kód nálezu je až za běhu.
      return t(`issue.${issue.code}` as never, (issue.params ?? {}) as never);
    }
    return issue.message ?? issue.code;
  };

  if (issues.length === 0) return null;

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;

  return (
    <section
      aria-label={t('issues.title')}
      className="border-b border-border bg-danger-surface/40 px-4 py-2"
    >
      <p className="text-sm font-medium">
        {t('issues.errorCount', { count: errors })}, {t('issues.warningCount', { count: warnings })}
      </p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.pointer ?? index}`}>
            <button
              type="button"
              className="flex items-center gap-2 text-left text-xs underline"
              onClick={() => {
                if (issue.blockId) store.select(issue.blockId);
              }}
            >
              {issue.severity === 'error' ? (
                <XCircle aria-hidden className="size-3 text-danger-text" />
              ) : (
                <AlertTriangle aria-hidden className="size-3" />
              )}
              <span>{textOf(issue)}</span>
              {issue.blockId ? (
                <span className="text-text-muted">{t('issues.goToBlock')}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
