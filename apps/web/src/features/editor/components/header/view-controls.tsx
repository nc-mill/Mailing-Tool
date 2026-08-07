'use client';

import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { Popover, PopoverContent, PopoverTrigger } from '@mlain/ui/components/popover';
import { Switch } from '@mlain/ui/components/switch';
import { Tooltip } from '@mlain/ui/components/tooltip';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import type { ContactSummary, EditorPorts } from '../../ports/types';
import { Check, Code, Monitor, Moon, Smartphone, TextLines, UserRound } from '../icons';
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
       *
       * PROČ TU ZŮSTALY JEN IKONY, když u „Náhledu" vpravo jsme se právě vrátili
       * ke slovu. Jsou to dvě různé otázky a mají různé odpovědi:
       *
       * „Náhled" je SAMOSTATNÁ AKCE, která přepne celou obrazovku. Když je
       * ikona sama a nemá se s čím porovnat, čte se z ní jen tvar, a oko
       * v aplikaci znamená taky „ukázat heslo" a „viditelný sloupec". Proto
       * slovo.
       *
       * Tohle je JEDNA VOLBA ZE ČTYŘ, seřazená v jedné souvislé skupině. Tvary
       * se čtou proti sobě, ne samy o sobě: monitor, telefon, řádky textu
       * a špičaté závorky jsou vedle sebe rozlišitelné na první pohled a jsou
       * to tytéž kresby, jaké má panel vlastností a pruh „jen pro čtení".
       * Jméno každé volby nese `aria-label` i bublina, takže se dá vyvolat
       * hlasem a čtečka ji čte beze změny.
       *
       * Zvolená volba MUSÍ být poznat i bez textu, protože tučné písmo tu už
       * nemá na čem být: má proto plochu `accent-surface`, tmavý obrys ikony
       * a vnitřní pruh 2 px u spodní hrany. Barva sama by nestačila (WCAG
       * 1.4.1), proto ten pruh.
       *
       * KLIKACÍ PLOCHA 44 px, ne 36. Bylo to zapsané jako nesrovnalost proti
       * WCAG 2.5.8 a s odebráním textu by se čtvereček zmenšil ještě víc.
       * Sada je i tak o víc než polovinu užší než dřív.
       */}
      <div
        role="radiogroup"
        aria-label={t('preview.modes')}
        className="flex items-center overflow-hidden rounded-[var(--radius-control)] border border-border bg-surface"
      >
        {MODES.map(({ mode, Icon }) => (
          <Tooltip key={mode} content={t(`preview.${mode}`)}>
            <button
              type="button"
              role="radio"
              aria-checked={view.mode === mode}
              aria-label={t(`preview.${mode}`)}
              title={t(`preview.${mode}`)}
              data-testid={`view-mode-${mode}`}
              className={
                'flex size-[var(--size-target-min)] shrink-0 items-center justify-center ' +
                'border-r border-border last:border-r-0 ' +
                'text-text-muted hover:bg-surface-muted ' +
                'aria-checked:bg-accent-surface aria-checked:text-text ' +
                'aria-checked:shadow-[inset_0_-2px_0_var(--color-accent-text)] ' +
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]'
              }
              onClick={() => view.setMode(mode)}
            >
              <Icon aria-hidden className="icon-md" />
            </button>
          </Tooltip>
        ))}
      </div>

      {/*
        TMAVÝ REŽIM ZŮSTÁVÁ PŘEPÍNAČEM (`switch`), jen přišel o slova.

        Není to volba ze skupiny, je to samostatné zapnuto/vypnuto, a přesně
        na to je přepínač; udělat z něj páté tlačítko vedle čtyř režimů by
        tvrdilo, že si s nimi konkuruje, a přitom se s nimi kombinuje.

        Měsíc vedle něj je tam proto, aby ovladač nebyl holá pilulka bez
        jediného vodítka, co zapíná. Jméno akce nese `aria-label` i bublina,
        takže čtečka ani hlasové ovládání o nic nepřišly.
      */}
      <Tooltip content={t('preview.dark')}>
        <label className="flex h-[var(--size-target-min)] items-center gap-1.5 text-text-muted">
          <Moon aria-hidden className="icon-sm" />
          <Switch
            aria-label={t('preview.dark')}
            checked={view.dark}
            onCheckedChange={view.setDark}
          />
        </label>
      </Tooltip>

      <AudienceMenu ports={ports} />
    </div>
  );
}

/** Jméno zvoleného publika. Čte se z něj `aria-label` tlačítka i první řádek nabídky. */
function audienceLabel(audience: Audience, t: ReturnType<typeof useTranslations>): string {
  if (audience.kind === 'tokens') return t('preview.tokens');
  if (audience.kind === 'contact') return audience.contact.name || audience.contact.email;
  return audience.variant === 'no_name' ? t('preview.noNameContact') : t('preview.sampleData');
}

