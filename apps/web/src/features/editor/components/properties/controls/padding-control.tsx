'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

/**
 * Pořadí na obrazovce, ne v datech.
 *
 * Ve čtyřech sloupcích vedle sebe zbylo na jedno pole 58 px a popisek
 * („Nahoře", „Vpravo") se do té šířky nevešel: lámal se na dvě řádky a
 * vynucoval si šířku, kterou panel nemá. Dvě dvojice pod sebou dají na
 * dvojici 125 px, takže popisek stojí VEDLE pole a čte se na jeden pohled.
 *
 * Dvojice jsou svislá a vodorovná, ne pořadí ze zkratky CSS: kdo mění
 * odsazení, mění skoro vždycky obě strany téže osy naráz.
 */
const DISPLAY_ORDER = ['top', 'bottom', 'left', 'right'] as const;

export function PaddingControl({ descriptor, value, onChange, labelId, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'padding') return <></>;
  const padding = (value ?? { top: 0, right: 0, bottom: 0, left: 0 }) as Record<string, number>;

  return (
    <div
      // Popisek i pole jsou přímé buňky mřížky (`contents` na popisku), aby
      // sloupce polí seděly pod sebou i tehdy, když je „Nahoře" delší než
      // „Dole". Pevnou šířku popisku by rozbila angličtina.
      className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-1.5 gap-y-1.5"
      role="group"
      aria-labelledby={labelId}
    >
      {DISPLAY_ORDER.map((side, index) => (
        <label key={side} className="contents text-meta">
          <span className="text-meta text-text-muted">{t(`value.side.${side}`)}</span>
          <Input
            type="number"
            min={0}
            max={100}
            data-autofocus={autoFocus && index === 0 ? '' : undefined}
            value={padding[side] ?? 0}
            aria-label={`${t(descriptor.label)}: ${t(`value.side.${side}`)}`}
            // Číselné pole v mřížce se musí umět zúžit. Bez `min-w-0` si drží
            // vlastní vnitřní šířku a vytlačí obsah panelu do vodorovného posuvu.
            className="min-w-0 px-2 text-center"
            onChange={(event) =>
              onChange({
                ...padding,
                [side]: Math.min(100, Math.max(0, Number(event.target.value || 0))),
              })
            }
          />
        </label>
      ))}
    </div>
  );
}
