'use client';

import { Button } from '@mlain/ui/components/button';
import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatCount, hoursSince } from './labels';

export type CountState = {
  count: number | null;
  exact?: boolean;
  cachedAt?: string | null;
  warnings?: string[];
  sample?: { id: string; email: string; first_name: string | null; last_name: string | null }[];
};

export const DEBOUNCE_MS = 500;

/**
 * Strom je hotový, když má každá podmínka pole, operátor a dopsanou hodnotu.
 *
 * Rozepsaná hodnota se hlídá stejně jako rozepsané pole. Podmínka „má štítek"
 * s prázdným výčtem je pro server chyba (`values` musí mít aspoň jednu
 * položku), takže bez téhle kontroly svítí u čerstvě přidané podmínky červená
 * hláška do doby, než uživatel štítek vybere. Za to ale nemůže, jen ještě
 * nedopsal.
 */
function isComplete(node: unknown): boolean {
  const typed = node as {
    type?: string;
    field?: unknown;
    operator?: string;
    values?: unknown;
    children?: unknown[];
  };
  if (typed.type === 'condition') {
    if (typed.field === undefined || typed.field === null) return false;
    if ((typed.operator ?? '') === '') return false;
    if (Array.isArray(typed.values)) {
      return typed.values.length > 0 && typed.values.every((item) => item !== null && item !== '');
    }
    return true;
  }
  const children = typed.children ?? [];
  return children.length > 0 && children.every((child) => isComplete(child));
}

export type CountFailure = { code: string | null; kind: string | null; message: string | null };

/**
 * Důvod z odpovědi serveru. Chybová odpověď je Problem Details a nese doménový
 * kód v `params.code`, podrobnost ve `errors[].message` a obecný text
 * v `detail`. Bez toho zbývala uživateli hláška „Počet se nepodařilo
 * spočítat.", ze které se nedá poznat vůbec nic.
 *
 * `detail` z registru chyb je ANGLICKÝ a strojový („The requested resource does
 * not exist."), takže se používá až jako poslední možnost. České znění se
 * skládá z doménového kódu, viz `failureText`.
 */
async function readFailure(res: Response): Promise<CountFailure> {
  try {
    const body = (await res.json()) as {
      detail?: string;
      errors?: { message?: string }[];
      params?: { code?: string; kind?: string };
    };
    return {
      code: body.params?.code ?? null,
      kind: body.params?.kind ?? null,
      message: body.errors?.[0]?.message ?? body.detail ?? null,
    };
  } catch {
    return { code: null, kind: null, message: null };
  }
}
/** Doménové kódy, ke kterým umíme říct něco lepšího než „nepodařilo se". */
const REFERENCE_KINDS = new Set(['tag', 'list', 'segment', 'contact_field']);

/**
 * České znění chyby. Pořadí je dané tím, co uživateli nejvíc pomůže: nejdřív
 * doménový kód, teprve pak strojová podrobnost a nakonec obecná věta.
 */
