'use client';

import { CircleQuestionMark, Mail, Search } from '../../icons';
import { cn } from '../../lib/cn';

/**
 * Hlavička aplikace.
 *
 * Nápověda je na všech stránkách na stejném místě (WCAG 2.2, kritérium 3.2.6
 * Consistent Help), včetně průvodců.
 *
 * `onOpenSearch` a `onOpenHelp` jsou NEPOVINNÉ a bez nich se tlačítko
 * nevykreslí. Dřív byly povinné, takže skořápka do nich dosadila prázdnou
 * funkci a v hlavičce svítilo hledání i nápověda, které po kliknutí neudělaly
 * nic. Tlačítko, které nic nedělá, je horší než chybějící tlačítko: slibuje
 * funkci, kterou produkt nemá, a uživatel ji zkouší znovu. Kritérium 3.2.6
 * mluví o tom, že nápověda má být na stejném místě všude, ne o tom, že tam má
 * být atrapa. Jakmile paleta příkazů a nápověda budou mít obsah, předá je
 * skořápka sem a tlačítka se vrátí na svoje původní místo.
 *
 * ZNAČKA vlevo je žlutý čtverec s obálkou a název produktu. Je to jediné
 * místo v aplikaci, kde se název píše natvrdo, protože to není obsah,
 * ale značka: nepřekládá se a nemění se podle projektu.
 *
 * Ikonová tlačítka tady nejsou `Button`. `Button` je obdélník s hranou a se
 * jménem akce, kdežto tohle je čtverec 40×40 s ikonou a s popiskem v bublině,
 * což je v návrhu jiný prvek s jinými rozměry.
 */
export function Topbar({
  navToggle,
  workspaceSwitcher,
  onOpenSearch,
  onOpenHelp,
  meta,
  jobsBadge,
  userMenu,
  labels,
}: {
  /**
   * Tlačítko hlavního menu, ÚPLNĚ VLEVO a jen na úzkém displeji. Dodává ho
   * skořápka aplikace, protože otevírá vysouvací panel, jehož stav drží ona.
   * Stojí před značkou schválně: pod 768 px je to jediná cesta do navigace,
   * a co je nejdůležitější, patří tam, kde palec začíná číst řádek.
   */
  navToggle?: React.ReactNode;
  workspaceSwitcher: React.ReactNode;
  onOpenSearch?: (() => void) | undefined;
  onOpenHelp?: (() => void) | undefined;
  /** Údaj vpravo v hlavičce, například čas v zóně projektu. */
  meta?: React.ReactNode;
  jobsBadge: React.ReactNode;
  userMenu: React.ReactNode;
  labels: { search: string; help: string; skipToContent: string };
}) {
  return (
    <header
      className={cn(
        'sticky top-0 z-[var(--z-topbar)] flex items-center',
        'min-h-[var(--size-topbar)] border-b border-border bg-surface',
        // Mezera i vnitřní okraj se na úzkém displeji stahují. S pevnými 30 px
        // na obou stranách a mezi třemi prvky si sama hlavička vezme 120 px
        // z 375 px šířky a její obsah se pak nemá kam vejít.
        'gap-[var(--spacing-stack)] px-[var(--spacing-stack)]',
        'sm:gap-[var(--spacing-card)] sm:px-[var(--spacing-card)]',
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-3 focus:py-2"
      >
        {labels.skipToContent}
      </a>

      {navToggle}

      <span className="flex shrink-0 items-center gap-[var(--spacing-inline)]">
        <span
          aria-hidden
          className={cn(
            'inline-flex size-[var(--size-mark)] items-center justify-center',
            'rounded-[var(--radius-control)] bg-primary text-primary-foreground',
          )}
        >
          <Mail className="icon-md" />
        </span>
        {/* NÁZEV PRODUKTU SE POD 640 px SKRÝVÁ, značka zůstává. Text má
            `whitespace-nowrap`, takže se nezalomí ani nezúží, a 145 px z 375 px
            je čtvrtina hlavičky za údaj, který uživatel při každodenní práci
            nepotřebuje. Žlutý čtverec s obálkou nese identitu sám. */}
        <span className="hidden text-h3 font-semibold tracking-[var(--tracking-heading)] whitespace-nowrap text-text sm:inline">
          Mlain Mailer
        </span>
      </span>

      {/* Přepínač projektů je JEDINÝ prvek hlavičky, který se smí zúžit: název
          projektu se dá zkrátit třemi tečkami, kdežto avatar ani odznak úloh
          ne. `min-w-0` je povinné, jinak flexový prvek pod svůj obsah nejde. */}
      <div className="flex min-w-0 shrink">{workspaceSwitcher}</div>

      <div className="ml-auto flex shrink-0 items-center gap-[var(--spacing-inline)] sm:gap-[var(--spacing-stack)]">
        {meta ? <span className="font-mono text-meta text-text-muted">{meta}</span> : null}

        {onOpenSearch ? (
          <button
            type="button"
            onClick={onOpenSearch}
            className={cn(
              'inline-flex min-h-[var(--size-control)] items-center gap-[var(--spacing-inline)]',
              'rounded-[var(--radius-control)] border border-border px-3.5 text-ui text-text',
              'hover:bg-surface-muted',
            )}
          >
            <Search aria-hidden className="icon-sm" />
            {labels.search}
          </button>
        ) : null}

        {onOpenHelp ? (
          <button
            type="button"
            onClick={onOpenHelp}
            aria-label={labels.help}
            title={labels.help}
            className={cn(
              'inline-flex size-[var(--size-control)] items-center justify-center',
              'rounded-[var(--radius-control)] border border-border text-text hover:bg-surface-muted',
            )}
          >
            <CircleQuestionMark aria-hidden className="icon-lg" />
          </button>
        ) : null}

        {jobsBadge}
        {userMenu}
      </div>
    </header>
  );
}
