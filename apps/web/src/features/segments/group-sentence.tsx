'use client';

import { useTranslations } from 'next-intl';

export type GroupSentenceProps = {
  op: 'and' | 'or';
  not: boolean;
  onChange: (next: { op: 'and' | 'or'; not: boolean }) => void;
};

/**
 * Věta skupiny je JEDNA ICU zpráva s pojmenovanými sloty, ne řetězení kusů
 * textu. Zpráva se rozloží na části a mezi ně se vloží komponenty, takže jazyk
 * smí sloty přeuspořádat, obalit dalšími slovy nebo je sloučit, aniž by se
 * sáhlo do kódu. Zřetězení tří řetězců by tuhle vlastnost zabilo a čeština
 * má rody a pády, takže by věta byla v půlce kombinací negramatická.
 */
export function GroupSentence({ op, not, onChange }: GroupSentenceProps) {
  const t = useTranslations('segments');

  const polarity = (
    <select
      key="polarity"
      aria-label={t('builder.polarityLabel')}
      value={not ? 'notMatch' : 'match'}
      onChange={(event) => onChange({ op, not: event.target.value === 'notMatch' })}
    >
      <option value="match">{t('builder.polarity.match')}</option>
      <option value="notMatch">{t('builder.polarity.notMatch')}</option>
    </select>
  );

  const quantifier = (
    <select
      key="quantifier"
      aria-label={t('builder.quantifierLabel')}
      value={op === 'and' ? 'all' : 'any'}
      onChange={(event) => onChange({ op: event.target.value === 'all' ? 'and' : 'or', not })}
    >
      <option value="all">{t('builder.quantifier.all')}</option>
      <option value="any">{t('builder.quantifier.any')}</option>
    </select>
  );

  return (
    <>
      <p data-testid="group-sentence">
        {/* Sloty jsou PROSTÉ argumenty zprávy, ne značky. `t.rich` proto
            dostane rovnou uzly; kdyby dostal funkce, next-intl by je předal
            Reactu jako potomka a React funkci jako dítě nevykreslí. */}
        {t.rich('builder.groupSentence', { polarity, quantifier })}
      </p>
      {/* Vysvětlující řádek u OBOU negovaných kombinací, ne jen u třetí.
          „Nesplňují všechny" si část lidí přečte jako „nesplňují žádnou",
          a angličtina má tutéž past, jen jinak položenou. */}
      {not ? (
        <p role="note">
          {t(op === 'and' ? 'builder.negationHint.andNot' : 'builder.negationHint.orNot')}
        </p>
      ) : null}
    </>
  );
}
