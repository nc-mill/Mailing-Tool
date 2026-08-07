'use client';

import { useId } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Card, CardFooter } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { cn } from '@mlain/ui/lib/cn';
import {
  Ban,
  ChartColumn,
  CircleQuestionMark,
  ShieldCheck,
  TriangleAlert,
  Zap,
} from '@mlain/ui/icons';
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

export type DeliverabilityZone = 'green' | 'orange' | 'red';

/**
 * Zóna se počítá z prahů, které přišly ze serveru, ne z čísel zadrátovaných
 * v komponentě. Kdyby tady stálo 5 %, obrazovka by po změně instalační proměnné
 * ukazovala jinou hranici, než při které brzda opravdu sepne.
 */
export function zoneFor(value: number, warn: number, guard: number): DeliverabilityZone {
  if (value >= guard) return 'red';
  if (value >= warn) return 'orange';
  return 'green';
}

/**
 * Vzhled zóny. BARVA NENÍ JEDINÝ NOSIČ INFORMACE: k rámečku patří odznak se
 * SLOVEM, takže se stav pozná i bez rozlišení barev a přečte ho odečítač
 * obrazovky. Dřív byla jediným rozdílem mezi „v pořádku" a „nad limitem"
 * barva rámečku.
 */
const ZONE: Record<
  DeliverabilityZone,
  { border: string; badge: 'success' | 'warning' | 'danger'; labelKey: string }
> = {
  green: { border: 'border-success', badge: 'success', labelKey: 'zoneOk' },
  orange: { border: 'border-warning', badge: 'warning', labelKey: 'zoneWarn' },
  red: { border: 'border-danger', badge: 'danger', labelKey: 'zoneGuard' },
};

/**
 * Dlaždice s číslem. NENÍ to komponenta katalogu (kapitola 4 základu designu):
 * skládá se z `Card`, mono verzálek a velkého čísla na místě. Tahle je dlaždice
 * DORUČITELNOSTI, takže umí navíc barvu zóny a odznak se stavem.
 */
