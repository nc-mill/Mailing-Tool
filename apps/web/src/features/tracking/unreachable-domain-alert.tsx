'use client';

import { useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';

export type UnreachableDomainAlertProps = {
  kind: 'loopback' | 'private' | 'invalid';
  host: string;
  /** Na obrazovce měření se vysvětluje podrobně, v reportu stačí jedna věta. */
  variant: 'settings' | 'report';
};

/**
 * Upozornění, že měřicí doména není dosažitelná z internetu.
 *
 * PROČ TO VŮBEC EXISTUJE. `TRACKING_DOMAIN` je na vývojové instalaci
 * `http://localhost:3200`. Otevření e-mailu se měří obrázkem, který stahuje
 * server poštovní služby, ne prohlížeč příjemce; Gmail si ho tahá přes vlastní
 * proxy a ta na `localhost` nedosáhne. Z Gmailu proto NEDORAZÍ ANI JEDNO
 * otevření a report ukáže nulu.
 *
 * Do teď o tom aplikace mlčela a uživatel z nuly usoudil, že je měření
 * rozbité. Rozbité není, jen měří na adresu, na kterou nikdo zvenčí nedosáhne,
 * a to je rozdíl, který musí říct produkt, ne dokumentace.
 */
export function UnreachableDomainAlert({ kind, host, variant }: UnreachableDomainAlertProps) {
  const t = useTranslations('tracking');

  if (variant === 'report') {
    return (
      <Alert tone="warning" data-error-code="tracking_domain_unreachable">
        <p>{t('report.unreachable', { host })}</p>
      </Alert>
    );
  }

  /**
   * Klíč se NESKLÁDÁ za běhu (zákaz z 7.2 části 6): tři literály ve switchi
   * jsou nudné, ale jdou najít grepem a chybějící překlad se pozná v CI.
   */
  const reason =
    kind === 'loopback'
      ? t('settings.reach.loopback', { host })
      : kind === 'private'
        ? t('settings.reach.private', { host })
        : t('settings.reach.invalid', { host });

  return (
    <Alert
      tone="warning"
      title={t('settings.reach.title')}
      data-error-code="tracking_domain_unreachable"
    >
      <p>{reason}</p>
      <p className="mt-[var(--spacing-hairline)]">{t('settings.reach.consequence')}</p>
      <p className="text-meta text-text-muted">{t('settings.reach.fix')}</p>
    </Alert>
  );
}
