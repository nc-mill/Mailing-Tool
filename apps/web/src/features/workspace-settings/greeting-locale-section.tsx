'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { ConfirmDialog } from '@mlain/ui/patterns/feedback';
import { Button } from '@mlain/ui/components/button';
import { useConfirmDialogLabels } from '@/lib/feedback/confirm-labels';
import { IDLE, type ActionState } from '@/lib/feedback/action-result';
import { SettingsProblem } from '@/features/settings/settings-problem';
import { localeLabel } from '@/lib/i18n/locale-label';
import { alignGreetingLocaleAction } from './actions';

export type GreetingLocaleSummary = {
  workspace_locale: string;
  total: number;
  mismatched: number;
  by_locale: { locale: string; count: number }[];
};

export type GreetingLocaleSectionProps = {
  workspaceId: string;
  canWrite: boolean;
  summary: GreetingLocaleSummary;
  action: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  initialState?: ActionState | undefined;
};

/**
 * HROMADNÁ OPRAVA JAZYKA OSLOVENÍ.
 *
 * PROČ TAHLE SEKCE EXISTUJE. Oslovení se skládá podle jazyka KONTAKTU, ne projektu:
 * v jednom projektu můžou být Češi i cizinci a 5. pád dává jen čeština a slovenština.
 * Kontakt ale svůj jazyk skoro nikdy nedostal od člověka, zdědil ho od projektu při
 * vzniku. Projekt založený anglickým průvodcem tak měl všechny kontakty v `en`
 * a po přepnutí na češtinu se jim oslovení nepřepočítalo, protože změna nastavení
 * sama do žádného kontaktu nesahá. Uživateli zbývalo otevřít kontakt, uložit tvar
 * ručně a to celé opakovat, což je nad stovkou kontaktů neproveditelné.
 *
 * CO TLAČÍTKO UDĚLÁ. Kontaktům s jiným jazykem nastaví jazyk projektu, přepočítá
 * jim 5. pád a složí oslovení znovu. Ručně potvrzené tvary zůstanou; přepočítá se
 * z nich jen věta, takže z „Hello Petře" vznikne „Dobrý den, Petře".
 *
 * CO NEUDĚLÁ. Jazyk projektu nemění (na to je pole výš) a kontakt, který jazyk
 * projektu má, nechává být.
 */
export function GreetingLocaleSectionView({
  workspaceId,
  canWrite,
  summary,
  action,
  initialState,
}: GreetingLocaleSectionProps) {
  const t = useTranslations('settings');
  const uiLocale = useLocale();
  const confirmLabels = useConfirmDialogLabels();
  const [state, setState] = useState<ActionState>(initialState ?? IDLE);
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const target = localeLabel(summary.workspace_locale, uiLocale);
  const others = summary.by_locale.filter((row) => row.locale !== summary.workspace_locale);

  function submit() {
    setOpen(false);
    setState(IDLE);
    startTransition(async () => {
      const formData = new FormData();
      formData.set('workspace_id', workspaceId);
      setState(await action(IDLE, formData));
    });
  }

  return (
    <section aria-labelledby="general-greeting-locale">
      <h2 id="general-greeting-locale" className="text-xl font-semibold">
        {t('general.greetingLocale.label')}
      </h2>
      <p className="mt-2 text-text-muted">{t('general.greetingLocale.hint', { target })}</p>

      {state.status === 'success' ? (
        <p role="status" className="mt-4 text-text-muted">
          {t(state.messageKey)}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <div className="mt-4">
          <SettingsProblem problem={state.problem} />
        </div>
      ) : null}

      {summary.mismatched === 0 ? (
        <p className="mt-4 text-text-muted" data-testid="greeting-locale-aligned">
          {t('general.greetingLocale.allAligned', { target, count: summary.total })}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-warning-text" data-testid="greeting-locale-mismatched">
            {t('general.greetingLocale.mismatched', {
              count: summary.mismatched,
              total: summary.total,
              target,
            })}
          </p>
          {/* Rozpad podle jazyků. Bez něj by uživatel klikal naslepo: „jiný jazyk"
              může být angličtina zděděná z průvodce i slovenština, kterou si někdo
              zvolil sám, a to jsou dvě různá rozhodnutí. */}
          <ul className="text-sm text-text-muted">
            {others.map((row) => (
              <li key={row.locale}>
                {t('general.greetingLocale.perLocale', {
                  locale: localeLabel(row.locale, uiLocale),
                  count: row.count,
                })}
              </li>
            ))}
          </ul>
          {canWrite ? (
            <div>
              <Button variant="secondary" onClick={() => setOpen(true)}>
                {t('general.greetingLocale.action', { target })}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        level="N2"
        title={t('general.greetingLocale.dialogTitle', { target })}
        consequences={[
          t('general.greetingLocale.dialogConsequence1', { count: summary.mismatched, target }),
          t('general.greetingLocale.dialogConsequence2'),
          t('general.greetingLocale.dialogConsequence3'),
        ]}
        confirmLabel={t('general.greetingLocale.dialogConfirm')}
        cancelLabel={t('general.greetingLocale.dialogCancel')}
        // Vratné: jazyk kontaktu jde kdykoliv změnit zpátky a přepočet doběhne znovu.
        irreversible={false}
        onConfirm={submit}
        labels={confirmLabels}
      />
    </section>
  );
}

/** Obálka se serverovou akcí, aby ji stránka nemusela znát. */
export function GreetingLocaleSection(props: Omit<GreetingLocaleSectionProps, 'action'>) {
  return <GreetingLocaleSectionView {...props} action={alignGreetingLocaleAction} />;
}
