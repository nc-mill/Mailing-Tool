'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { ChevronRight, Sparkles } from '../icons';

/**
 * Sbalený panel AI asistenta.
 *
 * Proč to nemůže zůstat proužkem se šipkou: uživatel řekl doslova, že „není moc
 * poznat, že tam něco je". Šest pixelů široké tlačítko se znakem „‹" v barvě
 * ztlumeného textu nemá jak nic sdělit. Sbalený stav proto nese ikonu asistenta,
 * svisle psaný popisek a přízvučnou barvu z tokenů (`accent-surface`,
 * `accent-text`), tedy tutéž dvojici, kterou aplikace používá pro věci, na které
 * se má sáhnout. Vlastní barvy tu nejsou žádné.
 *
 * Přístupnost: je to obyčejné tlačítko s `aria-expanded` a `aria-controls`, takže
 * jde ovládat z klávesnice a čtečka řekne, že se něco rozbalí. Popisek je text
 * v tlačítku, ne jen `title`, aby ho nesla i přístupná jména.
 */
export function AssistantRail({
  open,
  onOpenChange,
  panel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ReactNode;
}) {
  const t = useTranslations('editor');

  if (!open) {
    return (
      <div className="flex">
        <button
          type="button"
          aria-expanded={false}
          aria-controls="editor-assistant"
          data-testid="assistant-rail"
          title={t('canvas.assistantOpen')}
          onClick={() => onOpenChange(true)}
          className={
            'flex w-11 shrink-0 flex-col items-center gap-2 border-l border-border ' +
            'bg-accent-surface py-3 text-accent-text hover:brightness-95 ' +
            'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]'
          }
        >
          <Sparkles aria-hidden className="size-5" />
          {/* Svislý popisek: v úzkém proužku se vodorovný text nevejde a
              zkratka („AI") by nedala vědět, co se rozbalí. */}
          <span
            className="text-xs font-medium tracking-wide"
            style={{ writingMode: 'vertical-rl' }}
          >
            {t('canvas.assistantOpen')}
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex" id="editor-assistant">
      <button
        type="button"
        aria-expanded
        aria-controls="editor-assistant"
        data-testid="assistant-rail"
        title={t('canvas.assistantHide')}
        aria-label={t('canvas.assistantHide')}
        onClick={() => onOpenChange(false)}
        className={
          'flex w-6 shrink-0 items-center justify-center border-l border-border ' +
          'bg-accent-surface text-accent-text hover:brightness-95 ' +
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]'
        }
      >
        <ChevronRight aria-hidden className="size-4" />
      </button>
      {panel}
    </div>
  );
}
