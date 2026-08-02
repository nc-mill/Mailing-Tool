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

export function brandErrorKey(code: string): string {
  return ERROR_KEYS[code] ?? 'unreachable';
}

export type ExtractionFormState =
  | { phase: 'idle' }
  | { phase: 'running'; elapsedMs: number }
  | { phase: 'done' }
  | { phase: 'error'; code: string; url?: string; host?: string; limit?: number };

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
        <h2 className="text-2xl font-semibold text-text">{t('brand.title')}</h2>
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

      {state.phase === 'done' ? <p className="text-text">{t('brand.doneTitle')}</p> : null}

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
            {t(`brandErrors.${brandErrorKey(state.code)}`, {
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
