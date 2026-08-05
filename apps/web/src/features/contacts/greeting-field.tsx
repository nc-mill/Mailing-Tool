'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@mlain/i18n/navigation';
import { localeLabel } from '@/lib/i18n/locale-label';
import { Button } from '@mlain/ui/components/button';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { useToast } from '@mlain/ui/patterns/toast';
import { GreetingBadge } from './greeting-badge';
import { clearGreetingAction, setGreetingAction } from './greeting-actions';
import { describeGreetingStatus, vocativeForm, type GreetingStatusInput } from './greeting-status';

/**
 * RUČNÍ ÚPRAVA TVARU OSLOVENÍ.
 *
 * Samostatná komponenta, ne pole v editačním formuláři. Důvod je věcný, ne
 * organizační: formulář posílá celý stav obrazovky v režimu `overwrite`, takže
 * chybějící hodnota u něj znamená „vymazat". Ruční tvar oslovení musí přežít
 * i uložení formuláře, který o něm neví, jinak by zámek `vocative_locked`
 * neznamenal nic. Proto má vlastní úzký endpoint a vlastní serverovou akci.
 *
 * CO SE ULOŽENÍM STANE. Tvar se zapíše do `first_name_vocative`, jistota se
 * nastaví na `high`, oslovení se přepočítá a kontakt se ZAMKNE. Od té chvíle ho
 * import ani přepočet nastavení nepřepíšou, dokud se nezmění jméno; to hlídá
 * `shouldReleaseVocativeLock`.
 *
 * PRÁZDNÉ POLE NENÍ CHYBA. Znamená „neoslovovat jménem", tedy neutrální
 * „Dobrý den". Věta „Dobrý den, " s visící čárkou z toho vzniknout nemůže:
 * skládá ji `buildGreeting`, které prázdnou hodnotu bere jako chybějící jméno.
 */
export function GreetingField({
  workspaceId,
  contactId,
  contact,
  reviewHref,
  workspaceLocale,
  localeSettingsHref,
}: {
  workspaceId: string;
  contactId: string;
  contact: GreetingStatusInput;
  /** Odkaz na frontu „Kontrola oslovení". Bez něj se nabídka fronty nezobrazí. */
  reviewHref?: string | undefined;
  /**
   * Jazyk projektu. Slouží JEN k porovnání s jazykem kontaktu: oslovení se skládá
   * jazykem KONTAKTU, takže rozdíl je vysvětlení věty, které uživatel na obrazovce
   * nerozumí („proč mi tam píše Hello Petře, když mám projekt česky").
   */
  workspaceLocale?: string | undefined;
  /** Kam vede hromadná oprava jazyka. Bez něj se nabídne jen vysvětlení. */
  localeSettingsHref?: string | undefined;
}) {
  const t = useTranslations('contacts');
  const uiLocale = useLocale();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(vocativeForm(contact) ?? '');

  const status = describeGreetingStatus(contact);

  function run(action: () => Promise<{ status: 'success' } | { status: 'error'; code: string }>) {
    startTransition(async () => {
      const result = await action();
      if (result.status === 'success') {
        toast.success(t('greeting.saved'));
        setOpen(false);
        router.refresh();
        return;
      }
      toast.error(t('greeting.failed', { code: result.code }));
    });
  }

  return (
    <section data-testid="greeting-field" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-text">{contact.greeting}</span>
        <GreetingBadge contact={contact} showForm={false} />
        <Button variant="secondary" onClick={() => setOpen((previous) => !previous)}>
          {open ? t('greeting.cancel') : t('greeting.edit')}
        </Button>
        {contact.vocative_locked ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => clearGreetingAction({ workspaceId, id: contactId }))}
          >
            {t('greeting.release')}
          </Button>
        ) : null}
      </div>

      {/* `locale` se předává vždycky, viz komentář v `greeting-badge.tsx`. */}
      <p className="text-sm text-text-muted">{t(status.hintKey, { locale: contact.locale })}</p>

      {/* ROZEŠLÝ JAZYK. Odznak `Bez 5. pádu` tenhle stav ukazoval jen u kontaktu bez
          zámku: jakmile někdo tvar ručně potvrdil, přebil ho stav `Potvrzeno` a jediné,
          co uživatel viděl, byla nesourodá věta „Hello Petře" bez vysvětlení. Rozdíl
          jazyků se proto hlásí SAMOSTATNĚ, nezávisle na odznaku, a nabízí hromadnou
          opravu: po jednom kontaktu se tisíc lidí opravit nedá. */}
      {workspaceLocale !== undefined && workspaceLocale !== contact.locale ? (
        <p className="text-sm text-warning-text" data-testid="greeting-locale-mismatch">
          {t('greeting.localeMismatch', {
            contactLocale: localeLabel(contact.locale, uiLocale),
            // Klíč se jmenuje `projectLocale`, ne `workspaceLocale`: v českých textech
            // se slovo „workspace" nesmí objevit ani jako název parametru (slovník 9.2)
            // a kontrolu katalogů to hlídá.
            projectLocale: localeLabel(workspaceLocale, uiLocale),
          })}{' '}
          {localeSettingsHref === undefined ? null : (
            <a href={localeSettingsHref} className="underline">
              {t('greeting.localeMismatchAction')}
            </a>
          )}
        </p>
      ) : null}

      {/* Odkaz na frontu je tady schválně u nejistých stavů: právě kvůli nim
          obrazovka „Kontrola oslovení" existuje, a do téhle chvíle na ni z detailu
          kontaktu nevedla žádná cesta. */}
      {status.needsReview && reviewHref !== undefined ? (
        <a href={reviewHref} className="text-sm underline">
          {t('greeting.openReview')}
        </a>
      ) : null}

      {open ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface p-4">
          <Label htmlFor="greeting-vocative">{t('greeting.fieldLabel')}</Label>
          <Input
            id="greeting-vocative"
            name="greeting_vocative"
            value={value}
            autoComplete="off"
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="text-sm text-text-muted">{t('greeting.fieldHint')}</p>
          <p className="text-sm text-text-muted">{t('greeting.emptyHint')}</p>
          <div className="flex flex-wrap gap-2">
            {/* Primární tlačítko `disabled` nepřijímá (princip P5, kritérium 18),
                stav běhu se hlásí přes `pending` a `pendingLabel`. */}
            <Button
              variant="primary"
              pending={pending}
              pendingLabel={t('greeting.saving')}
              onClick={() =>
                run(() =>
                  setGreetingAction({ workspaceId, id: contactId, firstNameVocative: value }),
                )
              }
            >
              {t('greeting.save')}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={() => setOpen(false)}>
              {t('greeting.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
