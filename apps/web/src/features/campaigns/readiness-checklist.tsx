'use client';

import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { Send } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { SendDialog } from './send-dialog';

export type Finding = {
  code: string;
  severity: 'error' | 'warning';
  params?: Record<string, string | number> | undefined;
};

export type Breakdown = {
  raw: number;
  eligible: number;
  excluded_suppressed: number;
  excluded_unsubscribed: number;
  excluded_unconfirmed: number;
  excluded_snoozed: number;
  excluded_processing_restricted: number;
  excluded_invalid_email: number;
  excluded_deleted: number;
  excluded_sample: number;
  excluded_by_selection: number;
  duplicates_removed: number;
};

export type Preflight = {
  can_send: boolean;
  audience_estimate: number;
  breakdown: Breakdown;
  quota_remaining: number | null;
  undo_window_seconds: number;
  findings: Finding[];
  checked_at: string;
};

/** Pořadí je pořadí vyhodnocení bran, ne abeceda. V tom pořadí dává součet smysl. */
const GATE_KEYS: Array<[keyof Breakdown, string]> = [
  ['excluded_suppressed', 'excludedSuppressed'],
  ['excluded_unsubscribed', 'excludedUnsubscribed'],
  ['excluded_unconfirmed', 'excludedUnconfirmed'],
  ['excluded_snoozed', 'excludedSnoozed'],
  ['excluded_processing_restricted', 'excludedProcessingRestricted'],
  ['excluded_invalid_email', 'excludedInvalidEmail'],
  ['excluded_deleted', 'excludedDeleted'],
  ['excluded_sample', 'excludedSample'],
  ['excluded_by_selection', 'excludedBySelection'],
  ['duplicates_removed', 'duplicatesRemoved'],
];

export function toCamel(code: string): string {
  return code.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}

/**
 * Číslo v řádku Publikum, číslo na tlačítku, číslo v potvrzovacím dialogu a číslo
 * v rozpadu pocházejí z JEDNOHO volání preflightu. Kontrolní seznam nesmí publikum
 * spočítat sám: dvě obrazovky nad týmž segmentem se dřív rozcházely o 24 lidí
 * a rozdíl byl právě na tlačítku, které spouští nevratnou akci.
 */
/**
 * Pruh zkušebního režimu. Čísla jsou hotová z `trialAudienceNotice()` v jádru,
 * obrazovka si je nedopočítává: kdyby si je spočítala sama, rozešla by se
 * s tím, co při odeslání opravdu projde branou `canSendInTrial`.
 */
export type TrialNotice = { audience: number; willReceive: number };

