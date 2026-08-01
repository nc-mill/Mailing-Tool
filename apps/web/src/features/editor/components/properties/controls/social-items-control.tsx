'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { useTranslations } from 'next-intl';
import { SOCIAL_NETWORKS } from '../../../descriptors/social';
import type { ControlProps } from '../prop-field';

type SocialItem = { network: string; href: string; label?: string };

export function SocialItemsControl({ descriptor, value, onChange, id }: ControlProps) {
  const t = useTranslations('editor');
  if (descriptor.kind !== 'socialItems') return <></>;
  const items = (value ?? []) as SocialItem[];
  const update = (next: SocialItem[]) => onChange(next);

  return (
    <div className="space-y-2" role="group" aria-labelledby={id}>
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-1">
          <select
            aria-label={t('social.network')}
            className="h-9 rounded-[var(--radius-control)] border border-border bg-surface px-1 text-xs"
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
          <Input
            aria-label={t('social.href')}
            value={item.href}
            onChange={(event) =>
              update(
                items.map((entry, i) =>
                  i === index ? { ...entry, href: event.target.value } : entry,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            aria-label={t('social.remove')}
            onClick={() => update(items.filter((_, i) => i !== index))}
          >
            ×
          </Button>
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
        <p className="text-xs text-text-muted">{t('social.max', { max: descriptor.max })}</p>
      )}
    </div>
  );
}