export function failureText(
  t: (key: string, values?: Record<string, string | number>) => string,
  failure: CountFailure | null,
): string {
  if (failure === null) return t('count.failed');
  if (
    failure.code === 'segment_reference_not_found' &&
    failure.kind !== null &&
    REFERENCE_KINDS.has(failure.kind)
  ) {
    return t('count.failedReferenceMissing', { kind: t(`referenceKinds.${failure.kind}`) });
  }
  return failure.message === null
    ? t('count.failed')
    : t('count.failedDetail', { detail: failure.message });
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
  const [failure, setFailure] = useState<CountFailure | null>(null);
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

  /**
   * Jeden dotaz na počet. VYTAŽENO Z EFEKTU SCHVÁLNĚ: dokud byl dotaz zamčený
   * uvnitř `useEffect`, neměla tlačítka „Spočítat", „Zkusit znovu"
   * a „Přepočítat" co zavolat, a přesně proto tu stála bez `onClick`.
   *
   * Počítá se PODLE TOHO, CO JE NA OBRAZOVCE, ne uložený segment.
   * `recountSegmentAction` se sem nehodí: přepočítává uloženou definici podle
   * `id`, které tahle komponenta vůbec nedostává, takže by v editoru vrátila
   * číslo k jiné podmínce, než jakou má uživatel rozepsanou před sebou.
   */
  const runPreview = useCallback(async () => {
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
    setCounting(true);
    setFailed(false);
    setFailure(null);
    try {
      const res = await fetch('/api/v1/segments/preview', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId },
        body: JSON.stringify({ definition }),
      });
      if (!res.ok) {
        setFailure(await readFailure(res));
        setFailed(true);
        return;
      }
      const body = (await res.json()) as {
        count: number;
        exact: boolean;
        warnings: string[];
        sample: CountState['sample'];
      };
      setState({
        count: body.count,
        exact: body.exact,
        warnings: body.warnings,
        sample: body.sample ?? [],
        cachedAt: new Date().toISOString(),
      });
      // Do aria-live se píše JEDNOU, až se hodnota ustálí.
      setSettled(formatCount(body.count, locale));
    } catch (error: unknown) {
      if ((error as { name?: string }).name === 'AbortError') return;
      setFailed(true);
    } finally {
      // „Počítáme" smí zhasnout jen ten dotaz, který je pořád aktuální.
      // Zrušený požadavek doběhne později než jeho náhrada a jinak by ji zhasl.
      if (abort.current === controller) setCounting(false);
    }
  }, [definition, locale, workspaceId]);

  useEffect(() => {
    const timer = setTimeout(() => void runPreview(), DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.current?.abort();
    };
  }, [runPreview]);

  const stale = ageHours !== null && ageHours >= STALE_HOURS;

  if (state.count === null && !counting) {
    return (
      <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
        {/* Nikdy nepočítaný segment ukazuje „Spočítat", nikdy nulu. Nula je
            odpověď, kterou jsme nedali. */}
        <p className="text-ui text-text-muted">{t('neverCounted')}</p>
        {/* Dřív tu bylo `setState((prev) => ({ ...prev }))`, což jen vyrobilo
            nový objekt stavu. Efekt na něm nezávisí, takže se nic nespočítalo
            a tlačítko bylo mrtvé stejně jako ta bez `onClick`. */}
        <Button
          variant="secondary"
          size="sm"
          data-testid="live-count-run"
          onClick={() => void runPreview()}
        >
          {t('count.action')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[var(--spacing-gutter)]">
      <p role="status" aria-live="polite" className="sr-only">
        {settled}
      </p>

      <div className="grid gap-[var(--spacing-hairline)]">
        <span className="meta-caps text-text-muted">{t('count.belongLabel')}</span>

        {state.count !== null ? (
          state.exact === false ? (
            <>
              {/* Odhad se PŘIZNÁ celou větou, ne jen číslem: „přibližně" musí
                  být vidět dřív než hodnota, podle které se rozhoduje. */}
              <p
                data-stale={counting ? 'true' : 'false'}
                className={cn(
                  'text-h3 font-semibold tracking-[var(--tracking-heading)] text-text',
                  counting ? 'opacity-60' : undefined,
                )}
              >
                {t('estimated', { count: formatCount(state.count, locale) })}
              </p>
              {/* Tady bývalo tlačítko „Spočítat přesně" BEZ OBSLUHY. Odstraněné,
                  ne zapojené, a jsou pro to dva důvody.

                  Zapojit ho nejde: odhad vzniká právě tehdy, když přesné
                  počítání zabije `statement_timeout`, a `POST /segments/preview`
                  nemá čím delší strop vyžádat. Strop je nastavení instalace
                  (`SEGMENT_PREVIEW_TIMEOUT_MS`, výchozí 3 s, nejvýš 30 s), tedy
                  věc provozovatele, ne tlačítka na obrazovce.

                  A i kdyby přijímal, slib „přesně" by neplatil: s delším stropem
                  může počítání dopadnout stejně a uživatel by dostal podruhé
                  odhad od tlačítka, které slíbilo přesné číslo. To je horší než
                  tlačítko chybějící.

                  Místo něj stojí věta, PROČ je číslo přibližné. Odhad bez
                  vysvětlení vypadá jako vada, vysvětlený je informace. */}
              <p className="text-ui text-text-muted">{t('estimatedWhy')}</p>
            </>
          ) : (
            // Předchozí číslo se při přepočtu ZTMAVÍ, nezmizí. Prázdné místo
            // vypadá jako chyba a uživatel ztratí referenci, o kolik se změnilo.
            <p
              data-stale={counting || stale ? 'true' : 'false'}
              className={cn(
                'flex items-baseline gap-[var(--spacing-inline)]',
                'text-display leading-[var(--leading-number)] font-semibold tracking-[var(--tracking-number)] text-text',
                counting || stale ? 'opacity-60' : undefined,
              )}
            >
              {formatCount(state.count, locale)}
              <span className="text-base font-normal text-text-muted">
                {t('count.unit', { count: state.count })}
              </span>
            </p>
          )
        ) : null}

        {ageHours !== null ? (
          <span
            data-stale={stale ? 'true' : 'false'}
            className={cn('font-mono text-label text-text-muted', stale ? 'opacity-70' : undefined)}
          >
            {/* Pod hodinu se stáří neuvádí v hodinách. „Před 0 h" nikdo neřekne
                a čerstvě spočítaný segment je přesně ten případ: razítko vzniklo
                před vteřinou. Seznam segmentů to řeší stejně. */}
            {ageHours < 1 ? t('freshNow') : t('stale', { time: `${ageHours} h` })}
          </span>
        ) : null}
      </div>

      {counting ? <p className="text-ui text-text-muted">{t('count.counting')}</p> : null}
      {failed ? (
        <Alert
          tone="error"
          action={
            <Button
              variant="secondary"
              size="sm"
              data-testid="live-count-retry"
              pending={counting}
              pendingLabel={t('count.counting')}
              onClick={() => void runPreview()}
            >
              {t('count.retry')}
            </Button>
          }
        >
          {failureText(t, failure)}
        </Alert>
      ) : null}

      {stale ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          data-testid="live-count-recount"
          pending={counting}
          pendingLabel={t('count.counting')}
          onClick={() => void runPreview()}
        >
          {t('recount')}
        </Button>
      ) : null}

      {/* Varování patří POD počet, ne místo něj: číslo je odpověď, varování
          je poznámka k tomu, jak přesná je. */}
      {(state.warnings ?? []).map((code) => (
        <Alert key={code} tone="warning">
          {t(`warnings.${code}`, { field: '' })}
        </Alert>
      ))}

      {state.sample && state.sample.length > 0 ? (
        <div className="grid gap-[var(--spacing-inline)] rounded-[var(--radius-surface)] border border-border bg-surface-muted p-[var(--spacing-gutter)]">
          <span className="meta-caps text-text-muted">{t('count.sampleLabel')}</span>
          <ul className="grid gap-1.5">
            {state.sample.slice(0, 5).map((contact) => (
              <li
                key={contact.id}
                data-testid="sample-contact"
                className="truncate font-mono text-sm text-text"
              >
                {contact.email}
              </li>
            ))}
          </ul>
          {/* Odkaz jen s obsluhou. U neuloženého segmentu není kam odkázat:
              filtr kontaktů se ptá na `segment_id`, který ještě neexistuje. */}
          {state.count !== null && onShowAll !== undefined ? (
            <Button variant="link" size="sm" className="self-start" onClick={onShowAll}>
              {t('count.showAll', { count: formatCount(state.count, locale) })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <p className="text-meta text-text-muted">{t('count.previewNote')}</p>
    </div>
  );
}

function cn(...values: (string | undefined)[]): string {
  return values.filter(Boolean).join(' ');
}
