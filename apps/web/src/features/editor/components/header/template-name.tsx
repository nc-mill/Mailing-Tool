'use client';

import { useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';

/** Meze z `ck_templates__name_len` a ze schématu dokumentu. Obojí shodně 1 až 120. */
const NAME_MAX = 120;

export type RenameResult = { ok: true } | { ok: false; code: string };

/**
 * Název šablony v hlavičce editoru.
 *
 * JE TO POLE, NE NADPIS S TUŽKOU. Uživatel si na název stěžoval slovy „musí jít
 * někde definovat", takže hledá místo, kam se dá psát. Nadpis, který se v pole
 * promění až po kliknutí na ikonu, tenhle test neprojde: vypadá jako popisek
 * a nikdo do něj nezkusí kliknout. Pole je vidět na první pohled.
 *
 * UKLÁDÁ SE PŘI ODCHODU Z POLE A NA ENTER, ne při každém stisku klávesy.
 * Přejmenování na serveru mění dokument i hash, takže po znaku by editor
 * poslal desítky požadavků a mezi nimi by si vyměňoval zámek sám se sebou.
 * Escape vrátí poslední uložený název, aby šlo z rozepsaného překlepu vycouvat.
 *
 * DÉLKU HLÍDÁ POLE, NE OŘEZ. `maxLength` by vložený delší název tiše zkrátil
 * a uživatel by se o tom dozvěděl až z e-mailu s useknutým předmětem. Radši
 * se to nechá napsat a řekne se, co je špatně.
 */
export function TemplateName({
  name,
  onRename,
  readOnly,
}: {
  name: string;
  /** Vrací výsledek, ne výjimku: zabrané jméno je odpověď, ne porucha. */
  onRename: (name: string) => Promise<RenameResult>;
  readOnly: boolean;
}) {
  const t = useTranslations('editor');
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
    if (next === '') {
      setError(t('header.name.empty'));
      return;
    }
    if (next.length > NAME_MAX) {
      setError(t('header.name.tooLong', { max: NAME_MAX }));
      return;
    }
    setError(null);
    setPending(true);
    const result = await onRename(next);
    setPending(false);
    if (result.ok) {
      saved.current = next;
      setValue(next);
      return;
    }
    setError(
      result.code === 'template_name_conflict'
        ? t('header.name.conflict')
        : t('header.name.failed', { code: result.code }),
    );
  }

  if (readOnly) {
    return (
      <span data-testid="template-name-readonly" className="text-sm font-medium text-text">
        {value}
      </span>
    );
  }

  return (
    <div className="flex flex-col">
      {/*
        Popisek je `header.rename`, klíč, který v katalogu ležel bez jediného
        volajícího od chvíle, kdy přejmenování vypadlo z dodávky. Druhý klíč
        s týmž textem by byl jen další překlad k údržbě.
      */}
      <input
        aria-label={t('header.rename')}
        data-testid="template-name"
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
            setValue(saved.current);
            setError(null);
          }
        }}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        aria-busy={pending}
        className="min-h-11 w-56 rounded-[var(--radius-control)] border border-transparent bg-transparent px-2 text-sm font-medium text-text hover:border-border focus:border-border-strong aria-[invalid=true]:border-danger"
      />
      {error === null ? null : (
        <p id={errorId} data-testid="template-name-error" className="px-2 text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
