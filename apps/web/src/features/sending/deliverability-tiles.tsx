'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { EmptyState } from '@mlain/ui/patterns/states';

/**
 * Míry doručitelnosti.
 *
 * `delivery_known` NENÍ nepovinný příznak k dovyplnění. Odrazy a stížnosti se
 * dozvíme jedině od odesílací služby, a když od ní nedorazila ani jedna zpráva
 * o osudu e-mailů, jsou obě čísla nula, jenže ta nula neznamená „nic se
 * nestalo", nýbrž „nic jsme se nedozvěděli". Obrazovka nad takovou nulou svítila
 * zeleně a tvrdila, že je všechno v pořádku.
 *
 * Rozhoduje se PODLE TÉHOŽ PRAVIDLA jako report kampaně a přehled projektu
 * (`isDeliveredKnown` v `packages/core/src/reports/campaign-stats/read.ts`);
 * stránka ho sem přinese hotové, nepočítá si ho znovu. Pole je povinné právě
 * proto, aby ho nešlo tiše vynechat, což je způsob, jakým tahle vada vznikla.
 *
 * `delivery_rate` a `soft_rate` odsud ZMIZELY. Nevykresloval je nikdo a
 * `soft_rate` se navíc plnil natvrdo nulou, tedy vymyšleným číslem.
 */
export type DeliverabilityMetrics = {
  /** `null`, když se míra nemá z čeho spočítat. */
  bounce_rate: number | null;
  complaint_rate: number | null;
  delivery_known: boolean;
};

export type AccountSnapshot = {
  enforcement_status: string | null;
  production_access: boolean | null;
  quota_max_24h: number | null;
  quota_sent_24h: number | null;
  quota_max_send_rate: number | null;
};

export type GuardThresholds = {
  bounce_warn_rate: number;
  bounce_guard_rate: number;
  complaint_warn_rate: number;
  complaint_guard_rate: number;
};

/**
 * Zóna se počítá z prahů, které přišly ze serveru, ne z čísel zadrátovaných
 * v komponentě. Kdyby tady stálo 5 %, obrazovka by po změně instalační proměnné
 * ukazovala jinou hranici, než při které brzda opravdu sepne.
 */
export function zoneFor(value: number, warn: number, guard: number): 'green' | 'orange' | 'red' {
  if (value >= guard) return 'red';
  if (value >= warn) return 'orange';
  return 'green';
}

const ZONE_CLASS: Record<string, string> = {
  green: 'border-success',
  orange: 'border-warning',
  red: 'border-danger',
};

function Tile({
  title,
  value,
  hint,
  testId,
  zone,
}: {
  title: string;
  value: string;
  hint?: string;
  testId?: string;
  zone?: 'green' | 'orange' | 'red';
}) {
  return (
    <div
      data-testid={testId}
      {...(zone ? { 'data-zone': zone } : {})}
      className={`flex flex-col gap-1 rounded-[var(--radius-surface)] border p-4 ${
        zone ? ZONE_CLASS[zone] : 'border-border'
      }`}
    >
      <span className="text-sm text-text-muted">{title}</span>
      <span className="text-2xl font-semibold">{value}</span>
      {hint ? <span className="text-sm text-text-muted">{hint}</span> : null}
    </div>
  );
}

export function DeliverabilityTiles({
  metrics,
  account,
  unmatchedEvents,
  thresholds,
  campaignsHref,
}: {
  metrics: DeliverabilityMetrics | null;
  account: AccountSnapshot | null;
  unmatchedEvents: number;
  thresholds: GuardThresholds;
  /** Kam vede jediná smysluplná akce prázdného stavu: čísla se objeví až po odeslání. */
  campaignsHref: string;
}) {
  const t = useTranslations('campaigns.deliverability');
  const tl = useTranslations('campaigns.list');
  const format = useFormatter();
  const router = useRouter();

  if (!metrics || !account) {
    return (
      <EmptyState
        variant="first"
        title={t('title')}
        explanation={t('empty')}
        actions={[{ label: tl('emptyAction'), onClick: () => router.push(campaignsHref) }]}
      />
    );
  }

  /**
   * Smí se z téhle míry udělat číslo?
   *
   * Dvě podmínky a obě jsou nutné: musíme mít od služby aspoň jednu zprávu
   * o osudu e-mailů (`delivery_known`) a míra musí mít jmenovatele (`!== null`).
   * Typový strážce `rate is number` je tu proto, aby se za ním nedalo omylem
   * formátovat `null`.
   */
  const measured = (rate: number | null): rate is number => metrics.delivery_known && rate !== null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="deliverability-title">
      <h2 id="deliverability-title" className="text-lg font-semibold">
        {t('title')}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile title={t('accountStatus')} value={account.enforcement_status ?? '-'} />
        <Tile
          title={t('dailyQuota')}
          value={`${format.number(account.quota_sent_24h ?? 0)} / ${format.number(
            account.quota_max_24h ?? 0,
          )}`}
        />
        <Tile title={t('sendRate')} value={String(account.quota_max_send_rate ?? 0)} />
        {/*
         * Dlaždice s mírou ukáže číslo jen tehdy, když stojí na měření.
         * Jinak je bez zóny, tedy bez barvy: zelený rámeček kolem „zatím
         * nevíme" by byl týž nepodložený klid, jaký tady svítil dřív.
         */}
        <Tile
          testId="tile-bounce"
          {...(measured(metrics.bounce_rate)
            ? {
                zone: zoneFor(
                  metrics.bounce_rate,
                  thresholds.bounce_warn_rate,
                  thresholds.bounce_guard_rate,
                ),
              }
            : {})}
          title={t('bounceTitle')}
          value={
            measured(metrics.bounce_rate)
              ? format.number(metrics.bounce_rate, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                })
              : t('unknownValue')
          }
          hint={measured(metrics.bounce_rate) ? t('bounceHint') : t('unknownHint')}
        />
        <Tile
          testId="tile-complaint"
          {...(measured(metrics.complaint_rate)
            ? {
                zone: zoneFor(
                  metrics.complaint_rate,
                  thresholds.complaint_warn_rate,
                  thresholds.complaint_guard_rate,
                ),
              }
            : {})}
          title={t('complaintTitle')}
          value={
            measured(metrics.complaint_rate)
              ? format.number(metrics.complaint_rate, {
                  style: 'percent',
                  maximumFractionDigits: 2,
                })
              : t('unknownValue')
          }
          hint={measured(metrics.complaint_rate) ? t('estimateNote') : t('unknownHint')}
        />
        <Tile title={t('unmatchedEvents')} value={format.number(unmatchedEvents)} />
      </div>
    </section>
  );
}