function Tile({
  title,
  value,
  hint,
  meta,
  badge,
  icon,
  iconTone,
  size = 'display',
  unknown,
  testId,
  zone,
}: {
  title: string;
  value: string;
  hint?: string;
  /** Mono údaj v patičce, například práh, při kterém sepne brzda. */
  meta?: string;
  badge?: React.ReactNode;
  icon: React.ReactNode;
  iconTone: string;
  /**
   * Velikost hodnoty. `display` (40 px) je pro jedno číslo, `callout` (28 px)
   * pro slovo nebo pro dvojici čísel se zlomkem, která by se na 40 px zalomila
   * doprostřed dlaždice. Návrh sází „zatím nevíme" právě na 28 px.
   */
  size?: 'display' | 'callout';
  /** Hodnota není číslo, ale věta „zatím nevíme". Sází se tlumeně. */
  unknown?: boolean;
  testId?: string;
  zone?: DeliverabilityZone;
}) {
  const labelId = useId();

  return (
    <Card
      padding="md"
      aria-labelledby={labelId}
      data-testid={testId}
      {...(zone ? { 'data-zone': zone } : {})}
      className={zone ? ZONE[zone].border : ''}
    >
      <div className="flex items-center justify-between gap-[var(--spacing-inline)]">
        <h2 id={labelId} className="meta-caps text-text-muted">
          {title}
        </h2>
        <span
          aria-hidden
          className={cn(
            'inline-flex size-[var(--size-control-sm)] shrink-0 items-center justify-center',
            'rounded-[var(--radius-control)]',
            iconTone,
          )}
        >
          {icon}
        </span>
      </div>

      <p
        className={cn(
          'font-semibold text-text',
          size === 'callout' || unknown
            ? 'text-callout leading-[var(--leading-heading)] tracking-[var(--tracking-heading)]'
            : 'text-display leading-[var(--leading-number)] tracking-[var(--tracking-number)]',
          unknown ? 'text-text-muted' : '',
        )}
      >
        {value}
      </p>

      {badge}
      {hint ? <p className="text-meta text-text-muted">{hint}</p> : null}
      {meta ? (
        <CardFooter>
          <span className="font-mono text-meta text-text-muted">{meta}</span>
        </CardFooter>
      ) : null}
    </Card>
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
  /**
   * `null` znamená „nepočítáme", ne nulu. Stránka pro tenhle údaj zatím žádný
   * zdroj nemá a natvrdo předávaná nula by na obrazovce vypadala jako měření.
   */
  unmatchedEvents: number | null;
  thresholds: GuardThresholds;
  /** Kam vede jediná smysluplná akce prázdného stavu: čísla se objeví až po odeslání. */
  campaignsHref: string;
}) {
  const t = useTranslations('campaigns.deliverability');
  const tl = useTranslations('campaigns.list');
  const format = useFormatter();
  const router = useRouter();

  const percent = (value: number, digits: number) =>
    format.number(value, { style: 'percent', maximumFractionDigits: digits });

  const header = <PageHeader title={t('title')} description={t('description')} />;

  if (!metrics || !account) {
    return (
      <>
        {header}
        <EmptyState
          variant="first"
          title={t('title')}
          explanation={t('empty')}
          actions={[{ label: tl('emptyAction'), onClick: () => router.push(campaignsHref) }]}
        />
      </>
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

  const zoneBadge = (zone: DeliverabilityZone) => (
    <span>
      <Badge tone={ZONE[zone].badge}>{t(ZONE[zone].labelKey)}</Badge>
    </span>
  );

  const bounceZone = measured(metrics.bounce_rate)
    ? zoneFor(metrics.bounce_rate, thresholds.bounce_warn_rate, thresholds.bounce_guard_rate)
    : null;
  const complaintZone = measured(metrics.complaint_rate)
    ? zoneFor(
        metrics.complaint_rate,
        thresholds.complaint_warn_rate,
        thresholds.complaint_guard_rate,
      )
    : null;

  return (
    <>
      {header}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(230px,100%),1fr))] gap-[var(--spacing-gutter)]">
        <Tile
          title={t('accountStatus')}
          value={account.enforcement_status ?? '–'}
          size="callout"
          icon={<ShieldCheck aria-hidden className="icon-md" />}
          iconTone="bg-success-surface text-success-text"
        />
        <Tile
          title={t('dailyQuota')}
          value={`${format.number(account.quota_sent_24h ?? 0)} / ${format.number(
            account.quota_max_24h ?? 0,
          )}`}
          size="callout"
          icon={<ChartColumn aria-hidden className="icon-md" />}
          iconTone="bg-accent-surface text-warning-text"
        />
        <Tile
          title={t('sendRate')}
          value={String(account.quota_max_send_rate ?? 0)}
          icon={<Zap aria-hidden className="icon-md" />}
          iconTone="bg-surface-muted text-text-muted"
        />

        {/*
         * Dlaždice s mírou ukáže číslo jen tehdy, když stojí na měření.
         * Jinak je bez zóny, tedy bez barvy: zelený rámeček kolem „zatím
         * nevíme" by byl týž nepodložený klid, jaký tady svítil dřív.
         */}
        <Tile
          testId="tile-bounce"
          {...(bounceZone ? { zone: bounceZone } : {})}
          {...(bounceZone ? { badge: zoneBadge(bounceZone) } : {})}
          title={t('bounceTitle')}
          icon={<TriangleAlert aria-hidden className="icon-md" />}
          iconTone="bg-danger-surface text-danger-text"
          value={
            measured(metrics.bounce_rate) ? percent(metrics.bounce_rate, 1) : t('unknownValue')
          }
          {...(measured(metrics.bounce_rate) ? {} : { unknown: true })}
          hint={measured(metrics.bounce_rate) ? t('bounceHint') : t('unknownHint')}
          meta={t('guardAt', { rate: percent(thresholds.bounce_guard_rate, 1) })}
        />
        <Tile
          testId="tile-complaint"
          {...(complaintZone ? { zone: complaintZone } : {})}
          {...(complaintZone ? { badge: zoneBadge(complaintZone) } : {})}
          title={t('complaintTitle')}
          icon={<Ban aria-hidden className="icon-md" />}
          iconTone="bg-danger-surface text-danger-text"
          value={
            measured(metrics.complaint_rate)
              ? percent(metrics.complaint_rate, 2)
              : t('unknownValue')
          }
          {...(measured(metrics.complaint_rate) ? {} : { unknown: true })}
          hint={measured(metrics.complaint_rate) ? t('estimateNote') : t('unknownHint')}
          meta={t('guardAt', { rate: percent(thresholds.complaint_guard_rate, 2) })}
        />

        {/*
         * Nespárované události nikdo nepočítá: stránka pro ně nemá zdroj.
         * Dokud ho mít nebude, stojí tu věta, ne nula. Nula by tvrdila, že
         * se všechny události povedlo spárovat.
         */}
        <Tile
          title={t('unmatchedEvents')}
          value={unmatchedEvents === null ? t('unknownValue') : format.number(unmatchedEvents)}
          {...(unmatchedEvents === null ? { unknown: true, hint: t('unmatchedUnknownHint') } : {})}
          icon={<CircleQuestionMark aria-hidden className="icon-md" />}
          iconTone="bg-surface-muted text-text-muted"
        />
      </div>
    </>
  );
}
