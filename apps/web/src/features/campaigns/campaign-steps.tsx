'use client';

import { useTranslations } from 'next-intl';
import { CAMPAIGN_STEPS, type CampaignStep } from './steps';

/**
 * Přepínač kroků kampaně. Jeden pás pro obě obrazovky kampaně: pro editor
 * (krok 1) i pro formulář s předmětem a nastavením (kroky 2 a 3).
 *
 * Je to `nav` s tlačítky, ne záložky Radixu a ne odkazy:
 *
 * - ZÁLOŽKY z design systému odmontují neaktivní panel. Formulář kampaně je
 *   jeden a jeho hodnoty drží DOM, takže by přepnutí kroku zahodilo všechno,
 *   co uživatel rozepsal a neuložil.
 * - ODKAZ na jinou adresu by udělal totéž, jen přes směrovač.
 *
 * KROK NA JINÉ ADRESE SE PŘESTO PŘEPÍNÁ TLAČÍTKEM. Krok obsahu je vlastní
 * stránka (editor), takže se na něj musí navigovat, jenže ne obyčejným
 * odkazem: z editoru se odchází až po uložení a převzetí obsahu do kampaně.
 * Co přesně se má při odchodu stát, ví jen ta která obrazovka, proto se sem
 * předává `onNavigate`.
 *
 * `aria-current="step"` říká čtečce, ve kterém kroku uživatel je. Číslo kroku
 * je v kolečku vedle popisku a je `aria-hidden`, protože totéž hlásí věta
 * „Krok X z Y" nad přepínačem a dvakrát ji slyšet netřeba.
 */
export function CampaignStepNav({
  current,
  onSelect,
  disabled = false,
}: {
  current: CampaignStep;
  /**
   * Uživatel si vybral krok. Co se má stát, ví jen ta která obrazovka: krok
   * na téže obrazovce jen přepne panel, krok na jiné adrese se musí odejít
   * (z formuláře s otázkou na neuložené hodnoty, z editoru přes uložení
   * a převzetí obsahu). Pás kroků o tom rozhodovat nemá.
   */
  onSelect: (step: CampaignStep) => void;
  /** Probíhá odchod. Druhé kliknutí se zahodí, ať neběží dva odchody naráz. */
  disabled?: boolean;
}) {
  const t = useTranslations('campaigns.settings.steps');

  return (
    <nav aria-label={t('label')}>
      <ol className="flex flex-wrap gap-1 border-b border-border">
        {CAMPAIGN_STEPS.map((step, index) => {
          const active = step === current;
          return (
            <li key={step}>
              <button
                type="button"
                data-testid={`campaign-step-${step}`}
                aria-current={active ? 'step' : undefined}
                disabled={disabled && !active}
                onClick={() => {
                  // Kliknutí na krok, ve kterém uživatel právě je, nedělá nic.
                  // V editoru by to jinak znamenalo uložit a načíst tutéž stránku.
                  if (!active) onSelect(step);
                }}
                className={[
                  'flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  'focus-visible:outline-[var(--color-focus-ring)]',
                  'disabled:cursor-not-allowed disabled:opacity-60',
                  active
                    ? 'border-primary font-medium text-text'
                    : 'border-transparent text-text-muted hover:text-text',
                ].join(' ')}
              >
                <span
                  aria-hidden="true"
                  className={[
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs',
                    active ? 'bg-primary text-primary-foreground' : 'bg-surface-muted text-text',
                  ].join(' ')}
                >
                  {index + 1}
                </span>
                {t(step)}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
