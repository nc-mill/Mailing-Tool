'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';

export const STEP_ORDER = ['understand', 'brand', 'compose', 'validate'] as const;
export type GenerationStep = (typeof STEP_ORDER)[number];

/**
 * Krok se odvozuje ze skutečných volání nástrojů na streamu, ne z časovače.
 * Čtyři kroky s odškrtáváním dávají pocit postupu a zároveň neslibují
 * procenta, která neumíme spočítat.
 */
export function stepFromToolCalls(
  toolNames: readonly string[],
  options: { finished?: boolean } = {},
): GenerationStep {
  if (options.finished === true) return 'validate';
  if (toolNames.includes('composeTemplate')) return 'compose';
  if (toolNames.includes('extractBrand') || toolNames.includes('startBrandExtraction')) {
    return 'brand';
  }
  return 'understand';
}

export function GenerationSteps({
  current,
  onCancel,
}: {
  current: GenerationStep;
  onCancel?: (() => void) | undefined;
}) {
  const t = useTranslations('ai');
  const currentIndex = STEP_ORDER.indexOf(current);

  return (
    <div className="flex flex-col gap-4">
      <p className="font-medium text-text">{t('steps.running')}</p>

      <ol className="flex flex-col gap-2">
        {STEP_ORDER.map((step, index) => {
          const state =
            index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
          return (
            <li
              key={step}
              data-testid={`step-${step}`}
              data-state={state}
              className={
                state === 'pending'
                  ? 'flex items-center gap-2 text-text-muted'
                  : 'flex items-center gap-2 text-text'
              }
            >
              <span
                aria-hidden="true"
                className={
                  state === 'active'
                    ? 'inline-flex size-5 items-center justify-center rounded-full bg-accent-surface text-accent-text'
                    : 'inline-flex size-5 items-center justify-center rounded-full bg-surface-muted'
                }
              >
                {state === 'done' ? '✓' : state === 'active' ? '●' : '○'}
              </span>
              <span>{t(`steps.${step}`)}</span>
            </li>
          );
        })}
      </ol>

      <p role="status" aria-live="polite" className="sr-only">
        {t(`steps.${current}`)}
      </p>

      <p className="text-sm text-text-muted">{t('steps.estimate')}</p>

      <div>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t('steps.cancel')}
        </Button>
      </div>
    </div>
  );
}
