'use client';

import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
// Alias, protože tenhle soubor má vlastní typ `Progress` (tvar dat o průběhu).
import { Progress as ProgressBar } from '@mlain/ui/components/progress';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { formatCount } from './labels';

export type Progress = { processed: number; total: number | null; status: string };

const MILESTONES = [25, 50, 75, 100];

/**
 * Stavy, po kterých už import nikam nepokročí. Musí být na obou cestách,
 * na SSE i na dotazování: kdyby je znala jen jedna, druhá by uživatele nechala
 * viset na obrazovce průběhu i po dokončení. Shodné se seznamem v
 * `packages/core/src/contacts/import/api/events.routes.ts`.
 */
const TERMINAL_STATUSES = new Set(['completed', 'completed_with_errors', 'failed', 'cancelled']);

/**
 * Krok 6. Průběh přes SSE, po třech neúspěších přechod na dotazování.
 *
 * Do `aria-live` se hlásí jen 25, 50, 75 a 100 procent. Čtečka, která předčítá
 * každou změnu čísla, je horší než žádné hlášení: uživatel ji vypne a přijde
 * i o oznámení konce.
 */
export function StepProgress({
  importId,
  workspaceId,
  locale = 'cs',
  initial,
  onDone,
}: {
  importId: string;
  workspaceId: string;
  locale?: string;
  initial?: Progress;
  onDone?: (status: string) => void;
}) {
  const t = useTranslations('import');
  const [progress, setProgress] = useState<Progress>(
    initial ?? { processed: 0, total: null, status: 'importing' },
  );
  const [degraded, setDegraded] = useState(false);
  /**
   * Průběh se nedaří přečíst. Odlišné od `degraded`: ten říká „jedeme náhradní
   * cestou, ale čísla máme", tohle říká „čísla nemáme". Bez rozlišení by zamrzlá
   * nula vypadala jako pomalý import.
   */
  const [unreadable, setUnreadable] = useState(false);
  const [announced, setAnnounced] = useState<string>('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const reached = useRef(new Set<number>());

  useEffect(() => {
    let failures = 0;
    let source: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    /*
     * NEPOUŽITELNÁ ODPOVĚĎ SE NEBERE, MÍSTO TOHO SE PŘIZNÁ.
     *
     * Tahle obrazovka je jediné, co o běžícím importu člověk vidí, a její nejhorší
     * možný stav je tichý: dosadit `undefined` do počítadla a čekat na konec, který
     * se nepozná, protože `status` taky chybí. Navenek to vypadá jako import, který
     * se rozjel a stojí, a v ničem se to neprojeví, ani v logu, ani v konzoli.
     * Přesně ten příznak se 7. 8. 2026 nahlásil: obrazovka ukazovala „0 z 20"
     * a „Import běží na serveru", zatímco import už byl dávno dokončený.
     *
     * Tvar odpovědi se proto ověřuje, ne předpokládá. Cizí odpověď (chybové tělo,
     * přihlašovací stránka po vypršení relace, změněná obálka API) tím spadne do
     * viditelného stavu „průběh se nedaří číst", a ne do zamrzlé nuly.
     */
    const asProgress = (value: unknown): Progress | null => {
      if (typeof value !== 'object' || value === null) return null;
      const row = value as Record<string, unknown>;
      const processed = Number(row['checkpoint_row']);
      const total = row['total_rows'];
      if (!Number.isFinite(processed)) return null;
      if (typeof row['status'] !== 'string') return null;
      return {
        processed,
        total: total === null || total === undefined ? null : Number(total),
        status: row['status'],
      };
    };

    const apply = (next: Progress) => {
      setProgress(next);
      if (next.total !== null && next.total > 0) {
        const percent = Math.floor((next.processed / next.total) * 100);
        for (const milestone of MILESTONES) {
          if (percent >= milestone && !reached.current.has(milestone)) {
            reached.current.add(milestone);
            setAnnounced(`${milestone} %`);
          }
        }
      }
    };

    const startPolling = () => {
      setDegraded(true);
      poll = setInterval(() => {
        void fetch(`/api/v1/contacts/imports/${importId}`, {
          headers: { 'X-Workspace-Id': workspaceId },
        })
          .then((res) => res.json())
          .then((body: unknown) => {
            const next = asProgress(body);
            if (next === null) {
              setUnreadable(true);
              return;
            }
            setUnreadable(false);
            apply(next);
            // Konec importu musí poznat i tahle větev. Dřív ho poznávalo jenom
            // SSE, takže při dotazování zůstal uživatel na „Importujeme
            // kontakty" navždy, přestože počítadlo ukazovalo 50 z 50 a 100 %.
            // Naměřeno na produkční image: 250 vteřin dotazování po tom, co
            // worker zapsal `import finished`, a výsledek se neukázal.
            if (TERMINAL_STATUSES.has(next.status)) {
              if (poll) clearInterval(poll);
              poll = null;
              onDone?.(next.status);
            }
          })
          .catch(() => setUnreadable(true));
      }, 5000);
    };

    const connect = () => {
      // Reference na projekt jde v query, protože `EventSource` neumí nastavit
      // hlavičku `X-Workspace-Id`. Bez ní vracelo API 404 a živý průběh byl
      // v prohlížeči trvale nedostupný, viz `lib/api/authenticate.ts`.
      source = new EventSource(
        `/api/v1/contacts/imports/${importId}/events?workspace_id=${encodeURIComponent(workspaceId)}`,
      );
      source.addEventListener('progress', (event) => {
        failures = 0;
        const data = JSON.parse((event as MessageEvent<string>).data) as Progress & {
          terminal: boolean;
        };
        apply(data);
        if (data.terminal) {
          source?.close();
          onDone?.(data.status);
        }
      });
      source.addEventListener('error', () => {
        failures += 1;
        source?.close();
        // Tři pokusy, pak dotazování. Nekonečné znovupřipojování vypadá
        // navenek stejně jako zaseknutý import, což je nejhorší možný stav.
        if (failures >= 3) startPolling();
        else connect();
      });
    };

    connect();
    return () => {
      source?.close();
      if (poll) clearInterval(poll);
    };
  }, [importId, onDone, workspaceId]);

  const total = progress.total ?? 0;
  const rest = Math.max(total - progress.processed, 0);

  return (
    <div className="flex max-w-[var(--container-prose)] flex-col gap-[var(--spacing-gutter)]">
      <CardTitle>{t('progress.title')}</CardTitle>

      {/* Pruh průběhu byl PRÁZDNÝ `div` s aria atributy: čtečka věděla, jak
          daleko import je, oko ne. `Progress` z návrhového systému kreslí totéž
          a nese stejné atributy, takže se přístupnost nemění, jen přibývá to,
          co bylo vidět jen čtečce. */}
      <ProgressBar
        value={progress.processed}
        max={total}
        label={t('progress.title')}
        valueText={t('progress.counter', {
          processed: formatCount(progress.processed, locale),
          total: formatCount(total, locale),
        })}
      />

      {/* Počet zpracovaných je číslo, které se sleduje, takže mono: číslice mají
          stejnou šířku a nepodskakují při každé změně. */}
      <p className="font-mono text-body text-text">
        {t('progress.counter', {
          processed: formatCount(progress.processed, locale),
          total: formatCount(total, locale),
        })}
      </p>

      <p role="status" aria-live="polite" className="text-ui text-text">
        {announced}
      </p>

      {/* Věta „běží na serveru" se u nečitelného průběhu NEUKAZUJE. Je to tvrzení
          o stavu importu, které v tu chvíli nikdo neověřil, a právě ono dělalo
          ze zamrzlé obrazovky přesvědčivou lež. */}
      {unreadable ? null : (
        <p className="text-meta text-text-muted">{t('progress.runsOnServer')}</p>
      )}
      {degraded && !unreadable ? (
        <Alert tone="warning">{t('progress.liveUpdatesFailed')}</Alert>
      ) : null}
      {unreadable ? <Alert tone="warning">{t('progress.unreadable')}</Alert> : null}

      <Button variant="secondary" className="self-start" onClick={() => setConfirmCancel(true)}>
        {t('progress.cancel')}
      </Button>

      {confirmCancel ? (
        <Card as="div" role="dialog" aria-label={t('progress.cancelConfirmTitle')} padding="sm">
          <CardTitle as="h3">{t('progress.cancelConfirmTitle')}</CardTitle>
          <p className="text-ui text-text">
            {t('progress.cancelConfirmBody', {
              done: formatCount(progress.processed, locale),
              rest: formatCount(rest, locale),
            })}
          </p>
          <div className="flex flex-wrap gap-[var(--spacing-inline)]">
            {/* Zastavení importu je nevratné, proto destruktivní tón. Ústup je
                vedle něj rovnocenný, ne schovaný. */}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                void fetch(`/api/v1/contacts/imports/${importId}/cancel`, {
                  method: 'POST',
                  headers: { 'X-Workspace-Id': workspaceId, 'Content-Type': 'application/json' },
                });
                setConfirmCancel(false);
              }}
            >
              {t('progress.cancelConfirm')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirmCancel(false)}>
              {t('progress.cancelDismiss')}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
