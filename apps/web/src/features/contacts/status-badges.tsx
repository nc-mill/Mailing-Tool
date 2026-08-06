'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import type { ContactBadge } from './contact-state';
import type { ContactStatus } from './filters';

/**
 * Odznaky stavu kontaktu.
 *
 * BEZ IKONY, A JE TO ZÁMĚR NÁVRHU. Odznak stavu ji nemá ani návrh Kontaktů
 * (řádek 329), ani návrh Detailu kontaktu (řádek 225): jsou to mono verzálky
 * na barevné ploše a nic víc. Ikona odznak rozšiřovala o 22 px, takže se sloupec
 * „Stav" nevešel do 130 px, které mu návrh dává.
 *
 * PRAVIDLO 11.3 ČÁSTI 6 TÍM PORUŠENÉ NENÍ. To říká, že stav se nesmí sdělovat
 * JEN barvou. Rozlišovacím znakem je **slovo**, které je v `children` povinné;
 * ikona byla třetí znak navíc, ne ten nosný. `Badge` ji proto má nepovinnou
 * (DESIGN-ZAKLAD, kapitola 2.2).
 */
export function ContactStatusBadges({ badges }: { badges: ContactBadge[] }) {
  const t = useTranslations('contacts');
  const format = useFormatter();

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => {
        const date = badge.values?.['date'];
        return (
          <Badge key={badge.labelKey} tone={badge.tone}>
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