export function ReadinessChecklist({
  preflight,
  campaignName,
  fromLine,
  subject,
  trialNotice,
  onSend,
}: {
  preflight: Preflight;
  campaignName: string;
  fromLine: string;
  subject: string;
  trialNotice?: TrialNotice | null;
  onSend?: (recipientCount: number) => Promise<{ status: 'success' | 'error'; code?: string }>;
}) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const findingRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const [dialogOpen, setDialogOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const errors = preflight.findings.filter((f) => f.severity === 'error');
  const warnings = preflight.findings.filter((f) => f.severity === 'warning');
  const b = preflight.breakdown;
  const excludedTotal = GATE_KEYS.reduce((sum, [key]) => sum + b[key], 0);

  function label(finding: Finding): string {
    const key = `preflight.${toCamel(finding.code)}`;
    // Neznámý kód se ukáže syrový, nikdy nespadne: výčty jsou otevřené.
    return t.has(key)
      ? t(key, (finding.params ?? {}) as never)
      : t('preflight.unknown', { code: finding.code });
  }

  function handleSend() {
    // Tlačítko zůstává aktivní i při blokující položce. Kliknutí přesune fokus
    // na první blokující položku a ohlásí ji čtečce; zašedlé tlačítko bez důvodu
    // je horší než tlačítko, které řekne, co chybí.
    if (!preflight.can_send && errors[0]) {
      findingRefs.current[errors[0].code]?.focus();
      return;
    }
    setDialogOpen(true);
  }

  async function confirmSend() {
    setDialogOpen(false);
    const result = await onSend?.(preflight.audience_estimate);
    setFailure(result && result.status === 'error' ? (result.code ?? 'error') : null);
  }

  return (
    /*
      Kontrola před odesláním je ZVÝRAZNĚNÁ KARTA. Je to poslední obrazovka
      před nevratnou akcí, takže má na stránce vyhrát nad vším ostatním;
      v návrhu je to týž žlutý panel jako v posledním kroku nastavení.
    */
    <Card
      aria-labelledby="readiness-title"
      tone="highlight"
      padding="md"
      gap="gutter"
      className="max-w-[820px]"
    >
      <CardTitle>
        <span id="readiness-title">{t('send.checklistTitle')}</span>
      </CardTitle>

      {/*
        Riziko z 8.2.9: uživatel postaví kampaň na 20 000 lidí a teprve při odeslání
        zjistí, že je ve zkušebním režimu. Obecné varování to nezmírní, proto je pruh
        HNED NAHOŘE a nese OBĚ čísla, kolik lidí je v publiku a kolika se opravdu
        odešle. Bez čísel by věta zněla stejně u dvou ověřených adres jako u nuly.
      */}
      {trialNotice && (
        <Alert tone="warning" data-testid="trial-mode-audience-notice">
          {t('trial.banner', {
            audience: format.number(trialNotice.audience),
            verified: trialNotice.willReceive,
          })}
        </Alert>
      )}

      {/* Shrnutí toho, co se odešle: popisek mono verzálkami, hodnota vedle. */}
      <dl
        className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-[var(--spacing-stack)] gap-y-1.5"
        data-testid="send-summary"
      >
        <dt className="meta-caps text-text-muted">{t('send.recipientsLabel')}</dt>
        <dd data-testid="recipient-count" className="text-ui text-text">
          {t('audience.recipientCount', { count: preflight.audience_estimate })}
        </dd>
        <dt className="meta-caps text-text-muted">{t('send.fromLabel')}</dt>
        <dd className="text-ui text-text">{fromLine}</dd>
        <dt className="meta-caps text-text-muted">{t('send.subjectLabel')}</dt>
        <dd className="text-ui text-text">{subject}</dd>
      </dl>

      {/* Součet vyloučených plus výsledek se rovná vstupnímu počtu. Věta to říká
          čísly, ne obecně, aby šlo poznat, že sedí. */}
      <p data-testid="audience-sum-check" className="text-meta text-text-muted">
        {t('audience.sumExplained', {
          selected: format.number(b.raw),
          excluded: format.number(excludedTotal),
          willSend: format.number(b.eligible),
        })}
      </p>

      {errors.length > 0 && (
        <section
          aria-labelledby="blocking-title"
          className="flex flex-col gap-[var(--spacing-inline)]"
        >
          <h3 id="blocking-title" className="meta-caps text-danger-text">
            {t('send.blockingTitle')}
          </h3>
          <ul className="flex flex-col gap-[var(--spacing-inline)]">
            {errors.map((f) => (
              <li
                key={f.code}
                tabIndex={-1}
                data-testid={`finding-${f.code}`}
                ref={(el) => {
                  findingRefs.current[f.code] = el;
                }}
              >
                <Alert tone="error">{label(f)}</Alert>
              </li>
            ))}
          </ul>
        </section>
      )}

      {warnings.length > 0 && (
        <section
          aria-labelledby="warning-title"
          className="flex flex-col gap-[var(--spacing-inline)]"
        >
          <h3 id="warning-title" className="meta-caps text-warning-text">
            {t('send.warningTitle')}
          </h3>
          <ul className="flex flex-col gap-[var(--spacing-inline)]">
            {warnings.map((f) => (
              <li key={f.code} data-testid={`finding-${f.code}`}>
                <Alert tone="warning">{label(f)}</Alert>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        aria-labelledby="excluded-title"
        className="flex flex-col gap-[var(--spacing-inline)]"
      >
        <h3 id="excluded-title" className="meta-caps text-text-muted">
          {t('audience.excludedTitle')}
        </h3>
        <ul data-testid="excluded-list" className="text-ui text-text">
          {/* Nulové brány se v seznamu nezobrazují, zaplevelily by ho. */}
          {GATE_KEYS.filter(([key]) => b[key] > 0).map(([key, msg]) => (
            <li key={key}>{t(`audience.${msg}`, { count: b[key] })}</li>
          ))}
        </ul>

        {/* V rozpadu za odkazem jsou VŠECHNY brány, i nulové, aby bylo vidět,
            že se kontrolovaly. */}
        <Collapsible summary={t('audience.breakdown')}>
          <ul data-testid="breakdown-panel" className="text-ui text-text">
            {GATE_KEYS.map(([key, msg]) => (
              <li key={key}>{t(`audience.${msg}`, { count: b[key] })}</li>
            ))}
          </ul>
        </Collapsible>
      </section>

      {failure !== null && <Alert tone="error">{t('send.sendFailed')}</Alert>}

      <div>
        <Button variant="primary" onClick={handleSend}>
          <Send aria-hidden className="icon-md" />
          {t('send.button', { count: preflight.audience_estimate })}
        </Button>
      </div>

      <SendDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaignName={campaignName}
        recipientCount={preflight.audience_estimate}
        fromLine={fromLine}
        subject={subject}
        undoSeconds={preflight.undo_window_seconds}
        warnings={warnings}
        onConfirm={confirmSend}
      />
    </Card>
  );
}
