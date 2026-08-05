'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui/components/badge';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { CheckIcon, ClockIcon, WarningIcon } from '@/lib/ui/status-icons';
import { describeGreetingStatus, vocativeForm, type GreetingStatusInput } from './greeting-status';

/**
 * Odznak stavu oslovení. Stav nikdy nenese jen barva: má tón, ikonu i slovo
 * (8.8.1 a 11.3 části 6), proto má `Badge` z P05 `icon` povinný.
 */
const TONE_ICON = {
  success: CheckIcon,
  warning: WarningIcon,
  neutral: ClockIcon,
} as const;

/**
 * Ukazuje TVAR i JEHO PŮVOD, ne jen hotovou větu.
 *
 * Rozdíl mezi „Petr" a „Petře" je celý produkt, ale v souvětí „Dobrý den, Petr"
 * se ztratí. Proto se tvar vypisuje samostatně a odznak vedle něj říká, jestli
 * ho někdo potvrdil, spočítal slovník, nebo jde o odhad.
 */
export function GreetingBadge({
  contact,
  showForm = true,
}: {
  contact: GreetingStatusInput;
  /** Ve sloupci tabulky se tvar vypisuje, na detailu je hned nad odznakem. */
  showForm?: boolean;
}) {
  const t = useTranslations('contacts');
  const status = describeGreetingStatus(contact);
  const form = vocativeForm(contact);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5" data-greeting-status={status.kind}>
      {showForm ? <span className="text-sm text-text">{form ?? t('greeting.noForm')}</span> : null}
      {/* `locale` se předává vždycky: jediná věta, která ho používá, je ta o jazyku
          bez 5. pádu, a next-intl by u ní bez parametru vyhodil chybu formátování.
          Ostatní věty parametr navíc ignorují. */}
      <Tooltip content={t(status.hintKey, { locale: contact.locale })}>
        <Badge tone={status.tone} icon={TONE_ICON[status.tone]}>
          {t(status.labelKey)}
        </Badge>
      </Tooltip>
    </span>
  );
}
