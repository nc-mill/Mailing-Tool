'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { EmptyState, FilteredEmptyState } from '@mlain/ui/patterns/states';
import { useToast } from '@mlain/ui/patterns/toast';
import { vocativeNeutralAllAction, vocativeReviewAction } from './actions';
import { VocativeReviewGroup } from './vocative-review-group';
import type { VocativeReviewCommand, VocativeReviewGroupView } from './vocative-review-types';
import { exceedsManualReviewLimit } from './vocative-review-limit';

export type VocativeReviewProps = {
  basePath: string;
  workspaceId: string;
  groups: VocativeReviewGroupView[];
  totals: { groups: number; uncertainContacts: number; totalContacts: number };
};

/**
 * Odložené skupiny podle rozhodnutí R15.
 *
 * Odložení je volba zobrazení jednoho člověka, ne fakt o datech, takže se neposílá
 * na server a nezakládá se kvůli němu tabulka. Klíč nese workspaceId, aby se odložení
 * nepřenášelo mezi projekty.
 *
 * localStorage nemusí být k dispozici (soukromé okno, zakázané úložiště). Selhání se
 * polyká schválně: nemožnost odložit skupinu nesmí shodit celou obrazovku.
 */
const deferKey = (workspaceId: string) => `mlain.vocative-review.deferred.${workspaceId}`;

function readDeferred(workspaceId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(deferKey(workspaceId));
    return new Set(raw === null ? [] : (JSON.parse(raw) as string[]));
  } catch {
    return new Set();
  }
}

function writeDeferred(workspaceId: string, value: Set<string>): void {
  try {
    window.localStorage.setItem(deferKey(workspaceId), JSON.stringify([...value]));
  } catch {
    // Bez trvalého úložiště odložení platí jen do zavření stránky. To je přijatelné.
  }
}

export function VocativeReview({ basePath, workspaceId, groups, totals }: VocativeReviewProps) {
  const t = useTranslations('contacts');
  const format = useFormatter();
  const router = useRouter();
  const toast = useToast();

  // Čte se až po připojení, ne při vykreslení: localStorage na serveru neexistuje
  // a čtení při prvním renderu by způsobilo neshodu serverového a klientského HTML.
  const [deferred, setDeferred] = useState<Set<string>>(() => new Set());
  const [showDeferred, setShowDeferred] = useState(false);
  useEffect(() => setDeferred(readDeferred(workspaceId)), [workspaceId]);

  const verdict = exceedsManualReviewLimit(totals);

  function defer(kind: 'first' | 'last', nameKey: string) {
    const next = new Set(deferred);
    next.add(`${kind}:${nameKey}`);
    setDeferred(next);
    writeDeferred(workspaceId, next);
    toast.info(t('vocative.deferred'));
  }

  function undefer(kind: 'first' | 'last', nameKey: string) {
    const next = new Set(deferred);
    next.delete(`${kind}:${nameKey}`);
    setDeferred(next);
    writeDeferred(workspaceId, next);
  }

  const visible = showDeferred
    ? groups
    : groups.filter((group) => !deferred.has(`${group.kind}:${group.name_key}`));

  async function apply(command: VocativeReviewCommand) {
    const result = await vocativeReviewAction({ groups: [command] });
    if (result.status === 'success') {
      // Vyřízená skupina se z odložených odstraní, jinak by ji přepínač
      // „Zobrazit odložené" ukazoval navždy jako odloženou, i když už není ve frontě.
      undefer(command.kind, command.name_key);
      toast.success(t('vocative.saved', { count: 1 }));
      router.refresh();
    }
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        variant="emptied"
        title={t('vocative.emptyTitle')}
        explanation={t('vocative.emptyBody')}
        actions={[{ label: t('vocative.emptyAction'), onClick: () => router.push(basePath) }]}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('vocative.title')}</h1>
      <p>{t('vocative.lead')}</p>
      <p role="status">{t('vocative.reviewBanner', { count: totals.uncertainContacts })}</p>

      {verdict.exceeded ? (
        <aside
          data-testid="vocative-soft-limit"
          className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface-muted p-4"
        >
          <h2 className="font-semibold text-text">{t('vocative.softLimitTitle')}</h2>
          <p>
            {t('vocative.softLimitBody', {
              groups: totals.groups,
              // Procenta vždy na jedno desetinné místo (9.5 části 6). U malých čísel
              // by zaokrouhlení na celá procenta ztratilo celou informaci.
              ratio: format.number(verdict.ratio, {
                style: 'percent',
                maximumFractionDigits: 1,
              }),
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              data-recommended="true"
              onClick={async () => {
                const result = await vocativeNeutralAllAction({});
                if (result.status === 'success') router.refresh();
              }}
            >
              {t('vocative.softLimitAction')}
            </Button>
            <Button variant="secondary">{t('vocative.softLimitContinue')}</Button>
          </div>
          <p className="text-sm text-text-muted">{t('vocative.softLimitActionHint')}</p>
        </aside>
      ) : null}

      {deferred.size === 0 ? null : (
        <p>
          <Button variant="secondary" onClick={() => setShowDeferred((value) => !value)}>
            {showDeferred ? t('vocative.hideDeferred') : t('vocative.showDeferred')}
          </Button>
        </p>
      )}

      <ul className="flex flex-col gap-4">
        {visible.map((group) => (
          <VocativeReviewGroup
            key={`${group.kind}:${group.name_key}`}
            group={group}
            deferred={deferred.has(`${group.kind}:${group.name_key}`)}
            onApply={(command) => void apply(command)}
            onDefer={() => defer(group.kind, group.name_key)}
            onUndefer={() => undefer(group.kind, group.name_key)}
          />
        ))}
      </ul>

      {visible.length === 0 ? (
        <FilteredEmptyState
          title={t('vocative.allDeferredTitle')}
          explanation={t('vocative.allDeferredBody')}
          filterDescription={t('vocative.deferred')}
          clearFiltersLabel={t('vocative.showDeferred')}
          onClearFilters={() => setShowDeferred(true)}
        />
      ) : null}
    </section>
  );
}
