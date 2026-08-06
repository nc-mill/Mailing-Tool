import { cn } from '../lib/cn';

/** Odstup nadpisu od řádku pod ním. Tři hodnoty, které má návrh. */
const TITLE_GAP = {
  /** 5 px: pod nadpisem je mono meta řádek. */
  sm: 'gap-[var(--spacing-title-sm)]',
  /** 8 px: pod nadpisem je věta. */
  md: 'gap-[var(--spacing-title-md)]',
  /** 10 px: meta řádek nese odznak, a je tedy vyšší než text. */
  lg: 'gap-[var(--spacing-title-lg)]',
} as const;

/**
 * Hlavička obrazovky. Stejná na všech stránkách, protože podle ní uživatel
 * pozná, kde je, a najde hlavní akci vždycky na stejném místě.
 *
 * ROZVRŽENÍ: název a to, co je pod ním, vlevo; mezi tím a akcemi je místo pro
 * filtry (`children`); akce vpravo. Vše zarovnané na SPODNÍ hranu, takže
 * tlačítka stojí na jedné lince se spodkem levého sloupce, ne s nadpisem.
 * U obrazovky s popisem to znamená, že akce klesnou pod větu, což návrh
 * skutečně dělá. Při zúžení okna se řádek zalomí.
 *
 * POD NADPISEM STOJÍ BUĎ `meta`, NEBO `description`, ne obojí. Žádná obrazovka
 * v návrhu nemá obojí a je to tak správně: mono meta řádek je souhrn čísel,
 * věta je vysvětlení. Když se předá obojí, vykreslí se obojí pod sebou
 * a nic nespadne, ale je to znamení, že jedno z toho patří jinam.
 */
export function PageHeader({
  title,
  eyebrow,
  meta,
  description,
  titleGap,
  breadcrumbs,
  actions,
  children,
  className,
}: {
  title: React.ReactNode;
  /**
   * Mono verzálky NAD nadpisem, které říkají, co je to za obrazovku:
   * „Report kampaně" nad názvem kampaně. Nezaměňuj s drobečky, ty vedou
   * jinam; tohle je popis toho, na co se člověk dívá.
   */
  eyebrow?: React.ReactNode;
  /** Mono řádek s čísly: počet, období, stav. */
  meta?: React.ReactNode;
  /**
   * Věta, která obrazovku vysvětlí. Sans 17 px, tlumená, nejvýš 640 px
   * na šířku: delší řádek se špatně čte, oko na konci nenajde začátek dalšího.
   */
  description?: React.ReactNode;
  /**
   * Odstup nadpisu od řádku pod ním. Bez zadání `sm` (5 px), a `md` (8 px),
   * když je vyplněný `description`, protože přesně to dělá návrh na každé
   * obrazovce s větou. `lg` (10 px) patří tam, kde meta řádek nese odznak.
   */
  titleGap?: keyof typeof TITLE_GAP;
  /** Drobečková navigace nad názvem. */
  breadcrumbs?: React.ReactNode;
  /** Tlačítka vpravo. Hlavní akce je poslední, tedy nejblíž kraji. */
  actions?: React.ReactNode;
  /** Filtry a přepínače mezi názvem a akcemi. */
  children?: React.ReactNode;
  className?: string;
}) {
  // Návrh má 8 px všude, kde nad nadpisem nebo pod ním stojí něco jiného
  // než holý mono souhrn čísel.
  const gap = titleGap ?? (description || eyebrow ? 'md' : 'sm');

  return (
    <div className={cn('mb-[var(--spacing-section)]', className)}>
      {breadcrumbs ? <div className="mb-[var(--spacing-stack)]">{breadcrumbs}</div> : null}
      <div className="flex flex-wrap items-end gap-[var(--spacing-card)]">
        <div
          className={cn(
            'grid min-w-0',
            TITLE_GAP[gap],
            // Strop šířky jen tam, kde je věta. U samotného nadpisu by ořízl
            // dlouhý název kampaně na půl řádku.
            description ? 'max-w-[var(--size-text-column)]' : '',
          )}
        >
          {eyebrow ? <span className="meta-caps text-text-muted">{eyebrow}</span> : null}
          {/* `tabIndex={-1}` nepřidává nadpis do pořadí tabulátoru, jen
              dovoluje na něj přesunout fokus z kódu. Po přechodu na jiný krok
              nebo obrazovku patří fokus sem: kdyby zůstal na tlačítku, které
              už neexistuje, uživatel čtečky by nevěděl, kde je. Využívá to
              `Wizard`, ale hodí se to každému, kdo mění obsah bez přenačtení. */}
          <h1
            tabIndex={-1}
            className="text-h1 leading-[var(--leading-heading)] font-semibold tracking-[var(--tracking-heading)] text-text outline-none"
          >
            {title}
          </h1>
          {meta ? <p className="font-mono text-meta text-text-muted">{meta}</p> : null}
          {description ? <p className="text-body text-text-muted">{description}</p> : null}
        </div>
        {children}
        {actions ? (
          <div className="ml-auto flex flex-wrap items-center gap-[var(--spacing-inline)]">
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}
