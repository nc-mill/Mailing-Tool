'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { Switch } from '@mlain/ui/components/switch';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ContactSummary, EditorPorts } from '../../ports/types';
import { Code, Monitor, Smartphone, TextLines, UserRound } from '../icons';
import { useView, type Audience, type ViewMode } from '../view/view-state';

const MODES: Array<{ mode: ViewMode; Icon: typeof Monitor }> = [
  { mode: 'desktop', Icon: Monitor },
  { mode: 'mobile', Icon: Smartphone },
  { mode: 'text', Icon: TextLines },
  { mode: 'source', Icon: Code },
];

/**
 * Ovladače zobrazení v hlavičce editoru, hned u stavu ukládání.
 *
 * Nejsou to ovladače odděleného náhledu, přestože odtud pocházejí. Řídí PLÁTNO:
 * „Mobil" ho zúží na 375 px a zapne tatáž mobilní pravidla, jaká emitter posílá
 * v `@media` (`buildHeadCss`), „Tmavý režim" na něm přebije barvy rolí přesně
 * tam, kde je přebíjí e-mailový klient, a „Zobrazit jako" dosadí do značek
 * hodnoty místo štítků. Uživatel skládá e-mail v prostředí, ve kterém dojde.
 *
 * „Textová verze" a „Zdroj" plátno nevykreslují: obojí umí jen server, takže se
 * v nich needituje a hlavní plocha to říká pruhem s cestou zpátky.
 */
export function ViewControls({ ports }: { ports?: EditorPorts | undefined }) {
  const t = useTranslations('editor');
  const view = useView();

  return (
    <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
      {/*
       * SPOJENÝ PŘEPÍNAČ, jak ho kreslí návrh: jeden rámeček kolem celé sady
       * a tlačítka uvnitř oddělená svislou linkou, ne čtyři samostatné pilulky
       * s mezerami. Vnitřní tlačítka proto rámeček nemají, dělí je `border-r`
       * a rohy ořezává `overflow-hidden` na obalu.
       *
       * Skupina zůstává `radiogroup` se čtyřmi volbami. Návrh dvě z nich kreslí
       * jako samostatná tlačítka vedle přepínače, ale pro obsluhu i pro čtečku
       * je to jedna volba ze čtyř, a rozdělit ji kvůli vzhledu by z jedné
       * otázky udělalo tři.
       */}
      <div
        role="radiogroup"
        aria-label={t('preview.modes')}
        className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface"
      >
        {MODES.map(({ mode, Icon }) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={view.mode === mode}
            title={t(`preview.${mode}`)}
            data-testid={`view-mode-${mode}`}
            className={
              'flex min-h-[var(--size-control-sm)] items-center gap-1.5 px-3 py-1.5 text-sm ' +
              'border-r border-border last:border-r-0 ' +
              'text-text-muted hover:bg-surface-muted aria-checked:bg-surface-muted ' +
              'aria-checked:font-semibold aria-checked:text-text ' +
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]'
            }
            onClick={() => view.setMode(mode)}
          >
            <Icon aria-hidden className="icon-sm" />
            {t(`preview.${mode}`)}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <Switch aria-label={t('preview.dark')} checked={view.dark} onCheckedChange={view.setDark} />
        {t('preview.dark')}
      </label>

      <AudienceMenu ports={ports} />
    </div>
  );
}

/** Popisek volby do spouštěče nabídky, ať je vidět, čí data se právě dosazují. */
function audienceLabel(audience: Audience, t: ReturnType<typeof useTranslations>): string {
  if (audience.kind === 'tokens') return t('preview.tokens');
  if (audience.kind === 'contact') return audience.contact.name || audience.contact.email;
  return audience.variant === 'no_name' ? t('preview.noNameContact') : t('preview.sampleData');
}

function AudienceMenu({ ports }: { ports?: EditorPorts | undefined }) {
  const t = useTranslations('editor');
  const view = useView();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<ContactSummary[]>([]);

  const choose = (audience: Audience) => {
    view.setAudience(audience);
    setOpen(false);
    setQuery('');
    setFound([]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary" size="sm" className="gap-1.5">
          <UserRound aria-hidden className="icon-sm" />
          {t('preview.viewAs')}: {audienceLabel(view.audience, t)}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-2">
          <Input
            className="w-full"
            value={query}
            placeholder={t('preview.searchContact')}
            aria-label={t('preview.searchContact')}
            onChange={async (event) => {
              const next = event.target.value;
              setQuery(next);
              setFound(next.length >= 2 && ports ? await ports.searchContacts(next) : []);
            }}
          />
          {found.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {found.map((contact) => (
                <li key={contact.id}>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => choose({ kind: 'contact', contact })}
                  >
                    {contact.name || contact.email}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              const contact = await ports?.randomContact();
              // Bez kontaktů v projektu se nedá nic dosadit; nabídka zůstane
              // otevřená, aby bylo vidět, že se nic nestalo, a šlo zvolit jinak.
              if (contact) choose({ kind: 'contact', contact });
            }}
          >
            {t('preview.randomContact')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => choose({ kind: 'sample', variant: 'no_name' })}
          >
            {t('preview.noNameContact')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => choose({ kind: 'sample', variant: 'default' })}
          >
            {t('preview.sampleData')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => choose({ kind: 'tokens' })}>
            {t('preview.tokens')}
          </Button>
          <p className="text-meta text-text-muted">{t('preview.viewAsHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
