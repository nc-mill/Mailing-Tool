'use client';

import { Button } from '@mlain/ui/components/button';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { formatCount, hoursSince } from './labels';

export type CountState = {
  count: number | null;
  exact?: boolean;
  cachedAt?: string | null;
  warnings?: string[];
  sample?: { id: string; email: string; first_name: string | null; last_name: string | null }[];
};

export const DEBOUNCE_MS = 500;

/** Strom je hotový, když má každá podmínka pole i operátor. */
function isComplete(node: unknown): boolean {
  const typed = node as { type?: string; field?: unknown; operator?: string; children?: unknown[] };
  if (typed.type === 'condition') {
    return typed.field !== undefined && typed.field !== null && (typed.operator ?? '') !== '';
  }
  const children = typed.children ?? [];
  return children.length > 0 && children.every((child) => isComplete(child));
}
/** Nad šest hodin je číslo zastaralé natolik, že se nesmí tvářit čerstvě. */
export const STALE_HOURS = 6;

/**
 * Živý počet s ČERSTVOSTÍ. Číslo bez data je horší než žádné: vypadá stejně
 * jako spočítané před vteřinou, takže se podle něj rozhoduje o odeslání
 * kampaně na základě stavu z minulého týdne.
 *
 * Stáří se počítá až v `useEffect`, nikdy při vykreslení. Závisí na aktuálním
 * čase, který server nemá, a nesoulad hydratace by React neopravil.
 */
export function LiveCount({
  definition,
  workspaceId,
  locale = 'cs',
  initial,
  onShowAll,
}: {
  definition: unknown;
  workspaceId: string;
  locale?: string;
  initial?: CountState;
  onShowAll?: () => void;
}) {
  const t = useTranslations('segments');
  const [state, setState] = useState<CountState>(initial ?? { count: null });
  const [counting, setCounting] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ageHours, setAgeHours] = useState<number | null>(null);
  const [settled, setSettled] = useState<string>('');
  const abort = useRef<AbortController | null>(null);

  // Stáří počtu. Až tady, ne při vykreslení: viz komentář nahoře.
  useEffect(() => {
    if (!state.cachedAt) {
      setAgeHours(null);
      return;
    }
    setAgeHours(hoursSince(state.cachedAt, new Date()));
  }, [state.cachedAt]);

  useEffect(() => {
    if (definition === undefined || definition === null) return;
    // Segment BEZ PODMÍNKY se na server neposílá. Není to prázdný dotaz,
    // je to „všechny kontakty", což builder říká sám, a schéma AST prázdnou
    // skupinu neuznává, takže by z toho bylo 422 při každém otevření.
    const root = (definition as { root?: { children?: unknown[] } }).root;
    if ((root?.children ?? []).length === 0) return;
    // Rozepsaná podmínka se na server neposílá. Uživatel právě klikl na
    // „Přidat podmínku" a pole ještě nevybral, takže by ho každý takový klik
    // odměnil chybou 422, za kterou nemůže.
    if (!isComplete(root)) return;
    // Předchozí požadavek se RUŠÍ. Bez toho by každý stisk klávesy v poli
    // s hodnotou spustil dotaz nad pěti miliony řádků a odpovědi by se
    // vracely v jiném pořadí, než odešly.
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const timer = setTimeout(() => {
      setCounting(true);
      setFailed(false);
      void fetch('/api/v1/segments/preview', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
        body: JSON.stringify({ definition }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('preview failed'))))
        .then(
          (body: {
            count: number;
            exact: boolean;
            warnings: string[];
            sample: CountState['sample'];
          }) => {
            setState({
              count: body.count,
              exact: body.exact,
              warnings: body.warnings,
              sample: body.sample ?? [],
              cachedAt: new Date().toISOString(),
            });
            // Do aria-live se píše JEDNOU, až se hodnota ustálí.
            setSettled(formatCount(body.count, locale));
          },
        )
        .catch((error: unknown) => {
          if ((error as { name?: string }).name === 'AbortError') return;
          setFailed(true);
        })
        .finally(() => setCounting(false));
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [definition, locale, workspaceId]);

  const stale = ageHours !== null && ageHours >= STALE_HOURS;

  if (state.count === null && !counting) {
    return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        {/* Nikdy nepočítaný segment ukazuje „Spočítat", nikdy nulu. Nula je
            odpověď, kterou jsme nedali. */}
        <p className="text-sm text-text-muted">{t('neverCounted')}</p>
        <Button variant="secondary" size="sm" onClick={() => setState((prev) => ({ ...prev }))}>
          {t('count.action')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <p role="status" aria-live="polite" className="sr-only">
        {settled}
      </p>

      {state.count !== null ? (
        state.exact === false ? (
          <>
            <p
              data-stale={counting ? 'true' : 'false'}
              className={
                counting
                  ? 'text-lg font-semibold text-text opacity-60'
                  : 'text-lg font-semibold text-text'
              }
            >
              {t('estimated', { count: formatCount(state.count, locale) })}
            </p>
            <Button variant="secondary" size="sm" className="self-start">
              {t('countExactly')}
            </Button>
          </>
        ) : (
          // Předchozí číslo se při přepočtu ZTMAVÍ, nezmizí. Prázdné místo
          // vypadá jako chyba a uživatel ztratí referenci, o kolik se změnilo.
          <p
            data-stale={counting || stale ? 'true' : 'false'}
            className={
              counting || stale
                ? 'text-lg font-semibold text-text opacity-60'
                : 'text-lg font-semibold text-text'
            }
          >
            {t('count.exact', { count: state.count })}
          </p>
        )
      ) : null}

      {counting ? <p className="text-sm text-text-muted">{t('count.counting')}</p> : null}
      {failed ? (
        <Alert
          tone="error"
          action={
            <Button variant="secondary" size="sm">
              {t('count.retry')}
            </Button>
          }
        >
          {t('count.failed')}
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {ageHours !== null ? (
          <span
            data-stale={stale ? 'true' : 'false'}
            className={stale ? 'text-xs text-text-muted opacity-70' : 'text-xs text-text-muted'}
          >
            {t('stale', { time: `${ageHours} h` })}
          </span>
        ) : null}
        {stale ? (
          <Button variant="ghost" size="sm">
            {t('recount')}
          </Button>
        ) : null}
      </div>

      {/* Varování patří POD počet, ne místo něj: číslo je odpověď, varování
          je poznámka k tomu, jak přesná je. */}
      {(state.warnings ?? []).map((code) => (
        <Alert key={code} tone="warning">
          {t(`warnings.${code}`, { field: '' })}
        </Alert>
      ))}

      {state.sample && state.sample.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] bg-surface-muted p-3">
          <p className="text-xs font-medium text-text-muted">{t('count.sampleTitle')}</p>
          <ul className="flex flex-col gap-1">
            {state.sample.slice(0, 5).map((contact) => (
              <li key={contact.id} data-testid="sample-contact" className="text-sm text-text">
                {contact.email}
              </li>
            ))}
          </ul>
          {state.count !== null ? (
            <Button variant="link" size="sm" className="self-start" onClick={onShowAll}>
              {t('count.showAll', { count: formatCount(state.count, locale) })}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
