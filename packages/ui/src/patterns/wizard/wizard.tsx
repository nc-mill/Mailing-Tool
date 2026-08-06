'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../components/dialog';
import { PageHeader } from '../../components/page-header';
import { cn } from '../../lib/cn';

export type WizardStep = { id: string; label: string };

export type WizardLabels = {
  stepOf: (current: number, total: number) => string;
  back: string;
  next: string;
  destructiveBackTitle: string;
  destructiveBackConfirm: string;
  destructiveBackRetreat: string;
};

/**
 * Vícekrokový průvodce. Krok patří do URL, aby se dal poslat kolegovi
 * a aby fungovalo tlačítko zpět v prohlížeči. Komponenta krok nedrží,
 * jen ho dostane a ohlásí změnu.
 *
 * HLAVIČKU KRESLÍ `PageHeader`, tedy tatáž komponenta jako u všech ostatních
 * obrazovek. Průvodce si dřív vykresloval vlastní `<h1>` a mělo to dva
 * následky. Zaprvé se nedal srovnat se zbytkem aplikace zvenčí: obrazovka
 * s ním nemohla použít `PageHeader`, protože by měla dva nadpisy první
 * úrovně. Zadruhé, a to je horší, **nadpisem stránky bylo jméno kroku**,
 * takže na obrazovce nikde nestálo, že jde o import kontaktů. Kdo se na ni
 * vrátil po přepnutí panelu, neměl jak poznat, kde je.
 *
 * Teď je nadpisem `title` (co se tu dělá) a krok je mono řádek nad ním
 * („Krok 2 ze 3"), stejně jako `eyebrow` u ostatních obrazovek. Bez `title`
 * zůstává nadpisem jméno kroku, aby starší volající nespadli.
 */
export function Wizard({
  steps,
  current,
  onNavigate,
  labels,
  children,
  title,
  description,
  destructiveBack,
  nextLabel,
  onBeforeNext,
  hideNext = false,
  footer,
  className,
}: {
  steps: WizardStep[];
  /** Krok drží URL, ne komponenta. Vlastníkem adresy je `useWizardStep`. */
  current: string;
  onNavigate: (stepId: string) => void;
  labels: WizardLabels;
  children: React.ReactNode;
  /**
   * Když je zadaný, návrat je destruktivní a tohle je věta o tom, co se
   * ztratí. Text dodává obrazovka, protože jen ona ví, co v tomhle kroku
   * konkrétně zahodí.
   */
  destructiveBack?: string;
  /**
   * Název celé úlohy, například „Import kontaktů". Bez něj je nadpisem jméno
   * kroku, což je horší: obrazovka pak neříká, co se na ní vlastně dělá.
   */
  title?: string;
  /** Věta pod nadpisem, která úlohu vysvětlí. */
  description?: React.ReactNode;
  /** Poslední krok nese název konkrétní akce, ne slovo „Dokončit" (9.3). */
  nextLabel?: string;
  /**
   * Co se má stát PŘED přechodem na další krok. Vrátí `false` a průvodce
   * nikam nepřejde.
   *
   * K čemu to je: krok často musí něco uložit dřív, než se pokročí, například
   * kódování a oddělovač u kontroly souboru. Bez tohohle si krok kreslil
   * vlastní tlačítko „Pokračovat" **vedle toho, které dodává průvodce**,
   * takže na obrazovce byla dvě stejně vypadající tlačítka a to spodní
   * přeskočilo uložení. Kdo klikl na ně, přišel o svou volbu a import běžel
   * se špatně přečteným souborem. Dvě tlačítka, ze kterých každé dělá něco
   * jiného, jsou horší než tlačítko chybějící.
   */
  onBeforeNext?: () => boolean | Promise<boolean>;
  /**
   * Nevykreslí tlačítko „Pokračovat" vůbec. Použij jen tam, kde krok
   * pokračuje **jinou akcí**, například odesláním formuláře, a `onBeforeNext`
   * na to nestačí. Nikdy ne proto, aby sis vedle něj nakreslil vlastní.
   */
  hideNext?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  const index = steps.findIndex((step) => step.id === current);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);

  // Po přechodu kroku patří fokus na nadpis kroku, jinak zůstane
  // na tlačítku, které už neexistuje, a uživatel neví, kde je.
  useEffect(() => {
    // Nadpis kreslí `PageHeader`, takže se hledá v DOM, ne přes `ref` na prvek.
    // `PageHeader` mu dává `tabIndex={-1}`, jinak by `focus()` nic neudělal.
    rootRef.current?.querySelector('h1')?.focus();
  }, [current]);

  const previousStep = index > 0 ? steps[index - 1] : undefined;
  const nextStep = index >= 0 && index < steps.length - 1 ? steps[index + 1] : undefined;

  const [advancing, setAdvancing] = useState(false);

  async function goNext() {
    if (!nextStep || advancing) return;
    if (onBeforeNext) {
      setAdvancing(true);
      try {
        const muzeDal = await onBeforeNext();
        if (!muzeDal) return;
      } finally {
        setAdvancing(false);
      }
    }
    onNavigate(nextStep.id);
  }

  function goBack() {
    if (!previousStep) return;
    if (destructiveBack !== undefined) {
      setConfirmBack(true);
      return;
    }
    onNavigate(previousStep.id);
  }

  const stepName = steps[index]?.label ?? '';
  // Ukazatel kroku je `aria-live`, protože se po přechodu mění, aniž by na něj
  // šel fokus. Fokus jde na nadpis, viz výš.
  const stepIndicator = (
    <span role="status" aria-live="polite">
      {labels.stepOf(index + 1, steps.length)}
      {title === undefined ? '' : ` · ${stepName}`}
    </span>
  );

  return (
    <div ref={rootRef} className={cn('flex flex-col', className)}>
      <PageHeader
        title={title ?? stepName}
        eyebrow={stepIndicator}
        {...(description === undefined ? {} : { description })}
      />

      <div>{children}</div>

      <div
        className={cn(
          'mt-[var(--spacing-section)] flex flex-wrap items-center justify-between',
          'gap-[var(--spacing-inline)] border-t border-border pt-[var(--spacing-gutter)]',
        )}
      >
        <div>
          {previousStep ? (
            <Button variant="secondary" onClick={goBack}>
              {labels.back}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-[var(--spacing-inline)]">
          {footer}
          {nextStep && !hideNext ? (
            <Button variant="primary" pending={advancing} onClick={goNext}>
              {nextLabel ?? labels.next}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={confirmBack} onOpenChange={setConfirmBack} destructive>
        <DialogTitle>{labels.destructiveBackTitle}</DialogTitle>
        <DialogBody>{destructiveBack}</DialogBody>
        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setConfirmBack(false)}>
              {labels.destructiveBackRetreat}
            </Button>
          }
          confirm={
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmBack(false);
                if (previousStep) onNavigate(previousStep.id);
              }}
            >
              {labels.destructiveBackConfirm}
            </Button>
          }
        />
      </Dialog>
    </div>
  );
}
