'use client';

import { useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Alert } from '@mlain/ui/patterns/states';

export type GuardLimits = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: number;
  DELIVERABILITY_COMPLAINT_GUARD_RATE: number;
  DELIVERABILITY_BOUNCE_WARN_RATE: number;
  DELIVERABILITY_COMPLAINT_WARN_RATE: number;
  DELIVERABILITY_GUARD_MIN_SENT: number;
};

export type GuardSettings = {
  bounce_guard_rate?: number;
  complaint_guard_rate?: number;
  bounce_warn_rate?: number;
  complaint_warn_rate?: number;
  guard_min_sent?: number;
};

type RateKey = keyof Omit<GuardSettings, 'guard_min_sent'>;

const RATE_FIELDS: Array<[RateKey, keyof GuardLimits, string]> = [
  ['bounce_guard_rate', 'DELIVERABILITY_BOUNCE_GUARD_RATE', 'bounceGuard'],
  ['complaint_guard_rate', 'DELIVERABILITY_COMPLAINT_GUARD_RATE', 'complaintGuard'],
  ['bounce_warn_rate', 'DELIVERABILITY_BOUNCE_WARN_RATE', 'bounceWarn'],
  ['complaint_warn_rate', 'DELIVERABILITY_COMPLAINT_WARN_RATE', 'complaintWarn'],
];

/**
 * Prahy doručitelnosti jdou nastavit JEN směrem k přísnosti.
 *
 * Hodnota z instalace je zároveň výchozí hodnota I strop (část 4a, 3.15.2.1),
 * a obrazovka to VYNUCUJE, ne jen ukazuje: pole mají `max` na instalační hodnotě,
 * formulář volnější číslo neodešle a řekne proč. U podlahy `guard_min_sent`
 * znamená přísnější také nižší číslo, protože brzda pak zabere dřív.
 *
 * Server tutéž mez kontroluje znovu (`PATCH /api/v1/settings/deliverability`
 * vrací 422 `validation_failed`). Kontrola v prohlížeči je pohodlí, ne ochrana.
 */
