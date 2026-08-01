'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../components/dialog';

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
 */
export function Wizard({
  steps,
  current,
  onNavigate,
  labels,
  children,
  destructiveBack,
  nextLabel,
  footer,
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
  /** Poslední krok nese název konkrétní akce, ne slovo „Dokončit" (9.3). */
  nextLabel?: string;
  footer?: React.ReactNode;
}) {
  const index = steps.findIndex((step) => step.id === current);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);

  // Po přechodu kroku patří fokus na nadpis kroku, jinak zůstane
  // na tlačítku, které už neexistuje, a uživatel neví, kde je.
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  const previousStep = index > 0 ? steps[index - 1] : undefined;
  const nextStep = index >= 0 && index < steps.length - 1 ? steps[index + 1] : undefined;

  function goBack() {
    if (!previousStep) return;
    if (destructiveBack !== undefined) {
      setConfirmBack(true);
      return;
    }
    onNavigate(previousStep.id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite" className="text-sm text-text-muted">
        {labels.stepOf(index + 1, steps.length)}
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-text">
        {steps[index]?.label}
      </h1>

      <div>{children}</div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {previousStep ? (
            <Button variant="secondary" onClick={goBack}>
              {labels.back}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {footer}
          {nextStep ? (
            <Button variant="primary" onClick={() => onNavigate(nextStep.id)}>
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
