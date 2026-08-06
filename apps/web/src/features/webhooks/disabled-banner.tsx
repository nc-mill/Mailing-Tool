'use client';

import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Alert } from '@mlain/ui/patterns/states';

export type DisabledBannerProps = {
  url: string;
  lastStatus: number | null;
  since: string | null;
  /** V seznamu stačí krátký text, v detailu je místo na adresu a datum. */
  withDetail: boolean;
  endpointHref: string;
  onEnable: () => void;
};

/**
 * Krátký text je doslovný z 5.3 části 1, podrobnější podání je z hlášky 25
 * v 10.3 části 6. Obě verze slibují přehrání posledních 24 hodin, protože to
 * 3.8 části 1 u tlačítka „Znovu aktivovat" výslovně nabízí.
 */
export function DisabledBanner(props: DisabledBannerProps) {
  const t = useTranslations('settings');
  const format = useFormatter();

  return (
    <Alert
      // `Alert` s tónem `error` si roli `alert` a ikonu nastaví sám,
      // takže se tady nekreslí potřetí. Kód v DOM zůstává kvůli testům.
      tone="error"
      data-error-code="webhook_endpoint_disabled"
      title={t('webhooks.disabled.title')}
    >
      <p>{t('webhooks.disabled.body')}</p>

      {props.withDetail ? (
        <>
          <p className="text-meta text-text-muted">
            {t('webhooks.disabled.detail', {
              url: props.url,
              lastStatus: props.lastStatus ?? 0,
              since: props.since === null ? '' : format.dateTime(new Date(props.since), 'short'),
            })}
          </p>
          <p className="text-meta text-text-muted">{t('webhooks.disabled.replayNote')}</p>
        </>
      ) : null}

      <div className="mt-[var(--spacing-inline)] flex gap-[var(--spacing-inline)]">
        <Link href={`${props.endpointHref}?status=failed`} className="underline">
          {t('webhooks.disabled.showErrors')}
        </Link>
        {/* ODCHYLKA OD PLÁNU, oprava chyby: `Button` z P05 má výchozí
            `type="button"`, takže by tlačítko uvnitř formuláře nic neodeslalo
            a webhook by se nikdy nezapnul. Tady je `submit`, protože pruh
            vždycky stojí ve formuláři se skrytými poli. */}
        <Button type="submit" variant="primary" onClick={props.onEnable}>
          {t('webhooks.disabled.enable')}
        </Button>
      </div>
    </Alert>
  );
}