export function GuardThresholds({
  settings,
  limits,
  onSave,
}: {
  settings: GuardSettings;
  limits: GuardLimits;
  onSave?: (next: GuardSettings) => Promise<{ status: 'success' | 'error'; code?: string }>;
}) {
  const t = useTranslations('campaigns.sending.thresholds');
  const format = useFormatter();
  /*
   * Ve stavu se drží TEXT z pole, ne číslo. Kdyby se držela jen čísla, prázdné pole
   * by se okamžitě přepsalo zpět na výchozí hodnotu a uživatel by ho nemohl vymazat
   * a přepsat; ověřeno testem, kde po vymazání a napsání „5" zůstalo v poli „85".
   * Procenta jsou v poli, ve stavu i v odpovědi API zlomek, převod je na jednom místě.
   */
  const [text, setText] = useState<Record<string, string>>(() => ({
    bounce_guard_rate: String(
      (settings.bounce_guard_rate ?? limits.DELIVERABILITY_BOUNCE_GUARD_RATE) * 100,
    ),
    complaint_guard_rate: String(
      (settings.complaint_guard_rate ?? limits.DELIVERABILITY_COMPLAINT_GUARD_RATE) * 100,
    ),
    bounce_warn_rate: String(
      (settings.bounce_warn_rate ?? limits.DELIVERABILITY_BOUNCE_WARN_RATE) * 100,
    ),
    complaint_warn_rate: String(
      (settings.complaint_warn_rate ?? limits.DELIVERABILITY_COMPLAINT_WARN_RATE) * 100,
    ),
    guard_min_sent: String(settings.guard_min_sent ?? limits.DELIVERABILITY_GUARD_MIN_SENT),
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  /**
   * Kvůli zaostření prvního chybného pole. Ref sedí na mřížce polí, ne na
   * `Card`: ta ref nepřeposílá a `packages/ui` vlastní agent základu.
   */
  const fieldsRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  function percent(value: number): string {
    return format.number(value, { style: 'percent', maximumFractionDigits: 2 });
  }

  function setRate(key: RateKey, raw: string, max: number) {
    setSaved(false);
    setText((prev) => ({ ...prev, [key]: raw }));
    setErrors((prev) => {
      const next = { ...prev };
      const parsed = raw === '' ? undefined : Number(raw) / 100;
      if (parsed !== undefined && parsed > max) next[key] = t('tooLoose', { max: percent(max) });
      else delete next[key];
      return next;
    });
  }

  const hasError = Object.keys(errors).length > 0;

  /** Text na hodnoty pro API. Prázdné pole znamená „ponech instalační výchozí". */
  function collect(): GuardSettings {
    const out: GuardSettings = {};
    for (const [key] of RATE_FIELDS) {
      const raw = text[key] ?? '';
      if (raw !== '') out[key] = Number(raw) / 100;
    }
    const minSent = text['guard_min_sent'] ?? '';
    if (minSent !== '') out.guard_min_sent = Number(minSent);
    return out;
  }

  async function save() {
    if (hasError) {
      /*
       * Tlačítko je `secondary`, takže nemá `unavailableReason`, kterým
       * `primary` vysvětluje, proč akce nejde. Mrtvé tlačítko z toho ale být
       * nesmí: dřív se tady jenom `return`ovalo a kliknutí nedělalo NIC.
       * Fokus proto skočí na první chybné pole, u kterého už důvod stojí
       * napsaný. Je to zároveň to, co pravidlo o klávesnici žádá po každém
       * odmítnutém odeslání formuláře.
       */
      const invalid = fieldsRef.current?.querySelector('[aria-invalid="true"]');
      if (invalid instanceof HTMLElement) invalid.focus();
      return;
    }
    setPending(true);
    try {
      const result = await onSave?.(collect());
      if (result?.status === 'error') {
        setErrors({ form: result.code ?? 'error' });
        setSaved(false);
      } else {
        setSaved(true);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Card aria-labelledby="guards-title" gap="gutter">
      <div className="flex flex-col gap-[var(--spacing-hairline)]">
        <CardTitle>
          <span id="guards-title">{t('title')}</span>
        </CardTitle>
        <p className="text-meta text-text-muted">{t('explanation')}</p>
      </div>

      {/* Dvojice polí vedle sebe, mřížka z návrhu pro formulář ve dvou sloupcích. */}
      <div
        ref={fieldsRef}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] gap-[var(--spacing-gutter)]"
      >
        {RATE_FIELDS.map(([key, limitKey, labelKey]) => {
          const max = limits[limitKey];
          return (
            <Field
              key={key}
              label={t(labelKey)}
              hint={t('ceiling', { value: percent(max) })}
              {...(errors[key] ? { error: errors[key] } : {})}
            >
              <Input
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                // Strop je v atributu, ne jen v nápovědě: prohlížeč sám nepustí dál.
                max={max * 100}
                data-testid={`guard-${key}`}
                value={text[key] ?? ''}
                onChange={(event) => setRate(key, event.target.value, max)}
              />
            </Field>
          );
        })}

        <Field
          label={t('minSent')}
          hint={t('ceiling', { value: format.number(limits.DELIVERABILITY_GUARD_MIN_SENT) })}
          {...(errors['guard_min_sent'] ? { error: errors['guard_min_sent'] } : {})}
        >
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={limits.DELIVERABILITY_GUARD_MIN_SENT}
            data-testid="guard-guard_min_sent"
            value={text['guard_min_sent'] ?? ''}
            onChange={(event) => {
              const raw = event.target.value;
              const parsed = raw === '' ? undefined : Number(raw);
              setSaved(false);
              setText((prev) => ({ ...prev, guard_min_sent: raw }));
              setErrors((prev) => {
                const next = { ...prev };
                if (parsed !== undefined && parsed > limits.DELIVERABILITY_GUARD_MIN_SENT) {
                  next['guard_min_sent'] = t('tooLoose', {
                    max: format.number(limits.DELIVERABILITY_GUARD_MIN_SENT),
                  });
                } else delete next['guard_min_sent'];
                return next;
              });
            }}
          />
        </Field>
      </div>

      {/* Chyba u pole stojí u pole. Souhrnný blok je jen pro chybu ze serveru,
          aby tatáž věta nesvítila třikrát na jedné obrazovce. */}
      {errors['form'] !== undefined && (
        <Alert tone="error" data-testid="guard-error">
          {errors['form']}
        </Alert>
      )}
      {saved && <Alert tone="success">{t('saved')}</Alert>}

      <div className="flex">
        {/* Sekundární, ne žluté. Žluté tlačítko je na obrazovce jedno a na
            Odesílání ho má „Zapnout zkušební režim": ten mění stav celého
            projektu, kdežto tohle je běžné uložení formuláře. */}
        <Button variant="secondary" onClick={save} pending={pending}>
          {t('save')}
        </Button>
      </div>
    </Card>
  );
}
