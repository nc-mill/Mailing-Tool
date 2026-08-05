'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { Alert } from '@mlain/ui/patterns/states';
import { SLOW_AFTER_MS } from './use-extraction-poll';

/**
 * `brand_host_not_allowed` a `brand_blocked_address` mají schválně stejnou
 * hlášku: uživatel nemá poznat, jestli byla adresa odmítnuta kvůli názvu,
 * nebo kvůli výsledku DNS. Vysvětlení „chráníme vnitřní síť" je informace
 * pro útočníka, ne pro uživatele.
 */
const ERROR_KEYS: Record<string, string> = {
  brand_invalid_url: 'invalidUrl',
  brand_scheme_not_allowed: 'schemeNotAllowed',
  brand_credentials_in_url: 'credentialsInUrl',
  brand_port_not_allowed: 'portNotAllowed',
  brand_host_not_allowed: 'blocked',
  brand_blocked_address: 'blocked',
  brand_dns_failed: 'unreachable',
  brand_fetch_failed: 'unreachable',
  brand_insecure_redirect: 'insecureRedirect',
  brand_too_many_redirects: 'tooManyRedirects',
  brand_redirect_loop: 'redirectLoop',
  brand_timeout: 'timeout',
  brand_response_too_large: 'tooLarge',
  brand_unexpected_content_type: 'notAWebPage',
  brand_robots_disallowed: 'robotsDisallowed',
  brand_robots_unavailable: 'robotsUnavailable',
  rate_limited: 'rateLimited',
  logo_not_found: 'logoNotFound',
};

/**
 * Kód, který NEPOCHÁZÍ z domény značky: naše vlastní API odpovědělo chybou
 * (401, 403, 404, 500) a na cizí web se přitom nikdo neptal.
 *
 * PROČ TO EXISTUJE: obrazovka na každou neúspěšnou odpověď hlásila „Na adresu
 * … jsme se nedostali. Zkontrolujte, jestli tam není překlep." To je u odpovědi
 * 404 z NAŠEHO serveru nepravda, a nepravda, která pošle uživatele hledat chybu
 * na svém webu. Naměřeno 4. 8. 2026: `POST /api/v1/brand/extractions` vracelo
 * 404 za dvě milisekundy, protože trasa nebyla zaregistrovaná, a uživatel četl,
 * že mu nefunguje web.
 */
export const SERVER_ERROR_CODE = 'brand_server_error';

export function brandErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? 'unreachable';
}

/**
 * Varování, která uživateli něco říkají. Ostatní kódy z běhu
 * (`logo_not_measured`, `tone_inference_disabled`, `tone_inference_failed`)
 * se schválně neukazují: týkají se rozměrů obrázku a odhadu tónu, tedy věcí,
 * které se na téhle obrazovce nenastavují, a jen by přehlušily to podstatné.
 */
const SHOWN_WARNINGS = ['colors_not_found', 'fonts_not_found', 'logo_not_found'] as const;

export type ExtractionFormState =
  | { phase: 'idle' }
  | { phase: 'running'; elapsedMs: number }
  | { phase: 'done'; warnings?: string[] }
  | {
      phase: 'error';
      code: string;
      url?: string;
      host?: string;
      limit?: number;
      /** Stav odpovědi našeho API. Vyplněný jen u `SERVER_ERROR_CODE`. */
      status?: number;
    };

export function ExtractionForm({
  state,
  onSubmit,
  onManual,
}: {
  state: ExtractionFormState;
  onSubmit?: (url: string) => void;
  onManual?: () => void;
}) {
  const t = useTranslations('ai');

  return (
    <section className="flex flex-col gap-4">
      <div>
        {/*
          Nadpis sekce, ne stránky. Stránka se jmenuje „Značka projektu" (h1
          skládá `SettingsPageShell`) a stažení z webu je jedna z cest, jak ji
          vyplnit, ne celý její obsah.
        */}
        <h2 className="text-xl font-semibold text-text">{t('brand.cta')}</h2>
        <p className="mt-1 text-text-muted">{t('brand.intro')}</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('url');
          if (typeof value === 'string') onSubmit?.(value);
        }}
      >
        <div className="min-w-64 flex-1">
          <Label className="sr-only" htmlFor="brand-url">
            {t('brand.urlLabel')}
          </Label>
          <Input
            id="brand-url"
            name="url"
            type="url"
            inputMode="url"
            placeholder={t('brand.urlPlaceholder')}
            disabled={state.phase === 'running'}
          />
        </div>
        <Button type="submit" disabled={state.phase === 'running'}>
          {t('brand.submit')}
        </Button>
      </form>

      {state.phase === 'idle' ? <p className="text-text-muted">{t('brand.emptyTitle')}</p> : null}

      {state.phase === 'running' ? (
        <p role="status" aria-live="polite" className="text-text">
          {t('brand.running')}
          {state.elapsedMs > SLOW_AFTER_MS ? ` ${t('brand.slow')}` : ''}
        </p>
      ) : null}

      {/*
        TŘETÍ TŘÍDA SELHÁNÍ: web odpověděl, běh doběhl, ale nic použitelného
        na něm nebylo. Bez tohohle výpisu obrazovka napsala „Hotovo.
        Zkontrolujte, jestli to sedí." i tehdy, když se z webu nevzalo NIC
        a profil dostal neutrální výchozí paletu. Naměřeno na petrnovak.com
        4. 8. 2026: běh skončil `succeeded` s varováními `colors_not_found`
        a `fonts_not_found`, a uživatel by si myslel, že barvy dole jsou jeho.
      */}
      {state.phase === 'done' ? (
        <div>
          <p className="text-text">{t('brand.doneTitle')}</p>
          {(state.warnings ?? []).some((code) =>
            (SHOWN_WARNINGS as readonly string[]).includes(code),
          ) ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-warning-text">
              {SHOWN_WARNINGS.filter((code) => (state.warnings ?? []).includes(code)).map(
                (code) => (
                  <li key={code}>{t(`brandWarnings.${code}`)}</li>
                ),
              )}
            </ul>
          ) : null}
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <Alert
          tone="error"
          action={
            <Button
              type="button"
              variant="secondary"
              className="mt-2 self-start"
              onClick={onManual}
            >
              {state.code === 'logo_not_found' ? t('brand.logoUpload') : t('brand.manualFallback')}
            </Button>
          }
        >
          <p>
            {state.code === SERVER_ERROR_CODE
              ? t('brandErrors.serverError', { status: state.status ?? 0 })
              : t(`brandErrors.${brandErrorKey(state.code)}`, {
                  url: state.url ?? '',
                  host: state.host ?? '',
                  limit: state.limit ?? 10,
                })}
          </p>
        </Alert>
      ) : null}
    </section>
  );
}
