'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { CheckIcon, ClockIcon, SlashIcon, WarningIcon } from '@/lib/ui/status-icons';
import type { ContactBadge } from './contact-state';
import type { ContactStatus } from './filters';

/**
 * Stav nikdy nenese jen barva: odznak má tón, ikonu i slovo (8.8.1 a 11.3 části 6).
 * `Badge` z P05 má proto `icon` povinný.
 */
const TONE_ICON = {
  success: CheckIcon,
  warning: WarningIcon,
  neutral: ClockIcon,
  danger: SlashIcon,
} as const;

export function ContactStatusBadges({ badges }: { badges: ContactBadge[] }) {
  const t = useTranslations('contacts');
  const format = useFormatter();

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => {
        const date = badge.values?.['date'];
        return (
          <Badge key={badge.labelKey} tone={badge.tone} icon={TONE_ICON[badge.tone]}>
            {date === undefined
              ? t(badge.labelKey)
              : t(badge.labelKey, { date: format.dateTime(new Date(date), 'short') })}
          </Badge>
        );
      })}
    </span>
  );
}

export const CONTACT_STATUS_TONE: Record<ContactStatus, ContactBadge['tone']> = {
  active: 'success',
  unconfirmed: 'warning',
  unsubscribed: 'neutral',
  bounced: 'danger',
  complained: 'danger',
  deleted: 'neutral',
};
