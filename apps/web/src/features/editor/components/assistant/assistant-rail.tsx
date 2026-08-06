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

  /*
   * SBALENÝ ASISTENT JE KARTA, ne proužek přilepený k okraji. Návrh ho kreslí
   * jako svislé tlačítko se žlutou plochou, rámečkem `primary-hover` a rádiusem
   * 10 px, tedy stejně jako zvýrazněnou kartu. Sedí tak do mřížky vedle palety,
   * plátna a vlastností, kde je pro něj vyhrazený sloupec.
   */
  const railTone = [
    'border border-primary-hover bg-accent-surface text-accent-text',
    'rounded-[var(--radius-surface)]',
    'transition-colors duration-[var(--duration-fast)] hover:bg-primary hover:text-primary-foreground',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
  ].join(' ');

  if (!open) {
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-controls="editor-assistant"
        data-testid="assistant-rail"
        title={t('canvas.assistantOpen')}
        onClick={() => onOpenChange(true)}
        className={`flex flex-col items-center gap-[var(--spacing-inline)] px-2 py-[var(--spacing-stack)] ${railTone}`}
      >
        <Sparkles aria-hidden className="icon-md" />
        {/* Svislý popisek: v úzkém sloupci se vodorovný text nevejde a
            zkratka („AI") by nedala vědět, co se rozbalí. */}
        <span className="meta-caps" style={{ writingMode: 'vertical-rl' }}>
          {t('canvas.assistantOpen')}
        </span>
      </button>
    );
  }

  return (
    <div className="flex min-w-0 gap-[var(--spacing-hairline)]" id="editor-assistant">
      <button
        type="button"
        aria-expanded
        aria-controls="editor-assistant"
        data-testid="assistant-rail"
        title={t('canvas.assistantHide')}
        aria-label={t('canvas.assistantHide')}
        onClick={() => onOpenChange(false)}
        className={`flex w-6 shrink-0 items-center justify-center ${railTone}`}
      >
        <ChevronRight aria-hidden className="icon-sm" />
      </button>
      {panel}
    </div>
  );
}
