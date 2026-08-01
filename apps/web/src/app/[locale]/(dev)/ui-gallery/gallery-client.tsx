'use client';

import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { QueryBuilder } from '@mlain/ui/patterns/query-builder';
import {
  Alert,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
} from '@mlain/ui/patterns/states';
import { ToastProvider, useToast } from '@mlain/ui/patterns/toast';
import { Timeline } from '@mlain/ui/patterns/timeline';
import { Wizard } from '@mlain/ui/patterns/wizard';
import { useState } from 'react';
import { GALLERY_FIXTURES as fixtures } from './fixtures';

/**
 * Jedna stránka se všemi komponentami K1 až K8 a se všemi stavy obrazovek.
 * Testy axe a klávesnice běží proti ní, takže se každá komponenta
 * kontroluje ve světlém i tmavém režimu.
 *
 * Odchylka od plánu: `K5 Toast` potřebuje `ToastProvider` v kontextu
 * a `QueryBuilder` je řízená komponenta, takže obojí drží stav tady,
 * ne ve statických fixtures. Dialog hromadného smazání (test axe
 * a klávesnice v úkolu 32) v ukázkovém kódu plánu chybí, doplněn
 * jako spouštěč `ConfirmDialog`, aby test focus trapu měl co otevřít.
 */
export function GalleryClient() {
  const [step, setStep] = useState('mapping');
  const [segment, setSegment] = useState(fixtures.queryBuilder.value);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <ToastProvider labels={fixtures.toastLabels}>
      <GalleryBody
        step={step}
        setStep={setStep}
        segment={segment}
        setSegment={setSegment}
        deleteOpen={deleteOpen}
        setDeleteOpen={setDeleteOpen}
      />
    </ToastProvider>
  );
}

function GalleryBody({
  step,
  setStep,
  segment,
  setSegment,
  deleteOpen,
  setDeleteOpen,
}: {
  step: string;
  setStep: (value: string) => void;
  segment: typeof fixtures.queryBuilder.value;
  setSegment: (value: typeof fixtures.queryBuilder.value) => void;
  deleteOpen: boolean;
  setDeleteOpen: (open: boolean) => void;
}) {
  const toast = useToast();

  return (
    <div className="flex flex-col gap-12 p-8">
      <section id="section-primitives" aria-labelledby="h-primitives">
        <h2 id="h-primitives">Primitiva</h2>
        <Button variant="primary">Odeslat 1 129 e-mailů</Button>
        <Field label="E-mail" hint="Použijeme ji jako adresu odesílatele.">
          <Input name="email" />
        </Field>
      </section>

      <section id="section-k1" aria-labelledby="h-k1">
        <h2 id="h-k1">K1 Datová tabulka</h2>
        <DataTable {...fixtures.table} />
      </section>

      <section id="section-k2" aria-labelledby="h-k2">
        <h2 id="h-k2">K2 Query builder</h2>
        <QueryBuilder
          fields={fixtures.queryBuilder.fields}
          value={segment}
          onChange={setSegment}
          labels={fixtures.queryBuilder.labels}
        />
      </section>

      <section id="section-k3" aria-labelledby="h-k3">
        <h2 id="h-k3">K3 Průvodce</h2>
        <Wizard {...fixtures.wizard} current={step} onNavigate={setStep}>
          <p>Obsah kroku</p>
        </Wizard>
      </section>

      <section id="section-k4" aria-labelledby="h-k4">
        <h2 id="h-k4">K4 Nahrání souboru</h2>
        <FileUpload {...fixtures.fileUpload} />
      </section>

      <section id="section-k5" aria-labelledby="h-k5">
        <h2 id="h-k5">K5 Toast</h2>
        <Button variant="secondary" onClick={() => toast.info(fixtures.toastMessage)}>
          Ukázat oznámení
        </Button>
      </section>

      <section id="section-k6" aria-labelledby="h-k6">
        <h2 id="h-k6">K6 Náhled e-mailu</h2>
        <EmailPreview {...fixtures.emailPreview} />
      </section>

      <section id="section-k7" aria-labelledby="h-k7">
        <h2 id="h-k7">K7 Grafy</h2>
        {fixtures.chart}
      </section>

      <section id="section-k8" aria-labelledby="h-k8">
        <h2 id="h-k8">K8 Časová osa</h2>
        <Timeline {...fixtures.timeline} />
      </section>

      <section id="section-states" aria-labelledby="h-states">
        <h2 id="h-states">Stavy obrazovek</h2>
        <EmptyState {...fixtures.emptyState} />
        <FilteredEmptyState {...fixtures.filteredEmptyState} />
        <ErrorBlock {...fixtures.errorBlock} />
        <ForbiddenState {...fixtures.forbiddenState} />
        {/* Alert má čtyři tóny a každý musí projít kontrastem v obou režimech. */}
        <Alert tone="info" title="Informace">
          Vysvětlení.
        </Alert>
        <Alert tone="warning" title="Varování">
          Vysvětlení.
        </Alert>
        <Alert tone="error" title="Chyba">
          Vysvětlení.
        </Alert>
        <Alert tone="success" title="Hotovo">
          Vysvětlení.
        </Alert>

        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          Smazat 3 402 kontaktů
        </Button>
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          {...fixtures.confirmDialog}
          onConfirm={() => setDeleteOpen(false)}
        />
      </section>
    </div>
  );
}
