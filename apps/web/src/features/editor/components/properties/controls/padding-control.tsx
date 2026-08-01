'use client';

import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import type { ControlProps } from '../prop-field';

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

export function PaddingControl({ descriptor, value, onChange, id, autoFocus }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'padding') return <></>;
  const padding = (value ?? { top: 0, right: 0, bottom: 0, left: 0 }) as Record<string, number>;

  return (
    <div className="grid grid-cols-4 gap-1" role="group" aria-labelledby={id}>
      {SIDES.map((side, index) => (
        <label key={side} className="text-xs">
          <span className="text-text-muted">{t(`value.side.${side}`)}</span>
          <Input
            type="number"
            min={0}
            max={100}
            data-autofocus={autoFocus && index === 0 ? '' : undefined}
            value={padding[side] ?? 0}
            aria-label={`${t(descriptor.label)}: ${t(`value.side.${side}`)}`}
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
