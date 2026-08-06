'use client';

import { useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil } from '@mlain/ui/icons';
import { useToast } from '@mlain/ui/patterns/toast';
import { CAMPAIGN_NAME_MAX as NAME_MAX } from './campaign-rename';

export type RenameOutcome = { status: 'success' } | { status: 'error'; code: string };

/**
 * Název kampaně v hlavičce obrazovky, upravitelný na místě.
 *
 * PROČ TO VZNIKLO. Rozepsanou kampaň šlo přejmenovat jedině v kroku 2
 * („Předmět a název"), tedy o obrazovku dál, než kde je název napsaný. Zadavatel
 * z toho usoudil, že přejmenovat nejde vůbec. Funkce nechyběla, byla schovaná.
 *
 * JE TO POLE, NE NADPIS S TUŽKOU, a je to týž vzor, jaký už nese název šablony
 * v hlavičce editoru (`features/editor/components/header/template-name.tsx`).
 * Druhý vzor pro touž věc by znamenal, že se uživatel na dvou obrazovkách učí
 * dvě různá gesta pro přejmenování. Nadpis, který se v pole promění až po
 * kliknutí na ikonu, navíc vypadá jako popisek a nikdo do něj nezkusí kliknout.
 *
 * Že jde o pole, říkají TŘI VĚCI NARÁZ: rámeček v klidovém stavu, tužka u pravé
 * hrany a kurzor textu. Samotný rámeček by se v hlavičce dal přehlédnout jako
 * ozdoba, samotná tužka by lákala na kliknutí do ikony místo do textu.
 *
 * UKLÁDÁ SE PŘI ODCHODU Z POLE A NA ENTER, ne po každém stisku klávesy. Escape
 * vrátí poslední uložené jméno, aby šlo z rozepsaného překlepu vycouvat.
 *
 * ŠÍŘKA SE ŘÍDÍ TEXTEM. Pod polem leží neviditelná kopie téhož textu v témž
 * písmu a mřížka je obojí na sebe; pole je proto přesně tak široké jako jméno
 * a hlavičku nepřepůlí prázdný rámeček přes celou obrazovku. Dělá to CSS, ne
 * měření v JavaScriptu, takže se šířka nepere s překreslením a nepotřebuje
 * `field-sizing`, který Safari zatím nemá.
 */
export function CampaignNameField({
  name,
  onRename,
  canRename,
}: {
  name: string;
  /** Vrací výsledek, ne výjimku: zamčená kampaň je odpověď, ne porucha. */
  onRename: (name: string) => Promise<RenameOutcome>;
  /** Smí se v tomhle stavu a s těmihle právy přejmenovat? */
  canRename: boolean;
}) {
  const t = useTranslations('campaigns.settings');
  const toast = useToast();
  const errorId = useId();
  /** Poslední jméno, o kterém víme, že je na serveru. Escape se vrací sem. */
  const saved = useRef(name);
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function commit(): Promise<void> {
    const next = value.trim();
    if (next === saved.current) {
      // Mezery navíc nejsou změna, jen se uklidí zobrazená hodnota.
      setValue(saved.current);
      setError(null);
      return;
    }
    /*
     * Prázdné jméno se NEUKLÁDÁ a hláška je doslova ta, kterou na totéž dává
     * krok 2 (`errors.nameRequired`). Dvě různé věty za totéž pravidlo by
     * vypadaly jako dvě různá pravidla.
     */
    if (next === '') {
      setError(t('errors.nameRequired'));
      return;
    }
    if (next.length > NAME_MAX) {
      setError(t('errors.nameTooLong'));
      return;
    }

    setError(null);
    setPending(true);
    const result = await onRename(next);
    setPending(false);

    if (result.status === 'success') {
      saved.current = next;
      setValue(next);
      /*
       * Uložení musí být VIDĚT. Jméno v hlavičce po uložení vypadá stejně jako
       * rozepsané jméno před ním, takže bez oznámení se uživatel nedozví, jestli
       * se něco stalo, a klikne znovu.
       */
      toast.success(t('renameSaved'));
      return;
    }

    /*
     * SELHÁNÍ VRACÍ JMÉNO ZPÁTKY. Nechat v hlavičce napsané jméno, které na
     * serveru není, znamená lhát: uživatel odejde v přesvědčení, že kampaň se
     * jmenuje jinak, a v seznamu pak najde staré jméno. Že se hodnota vrátila,
     * se říká nahlas, jinak by to vypadalo, že pole samo zahodilo psaní.
     */
    setValue(saved.current);
    const text = result.code === 'campaign_locked' ? t('renameLocked') : t('renameFailed');
    setError(text);
    toast.error(text);
  }

  if (!canRename) {
    return <span data-testid="campaign-name-readonly">{name}</span>;
  }

  return (
    /*
      `inline-flex` a `items-start`, ne `flex`. Ve sloupcovém `flex` se položky
      ve výchozím stavu ROZTAHUJÍ na šířku obalu, takže se rámeček natáhl přes
      celý sloupec hlavičky a neviditelná kopie textu pod polem neměla co
      měřit. Naměřeno v prohlížeči: pole zůstalo stejně široké i po smazání
      celého jména.
    */
    <span className="inline-flex max-w-full flex-col items-start">
      <span className="inline-grid max-w-full">
        {/*
          Neviditelná kopie textu, která poli dává šířku. `whitespace-pre`
          kvůli mezerám na konci, `pr-9` kvůli místu pro tužku. Je
          `aria-hidden`, jinak by čtečka jméno přečetla dvakrát.
        */}
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 min-w-[8ch] overflow-hidden border border-transparent px-2 pr-9 whitespace-pre"
        >
          {value}
        </span>
        <input
          aria-label={t('name')}
          data-testid="campaign-name-input"
          /*
           * `size={1}`, jinak celé měření šířky nefunguje. Textové pole má
           * vlastní vnitřní šířku danou atributem `size`, a ta je ve výchozím
           * stavu DVACET ZNAKŮ. V písmu nadpisu to je přes 460 px, takže mřížka
           * brala tuhle hodnotu za spodní mez a rámeček zůstal stejně široký,
           * ať v poli stálo cokoli. Naměřeno v prohlížeči: pole mělo 463 px
           * s dlouhým jménem i se dvěma písmeny.
           */
          size={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              // `blur` schválně: uživatel dopsal a chce pryč. Uložení se pak
              // stejně provede přes `onBlur`, takže nevznikají dvě cesty k zápisu.
              event.currentTarget.blur();
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setValue(saved.current);
              setError(null);
            }
          }}
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : errorId}
          aria-busy={pending}
          className={[
            'col-start-1 row-start-1 min-w-[8ch] rounded-[var(--radius-control)]',
            'border border-border bg-transparent px-2 pr-9',
            '[font:inherit] tracking-[inherit] text-text',
            'transition-colors duration-[var(--duration-fast)]',
            'hover:border-border-strong hover:bg-field',
            'focus-visible:border-border-strong focus-visible:bg-field',
            'focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-[var(--color-focus-ring)]',
            'aria-[invalid=true]:border-danger',
          ].join(' ')}
        />
        <Pencil
          aria-hidden
          className="icon-sm pointer-events-none col-start-1 row-start-1 mr-2 self-center justify-self-end text-text-muted"
        />
      </span>
      {error === null ? null : (
        <span
          id={errorId}
          data-testid="campaign-name-error"
          className="px-2 pt-[var(--spacing-hairline)] text-meta font-normal tracking-normal text-danger-text"
        >
          {error}
        </span>
      )}
    </span>
  );
}
