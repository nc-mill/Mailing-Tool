'use client';

import { useTranslations } from 'next-intl';
import { Tag } from '@mlain/ui/components/tag';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { describeGreetingStatus, vocativeForm, type GreetingStatusInput } from './greeting-status';

/**
 * Původ oslovení je ŠTÍTEK, ne odznak.
 *
 * Návrh Kontaktů to rozhoduje výslovně: ve sloupci stojí tvar („Petře") a hned
 * za ním drobná popiska, odkud se vzal. Odznak (`Badge`) nese STAV položky
 * a stojí ve vlastním sloupci; tohle je doplněk k údaji vedle sebe, tedy `Tag`:
 * 11 px místo 12, tišší plocha, smí jich být v řádku víc.
 *
 * Tón `warning` štítek nezná, protože v papírové paletě je „upozornění"
 * a „zvýrazněno" tatáž žlutá plocha. Mapuje se proto na `accent`.
 */
const TONE: Record<'success' | 'warning' | 'neutral', 'success' | 'accent' | 'neutral'> = {
  success: 'success',
  warning: 'accent',
  neutral: 'neutral',
};

/**
 * Ukazuje TVAR i JEHO PŮVOD, ne jen hotovou větu.
 *
 * Rozdíl mezi „Petr" a „Petře" je celý produkt, ale v souvětí „Dobrý den, Petr"
 * se ztratí. Proto se tvar vypisuje samostatně a štítek vedle něj říká, jestli
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
    // NEZALAMUJE SE. Tvar se v úzkém sloupci zkrátí třemi tečkami a štítek zůstane
    // vedle něj, jak je to v návrhu. Se zalomením vyroste řádek tabulky z 63 px na 85
    // a celý seznam se roztáhne na dvojnásobek.
    //
    // `max-w-full` a `overflow-hidden` jsou pojistka na úzké okno. Štítek má
    // `white-space: nowrap`, takže se nezmenší, a samotné `min-w-0` nestačí: šířka
    // vloženého boxu se počítá „shrink to fit" a ta nikdy neklesne pod min-content.
    // Bez stropu proto sloupec přetekl do sousedního a překryl stav kontaktu.
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-[var(--spacing-inline)] overflow-hidden"
      data-greeting-status={status.kind}
    >
      {showForm ? (
        // Spolehlivý tvar je plný text, nejistý a neutrální je tlumený: v návrhu
        // se tím ve sloupci na první pohled pozná, kde je co zkontrolovat.
        <span
          className={
            status.tone === 'success'
              ? 'truncate text-ui text-text'
              : 'truncate text-ui text-text-muted'
          }
        >
          {form ?? t('greeting.noForm')}
        </span>
      ) : null}
      {/* `locale` se předává vždycky: jediná věta, která ho používá, je ta o jazyku
          bez 5. pádu, a next-intl by u ní bez parametru vyhodil chybu formátování.
          Ostatní věty parametr navíc ignorují. */}
      <Tooltip content={t(status.hintKey, { locale: contact.locale })}>
        <Tag tone={TONE[status.tone]}>{t(status.labelKey)}</Tag>
      </Tooltip>
    </span>
  );
}
