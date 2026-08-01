'use client';

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
        .then((body: { count: number; exact: boolean; warnings: string[]; sample: CountState['sample'] }) => {
          setState({
            count: body.count,
            exact: body.exact,
            warnings: body.warnings,
            sample: body.sample ?? [],
            cachedAt: new Date().toISOString(),
          });
          // Do aria-live se píše JEDNOU, až se hodnota ustálí.
          setSettled(formatCount(body.count, locale));
        })
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
      <div className="flex flex-col gap-2">
        <p>{t('neverCounted')}</p>
        <button type="button" onClick={() => setState((prev) => ({ ...prev }))}>
          {t('count.action')}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p role="status" aria-live="polite" className="sr-only">
        {settled}
      </p>

      {state.count !== null ? (
        state.exact === false ? (
          <>
            <p data-stale={counting ? 'true' : 'false'}>
              {t('estimated', { count: formatCount(state.count, locale) })}
            </p>
            <button type="button">{t('countExactly')}</button>
          </>
        ) : (
          // Předchozí číslo se při přepočtu ZTMAVÍ, nezmizí. Prázdné místo
          // vypadá jako chyba a uživatel ztratí referenci, o kolik se změnilo.
          <p data-stale={counting || stale ? 'true' : 'false'}>
            {t('count.exact', { count: state.count })}
          </p>
        )
      ) : null}

      {counting ? <p>{t('count.counting')}</p> : null}
      {failed ? (
        <>
          <p role="alert">{t('count.failed')}</p>
          <button type="button">{t('count.retry')}</button>
        </>
      ) : null}

      {ageHours !== null ? (
        <p data-stale={stale ? 'true' : 'false'}>
          {t('stale', { time: `${ageHours} h` })}
        </p>
      ) : null}
      {stale ? <button type="button">{t('recount')}</button> : null}

      {(state.warnings ?? []).map((code) => (
        <p key={code}>{t(`warnings.${code}`, { field: '' })}</p>
      ))}

      {state.sample && state.sample.length > 0 ? (
        <div>
          <p>{t('count.sampleTitle')}</p>
          <ul>
            {state.sample.slice(0, 5).map((contact) => (
              <li key={contact.id} data-testid="sample-contact">
                {contact.email}
              </li>
            ))}
          </ul>
          {state.count !== null ? (
            <button type="button" onClick={onShowAll}>
              {t('count.showAll', { count: formatCount(state.count, locale) })}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
