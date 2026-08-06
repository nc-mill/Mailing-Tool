'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { SOCIAL_NETWORKS } from '../../../descriptors/social';
import type { ControlProps } from '../prop-field';

type SocialItem = { network: string; href: string; label?: string };

export function SocialItemsControl({ descriptor, value, onChange, id, labelId }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'socialItems') return <></>;
  const items = (value ?? []) as SocialItem[];
  const update = (next: SocialItem[]) => onChange(next);

  return (
    <div className="space-y-2" id={id} role="group" aria-labelledby={labelId}>
      {items.map((item, index) => (
        // Síť a odkaz JSOU POD SEBOU, ne vedle sebe. Vedle sebe si tři prvky
        // v panelu širokém 300 px vynucovaly víc místa, než tam je, a obsah
        // se vysunul do vodorovného posuvu.
        <div
          key={index}
          className="space-y-1 rounded-[var(--radius-control)] border border-border p-2"
        >
          <div className="flex min-w-0 items-center gap-1">
            <select
              aria-label={t('social.network')}
              className="min-h-[var(--size-target-min)] min-w-0 flex-1 rounded-[var(--radius-control)] border border-border-strong bg-field px-2 text-meta"
              value={item.network}
              onChange={(event) =>
                update(
                  items.map((entry, i) =>
                    i === index ? { ...entry, network: event.target.value } : entry,
                  ),
                )
              }
            >
              {SOCIAL_NETWORKS.map((network) => (
                <option key={network} value={network}>
                  {t(`social.${network}`)}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              aria-label={t('social.remove')}
              onClick={() => update(items.filter((_, i) => i !== index))}
            >
              ×
            </Button>
          </div>
          <Input
            aria-label={t('social.href')}
            className="min-w-0"
            value={item.href}
            onChange={(event) =>
              update(
                items.map((entry, i) =>
                  i === index ? { ...entry, href: event.target.value } : entry,
                ),
              )
            }
          />
        </div>
      ))}
      {items.length < descriptor.max ? (
        <Button
          variant="secondary"
          onClick={() => update([...items, { network: 'facebook', href: '' }])}
        >
          {t('social.add')}
        </Button>
      ) : (
        <p className="text-meta text-text-muted">{t('social.max', { max: descriptor.max })}</p>
      )}
    </div>
  );
}
