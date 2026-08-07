'use client';

import { Dialog as RadixDialog } from 'radix-ui';
import { useRef } from 'react';
import { X } from '../../icons';
import { cn } from '../../lib/cn';

/**
 * Hlavní menu jako VYSOUVACÍ PANEL. Na úzkém displeji je to jediná cesta
 * do navigace, protože boční menu je tam z rozvržení odstraněné úplně.
 *
 * PROČ VZNIKL. Boční menu si i zabalené bere 76 px. Na displeji 390 px
 * (což je po odečtení posuvníku 375 px) zbylo hlavnímu sloupci 299 px, z toho
 * po vnitřním okraji 269 px obsahu, tedy o pětinu méně, než má displej.
 * Naměřeno 7. 8. 2026 na Přehledu, Kontaktech i v detailu kontaktu: tlačítka
 * v pruhu akcí končila za pravým okrajem a stránka se posouvala do strany.
 * Zúžit menu dál nešlo, ikona a klikací cíl 44 px mají svou šířku. Jediné
 * řešení, které úzkému displeji vrátí celou šířku, je menu z rozvržení
 * ODEBRAT a otevírat ho přes tlačítko.
 *
 * DĚLÍCÍ ŠÍŘKA JE `md` (768 px), ne `sm`. Na tabletu na výšku se 76px pruh
 * ikon vejde a je lepší než tlačítko: navigace je vidět pořád. Pod 768 px
 * už se nevejde nic.
 *
 * STAVÍ NA `Dialog` z Radixu, ne na vlastním panelu. Modální dialog umí čtyři
 * věci, které vysouvací menu potřebuje a které se ručně dělají špatně: past
 * na fokus, zavření Escapem, návrat fokusu na spouštěcí tlačítko a zámek
 * skrolování stránky pod panelem. Vlastní `div` s `position: fixed` by
 * uživateli s klávesnicí nebo čtečkou nechal fokus bloudit po stránce vzadu.
 *
 * OBSAH SI DODÁVÁ APLIKACE. Panel neví, co je navigace: dostane `children`
 * a vykreslí je. Uvnitř stojí totéž `Sidebar`, které se na širokém displeji
 * kreslí do rozvržení, takže položky menu existují v jedné jediné podobě.
 */
export function NavDrawer({
  open,
  onOpenChange,
  title,
  closeLabel,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nadpis panelu, například „Hlavní navigace". Je vidět, ne jen pro čtečku. */
  title: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  /**
   * Prvek, ze kterého se panel otevřel.
   *
   * Panel se otevírá z tlačítka v hlavičce, tedy MIMO `Dialog.Trigger`, takže
   * Radix spouštěč nezná a po zavření nemá kam fokus vrátit. Naměřeno:
   * po Escapu skončil fokus na `<body>` a uživatel s klávesnicí se musel
   * k tlačítku menu prokousat tabulátorem od začátku stránky.
   */
  const openerRef = useRef<HTMLElement | null>(null);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--color-scrim)]" />
        <RadixDialog.Content
          // Popis panel nemá, a bez tohohle by Radix hlásil do konzole chybějící
          // `aria-describedby` na každém otevření.
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            openerRef.current = document.activeElement as HTMLElement | null;
          }}
          onCloseAutoFocus={(event) => {
            const opener = openerRef.current;
            openerRef.current = null;
            // `isConnected` je povinné. Po kliknutí na položku menu se stránka
            // přenačte a tlačítko, ze kterého se panel otevřel, v dokumentu
            // být nemusí; fokus na odpojený prvek nic neudělá a Radix by ho
            // mezitím už nevrátil nikam.
            if (opener?.isConnected) {
              event.preventDefault();
              opener.focus();
            }
          }}
          className={cn(
            'on-panel fixed inset-y-0 left-0 z-[var(--z-dialog)] flex flex-col',
            // Strop 85 % šířky je pro nejužší telefony: na 320px displeji by
            // panel v plné šířce menu (236 px) zakryl skoro celou obrazovku
            // a nebylo by vidět, že se pod ním něco skrývá.
            'w-[min(var(--size-sidebar),85vw)] bg-panel text-panel-foreground',
            '[&_a]:no-underline',
          )}
        >
          <div
            className={cn(
              'flex min-h-[var(--size-topbar)] shrink-0 items-center justify-between',
              'gap-[var(--spacing-inline)] border-b border-panel-line px-[var(--spacing-stack)]',
            )}
          >
            <RadixDialog.Title className="text-ui font-semibold text-panel-foreground">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close
              aria-label={closeLabel}
              className={cn(
                // Klikací cíl je 44 px, ne velikost ikony. Na dotykovém displeji
                // je zavírací křížek nejčastěji míjený prvek panelu.
                'inline-flex size-[var(--size-target-min)] shrink-0 items-center justify-center',
                'rounded-[var(--radius-control)] text-panel-soft hover:bg-panel-line hover:text-panel-foreground',
              )}
            >
              <X aria-hidden className="icon-md" />
            </RadixDialog.Close>
          </div>

          {/* `min-h-0` je povinné: bez něj se svislý posuv uvnitř menu neprojeví,
              protože flexový prvek se pod výšku svého obsahu sám nesmrskne
              a panel místo skrolování přeteče přes dolní okraj obrazovky. */}
          <div className="min-h-0 flex-1">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
