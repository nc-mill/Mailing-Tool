'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../components/dialog';
import { Field } from '../../components/field';
import { Input } from '../../components/input';
import type { RiskLevel } from './risk-level';

export type ConfirmDialogLabels = {
  irreversible: string;
  whatHappens: string;
  notYetConfirmed: string;
  notYetTyped: string;
  typeToConfirmMismatch: string;
  filterInWords: (filter: string) => string;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  level,
  title,
  consequences,
  confirmLabel,
  cancelLabel,
  note,
  acknowledgement,
  confirmPhrase,
  confirmPhraseLabel,
  onConfirmPhraseChange,
  filterDescription,
  exportAction,
  extraAction,
  softerAlternative,
  destructive,
  irreversible = true,
  onConfirm,
  onCancel,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** N1 dialog nemá. Vratná akce se provede rovnou a nabídne se Vrátit zpět (6.7). */
  level: RiskLevel;
  title: string;
  /** Konkrétní následky, nikdy obecná věta „Akce bude provedena". */
  consequences: string[];
  confirmLabel: string;
  cancelLabel: string;
  /**
   * Povinná poznámka k akci, kterou server zapíše do auditu. Když ji volající zadá,
   * potvrzení s prázdným polem neprojde: záznam „kdo a kdy" bez „proč" nikomu,
   * kdo bude akci později dohledávat, nepomůže.
   */
  note?:
    | {
        label: string;
        hint?: string | undefined;
        value: string;
        onChange: (value: string) => void;
        /** Věta pod tlačítkem, dokud je pole prázdné. Tlačítko se nezašeďuje. */
        missingReason: string;
      }
    | undefined;
  /** Povinné u N3. Věta popisuje následek, ne souhlas. */
  acknowledgement?: string | undefined;
  /** Povinné u N4: text, který uživatel opíše, například název projektu. */
  confirmPhrase?: string | undefined;
  confirmPhraseLabel?: string | undefined;
  /** Když je zadaný, opisované pole řídí volající. Jinak si ho drží dialog. */
  onConfirmPhraseChange?: (value: string) => void;
  /** U hromadné akce nad výběrem podle filtru se filtr zopakuje slovy (6.5). */
  filterDescription?: string;
  /** Nabídka exportu je silnější ochrana než opisování textu. */
  exportAction?: { label: string; onExport: () => void };
  /** Jedno volitelné tlačítko vedle ústupu, například nabídka jiné cesty. */
  extraAction?: React.ReactNode;
  /** Většina lidí, kteří sáhnou po zrušení, ve skutečnosti chtějí pauzu (6.4). */
  softerAlternative?: { question: string; label: string; onChoose: () => void };
  /**
   * Ztratí se po potvrzení data, nebo něco odejde ven? Řídí barvu potvrzovacího
   * tlačítka a to, jestli jde dialog zavřít kliknutím mimo (5.3).
   *
   * ČERVENÁ NENÍ SYNONYMUM PRO „POTVRZOVACÍ DIALOG". Úroveň `level` říká, kolik
   * tření akce dostane (okno, zaškrtávátko, opisování), tenhle příznak říká,
   * jak akce dopadne. Jsou to dvě různé věci: „Archivovat seznam" i „Odeslat
   * kampaň" jsou N2, ale první nic neztratí a druhá je nevratná.
   *
   * Napiš `true` jen tehdy, když platí aspoň jedno podle os z 6.1:
   * - obnovitelnost 2: po potvrzení něco z projektu zmizí a rozhraní ani API
   *   to nevrátí (smazání kontaktu, pole, štítku, klíče, projektu, přepsání
   *   rozepsaného obsahu),
   * - vnější dopad 2: akce odejde ven ke koncovým lidem nebo pustí ven poštu,
   *   která byla zablokovaná (odeslání kampaně, odebrání adresy z blokovaných,
   *   rotace klíče k API).
   *
   * Archivace, přepínání stavu, změna nastavení, odebrání přístupu a zakládání
   * dat mají `false`, i když se na ně uživatel ptá dialogem. Kdyby svítilo
   * červeně všechno, přestane červená znamenat cokoli a odklikne se i mazání.
   *
   * Prop je povinný schválně: výchozí hodnota by se dala přehlédnout a přesně
   * tak vznikl stav, kdy „Archivovat pole" vypadalo jako mazání.
   */
  destructive: boolean;
  irreversible?: boolean;
  /** Smí být asynchronní: obrazovky uvnitř volají API. */
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  labels: ConfirmDialogLabels;
}) {
  if (level === 'N1') {
    throw new Error(
      'Potvrzovací dialog u vratné akce (N1) je zakázaný, viz 6.7. Proveď akci rovnou a nabídni Vrátit zpět.',
    );
  }

  const [checked, setChecked] = useState(false);
  const [ownTyped, setOwnTyped] = useState('');
  const checkboxId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);

  const controlledPhrase = onConfirmPhraseChange !== undefined;
  const typed = controlledPhrase ? (confirmPhrase ?? '') : ownTyped;

  const noteFilled = note === undefined || note.value.trim() !== '';
  const needsCheckbox = level === 'N3' && Boolean(acknowledgement);
  const needsTyping = level === 'N4' && Boolean(confirmPhrase);
  const typingMatches = needsTyping ? typed.trim() === confirmPhrase : true;

  // Výchozí fokus patří na ústup, ne na destruktivní tlačítko (9.4).
  // Kdo dialog odklikne poslepu, nesmí tím smazat projekt.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function unavailableReason(): string | undefined {
    if (note !== undefined && !noteFilled) return note.missingReason;
    if (needsCheckbox && !checked) return labels.notYetConfirmed;
    if (needsTyping && !typingMatches) return labels.notYetTyped;
    return undefined;
  }

  const reason = unavailableReason();

  function handleConfirm() {
    // Tlačítko není disabled (kritérium 18). Když akce nejde provést,
    // `unavailableReason()` už vysvětlení vypisuje pod tlačítkem samo,
    // tady se jen přesune fokus na chybějící krok (rozhodnutí R7).
    if (!noteFilled) {
      noteRef.current?.focus();
      return;
    }
    if (needsCheckbox && !checked) {
      document.getElementById(checkboxId)?.focus();
      return;
    }
    if (needsTyping && !typingMatches) {
      return;
    }
    void onConfirm();
  }

  function handleCancel() {
    onCancel?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} destructive={destructive}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        <p className="font-medium">{labels.whatHappens}</p>
        <ul className="list-disc pl-5">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {filterDescription ? (
          <p className="text-text-muted">{labels.filterInWords(filterDescription)}</p>
        ) : null}

        {irreversible ? <p className="font-medium">{labels.irreversible}</p> : null}

        {exportAction ? (
          <Button variant="secondary" onClick={exportAction.onExport}>
            {exportAction.label}
          </Button>
        ) : null}

        {softerAlternative ? (
          <div className="rounded-[var(--radius-control)] bg-surface-muted p-3">
            <p>{softerAlternative.question}</p>
            <Button variant="secondary" className="mt-2" onClick={softerAlternative.onChoose}>
              {softerAlternative.label}
            </Button>
          </div>
        ) : null}

        {note ? (
          <Field label={note.label} {...(note.hint === undefined ? {} : { hint: note.hint })}>
            <Input
              ref={noteRef}
              value={note.value}
              onChange={(event) => note.onChange(event.target.value)}
            />
          </Field>
        ) : null}

        {needsCheckbox ? (
          <label className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(next) => setChecked(next === true)}
            />
            <span>{acknowledgement}</span>
          </label>
        ) : null}

        {needsTyping ? (
          <Field
            label={confirmPhraseLabel ?? ''}
            {...(typed !== '' && !typingMatches ? { error: labels.typeToConfirmMismatch } : {})}
          >
            <Input
              value={typed}
              onChange={(event) => {
                if (controlledPhrase) onConfirmPhraseChange?.(event.target.value);
                else setOwnTyped(event.target.value);
              }}
            />
          </Field>
        ) : null}
      </DialogBody>

      <DialogFooter
        retreat={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={handleCancel}>
              {cancelLabel}
            </Button>
            {extraAction}
          </>
        }
        confirm={
          <Button
            // Barva je vyhrazená akcím, po kterých se něco ztratí nebo odejde
            // ven. Nedestruktivní potvrzení nese barvu primární akce, jinak by
            // červená v aplikaci nic nerozlišovala.
            variant={destructive ? 'destructive' : 'primary'}
            {...(reason ? { unavailableReason: reason, onUnavailable: handleConfirm } : {})}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        }
      />
    </Dialog>
  );
}
