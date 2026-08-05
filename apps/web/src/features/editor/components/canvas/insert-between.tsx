'use client';

import { useTranslations } from 'next-intl';
import type { FlatItem } from '../../model/tree';
import { InsertMenu } from './insert-menu';

/**
 * Přidání bloku tlačítkem ZA daný blok. Samotnou nabídku i pravidla vnořování
 * drží `InsertMenu`, aby vkládání mezi bloky a vkládání do prázdného sloupce
 * nabízely totéž.
 */
export function InsertBetween({ item }: { item: FlatItem }) {
  const t = useTranslations('editor');
  return (
    // Viditelnost řeší obal `BlockChrome`, tady zůstane jen samotné tlačítko.
    <div className="flex items-center justify-center">
      <InsertMenu
        parent={item.path.slice(0, -1)}
        index={item.index + 1}
        label={t('insert.after', { block: t(`block.${item.block.type}`) })}
        testId={`insert-after-${item.block.id}`}
      />
    </div>
  );
}
