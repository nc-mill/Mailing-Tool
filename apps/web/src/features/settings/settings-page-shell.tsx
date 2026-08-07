import type { ReactNode } from 'react';
import { Card } from '@mlain/ui/components/card';
import { PageHeader } from '@mlain/ui/components/page-header';
import { ReadOnlyBanner } from '@mlain/ui/patterns/states';

export type SettingsPageShellProps = {
  title: string;
  lead?: string | undefined;
  /**
   * Mono řádek s čísly pod názvem. Buď `meta`, nebo `lead`, ne obojí: mono
   * řádek je souhrn čísel, věta je vysvětlení. `PageHeader` obojí vykreslí
   * a nic nespadne, ale je to znamení, že jedno z toho patří jinam.
   */
  meta?: ReactNode | undefined;
  /** Primární akce vpravo v hlavičce, viz rozložení 4.2 části 6. */
  action?: ReactNode | undefined;
  /** Pruh stavu S12. Formuláře pod ním se vykreslují jako text, ne zašedle. */
  /** Důvod jedinou větou. `ReadOnlyBanner` z P05 bere `reason`, ne nadpis a popis. */
  readOnly?: { reason: string } | undefined;
  children: ReactNode;
};

/**
 * Rámec jedné sekce nastavení. Drží rytmus, který mají všechny obrazovky:
 * **hlavička, případná hláška, karta s obsahem.**
 *
 * Hlavičku vykresluje `PageHeader` z `packages/ui`, ne vlastní `<h1>`. Sekce
 * nastavení je plnohodnotná obrazovka, takže má mít název ve stejné velikosti
 * a na stejném místě jako Kontakty nebo Kampaně. Dřív tu stálo `text-2xl`,
 * což je 24 px z výchozí škály Tailwindu, kdežto název obrazovky je 36 px
 * (`--text-h1`), a sekce nastavení tím vypadaly jako podstránka něčeho jiného.
 *
 * Odstup hlavičky od obsahu dodává `PageHeader` sám (`--spacing-section`),
 * proto tu žádný `mt-*` není.
 */
export function SettingsPageShell({
  title,
  lead,
  meta,
  action,
  readOnly,
  children,
}: SettingsPageShellProps) {
  return (
    <div>
      <PageHeader
        title={title}
        {...(lead === undefined ? {} : { description: lead })}
        {...(meta === undefined ? {} : { meta })}
        {...(action === undefined ? {} : { actions: action })}
      />
      {readOnly ? (
        <div className="mb-[var(--spacing-gutter)]">
          <ReadOnlyBanner reason={readOnly.reason} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

/**
 * Svislý sloupec sekcí uvnitř jedné obrazovky nastavení.
 *
 * Mezera je `--spacing-gutter` (20 px), tedy tatáž, jakou má mřížka karet na
 * detailu seznamu. Do teď se tu psalo `space-y-12` (48 px z výchozí škály
 * Tailwindu), což je hodnota, kterou návrh nezná: sekce od sebe odplouvaly
 * a na delší obrazovce se ztrácela souvislost.
 */
export function SettingsStack({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-[var(--spacing-gutter)]">{children}</div>;
}

/**
 * Jedna sekce uvnitř obrazovky nastavení: papírová plocha s hairline
 * rámečkem, okraj 30 px, rádius 10 px.
 *
 * PROČ TO OBALUJE STRÁNKA, A NE SAMA KOMPONENTA. Obsah sekcí nastavení leží
 * v doménových složkách (`features/members`, `features/webhooks`,
 * `features/tracking` a dalších), které patří jiným agentům a mění se
 * souběžně. Karta se proto skládá zvenčí, na stránce: vzhled dostane celá
 * sekce a v cizím souboru se nezmění ani řádek.
 *
 * Nadpis si každá sekce nese vlastní, protože k němu má `aria-labelledby`.
 * Proto tu `CardTitle` není: druhý nadpis by tomu prvnímu jen konkuroval.
 */
export function SettingsSection({
  children,
  tone,
  padding,
}: {
  children: ReactNode;
  /** `muted` pro lištu filtrů, jinak papír. */
  tone?: 'plain' | 'muted';
  /**
   * `none` je pro sekci, ve které sedí jenom tabulka: ta má jít až k rámečku
   * karty, jak to popisuje základ. `overflow-hidden` k tomu patří, jinak
   * tlumená hlavička tabulky přeteče přes zaoblený roh karty.
   */
  padding?: 'lg' | 'md' | 'sm' | 'none';
}) {
  return (
    <Card
      as="div"
      tone={tone ?? 'plain'}
      padding={padding ?? 'lg'}
      gap="gutter"
      className={padding === 'none' ? 'overflow-hidden' : ''}
    >
      {children}
    </Card>
  );
}

/**
 * Dva sloupce karet, přesně jako detail seznamu: `repeat(auto-fit,
 * minmax(360px, 1fr))`, mezera `--spacing-gutter`, zarovnané k hornímu okraji,
 * aby kratší sloupec neroztahoval karty do prázdna.
 *
 * Používá se tam, kde sekce nese víc krátkých karet vedle sebe. Obrazovka
 * s jednou širokou tabulkou zůstává v `SettingsStack`.
 *
 * MINIMUM SLOUPCE JE `min(360px, 100%)`, ne holých 360 px, a je to oprava
 * vodorovného přetečení. `minmax(360px, 1fr)` je TVRDÉ minimum: když je sloupec
 * užší než 360 px, mřížka se nezúží, jen přeteče ven ze stránky. Na displeji
 * 390 px má hlavní sloupec 269 px, takže karta začínala 91 px za pravým okrajem
 * (naměřeno 7. 8. 2026 na Nastavení: `scrollWidth` 451 px proti 375 px).
 * `min(...)` z minima udělá „360 px, pokud se vejde, jinak celá šířka".
 */
export function SettingsColumns({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(360px,100%),1fr))] items-start gap-[var(--spacing-gutter)]">
      {children}
    </div>
  );
}