/** Sedí zvolené publikum na tuhle nabídku? Kontakt vlastní položku nemá. */
function isSample(audience: Audience, variant: 'default' | 'no_name'): boolean {
  return audience.kind === 'sample' && audience.variant === variant;
}

/**
 * Položka nabídky, která zároveň ukazuje, jestli je právě zvolená.
 *
 * Zaškrtnutí není jen ozdoba: spouštěč nabídky nese od zúžení hlavičky jen
 * slova „Zobrazit jako", takže rozbalená nabídka je jediné místo, kde se
 * volba dá VIDĚT. `aria-current` říká totéž čtečce, aby zaškrtnutí nebylo
 * informací nesenou jen obrázkem.
 */
function AudienceChoice(props: {
  current: boolean;
  onClick: () => void;
  /** „Značky" jsou výchozí stav, takže zůstávají tiché. Zbytek má rámeček. */
  variant?: 'secondary' | 'ghost';
  children: React.ReactNode;
}) {
  return (
    <Button
      variant={props.variant ?? 'secondary'}
      size="sm"
      className="w-full justify-between gap-1.5"
      aria-current={props.current ? 'true' : undefined}
      onClick={props.onClick}
    >
      {props.children}
      {props.current ? <Check aria-hidden className="icon-sm" /> : null}
    </Button>
  );
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

  const current = audienceLabel(view.audience, t);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/*
          NA TLAČÍTKU JE JEN „ZOBRAZIT JAKO". Se jménem publika bylo dvakrát
          širší než kterýkoli jiný ovladač v hlavičce a pruh se kvůli němu
          lámal do dvou řádků.

          Zvolená hodnota se tím ale NESMÍ ztratit. Nevidomý uživatel ji čte
          z `aria-label` („Zobrazit jako: Značky"), vidomý ji najde
          v rozbalené nabídce u zaškrtnuté položky a v jejím prvním řádku.
          Viditelný text je v `aria-label` obsažený celý, takže hlasové
          ovládání tlačítko dál najde podle toho, co je na něm napsané
          (WCAG 2.5.3).
        */}
        <Button
          variant="secondary"
          size="sm"
          /*
            KLIKACÍ PLOCHA 44 px PŘES NEVIDITELNÝ PŘEKRYV, viditelně zůstává 36.

            `size="sm"` je 36 px (`--size-control-sm`), tedy pod prahem WCAG 2.5.8.
            Zvětšit samotné tlačítko nejde: stojí v jedné řadě s přepínačem režimů
            a s přepínačem tmavého režimu, a o osm pixelů vyšší ovladač by z řady
            vyčníval. Překryv se proto roztáhne jen na výšku a přes celou šířku
            tlačítka, takže se cíl zvětší, ale nakreslený rámeček zůstane stejný.

            Je to týž vzor jako u ikonových tlačítek v tabulkách
            (`contacts-table.tsx`, `campaign-list.tsx`), jen tam je překryv čtverec,
            protože tam je i tlačítko čtverec.
          */
          className={[
            'relative gap-1.5',
            "after:absolute after:inset-x-0 after:top-1/2 after:content-['']",
            'after:h-[var(--size-target-min)] after:-translate-y-1/2',
          ].join(' ')}
          aria-label={t('preview.viewAsCurrent', { value: current })}
        >
          <UserRound aria-hidden className="icon-sm" />
          {t('preview.viewAs')}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72">
        <div className="flex flex-col gap-2">
          {/*
            První řádek nabídky říká, čí data se právě dosazují. Bez něj by
            volba „konkrétní kontakt" nebyla vidět nikde: vlastní položku
            v nabídce nemá, vzniká hledáním.
          */}
          <p className="text-sm text-text" data-testid="view-as-current">
            {t('preview.viewAsCurrent', { value: current })}
          </p>
          {/* Hledá se kontakt do náhledu, nepřihlašuje. Nabídka správce hesel by
              v úzké nabídce zakryla nalezené kontakty a zavřít by nešla, protože
              kliknutí mimo zavře celou nabídku. Podrobnosti
              v `@mlain/ui/lib/password-manager`. */}
          <Input
            className="w-full"
            autoComplete="off"
            {...passwordManagerOptOut}
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
          <AudienceChoice
            current={isSample(view.audience, 'no_name')}
            onClick={() => choose({ kind: 'sample', variant: 'no_name' })}
          >
            {t('preview.noNameContact')}
          </AudienceChoice>
          <AudienceChoice
            current={isSample(view.audience, 'default')}
            onClick={() => choose({ kind: 'sample', variant: 'default' })}
          >
            {t('preview.sampleData')}
          </AudienceChoice>
          <AudienceChoice
            variant="ghost"
            current={view.audience.kind === 'tokens'}
            onClick={() => choose({ kind: 'tokens' })}
          >
            {t('preview.tokens')}
          </AudienceChoice>
          <p className="text-meta text-text-muted">{t('preview.viewAsHint')}</p>
        </div>
      </PopoverContent>
    </Popover>
  );
}
