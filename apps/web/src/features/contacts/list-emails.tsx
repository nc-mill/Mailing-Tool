'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Switch } from '@mlain/ui/components/switch';
import {
  createListEmailTemplateAction,
  detachListEmailTemplateAction,
  setListEmailEnabledAction,
} from './list-email-actions';

/**
 * Tři e-maily seznamu na jedné obrazovce: potvrzení přihlášení, uvítání,
 * rozloučení.
 *
 * DVĚ VOLBY U KAŽDÉHO, ne pole s předmětem a textem. Buď „obecné znění", tedy
 * vestavěný text, který se zlepšuje nasazením a nemá u sebe žádnou kopii
 * v databázi, nebo „vlastní e-mail", což je jedno tlačítko: založí šablonu
 * PŘEDVYPLNĚNOU obecným zněním, připojí ji a otevře editor. Rozhodnutí
 * zadavatele z 5. 8. 2026, stejný vzorec jako u e-mailu formuláře.
 *
 * POTVRZOVACÍ E-MAIL NEMÁ VYPÍNAČ a je to schválně: na seznamu s dvojím
 * potvrzením je to jediná cesta, jak přihlášení dokončit. Kdo ho posílat
 * nechce, přepne seznam na jeden krok, což je o kus výš na téže obrazovce.
 */

export type ListEmailKind = 'confirmation' | 'welcome' | 'goodbye';

export type ListEmailState = {
  kind: ListEmailKind;
  /** `null` znamená obecné znění, ne chybějící e-mail. */
  templateId: string | null;
  templateName: string | null;
  /** Jen u uvítání a rozloučení. Potvrzení se vypnout nedá. */
  enabled: boolean;
  /**
   * Jen u potvrzení: má připojená šablona odkaz na potvrzení? Počítá se na
   * serveru týmž pravidlem, které brání jejímu připojení, protože šablonu jde
   * upravit i potom, co se připojila.
   */
  hasConfirmLink: boolean;
};

export function ListEmails({
  workspaceId,
  listId,
  listName,
  language,
  templatesPath,
  emails,
}: {
  workspaceId: string;
  listId: string;
  listName: string;
  language: 'cs' | 'en';
  templatesPath: string;
  emails: ListEmailState[];
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [working, setWorking] = useState<ListEmailKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Hláška ze serveru má přednost před obecnou.
   *
   * Závory seznamu (potvrzovací e-mail bez odkazu, odhlašovací odkaz v uvítacím)
   * vracejí 422 s větou, která rovnou říká, co s tím. Přebít ji obecným
   * „nepodařilo se" by z konkrétní opravitelné chyby udělalo záhadu.
   */
  const failureText = (detail: string): string =>
    detail.trim() === '' ? t('lists.emailCreateFailed') : detail;

  async function createCustom(kind: ListEmailKind) {
    setWorking(kind);
    setError(null);
    const result = await createListEmailTemplateAction({
      workspaceId,
      listId,
      listName,
      kind,
      language,
    });
    setWorking(null);
    if (result.status === 'error') {
      setError(failureText(result.detail));
      return;
    }
    // Rovnou do editoru. Uživatel klikl „napsat vlastní", ne „založit šablonu".
    if (result.templateId !== undefined) router.push(`${templatesPath}/${result.templateId}`);
  }

  async function detach(kind: ListEmailKind) {
    setWorking(kind);
    setError(null);
    const result = await detachListEmailTemplateAction({ workspaceId, listId, kind });
    setWorking(null);
    if (result.status === 'error') {
      setError(failureText(result.detail));
      return;
    }
    router.refresh();
  }

  async function toggle(kind: 'welcome' | 'goodbye', enabled: boolean) {
    setError(null);
    const result = await setListEmailEnabledAction({ workspaceId, listId, kind, enabled });
    if (result.status === 'error') {
      setError(failureText(result.detail));
      return;
    }
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-6" data-testid="list-emails">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold text-text">{t('lists.emailsTitle')}</h2>
        <p className="text-sm text-text-muted">{t('lists.emailsLead')}</p>
      </div>

      {error === null ? null : (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}

      {emails.map((email) => (
        <div
          key={email.kind}
          className="flex flex-col gap-2 rounded-md border border-border p-3"
          data-testid={`list-email-${email.kind}`}
        >
          <h3 className="font-medium text-text">{t(`lists.email_${email.kind}`)}</h3>
          <p className="text-sm text-text-muted">{t(`lists.email_${email.kind}_hint`)}</p>

          {email.kind === 'confirmation' ? null : (
            <div className="flex items-start gap-3">
              <Switch
                id={`list-email-enabled-${email.kind}`}
                checked={email.enabled}
                data-testid={`list-email-enabled-${email.kind}`}
                onCheckedChange={(next: boolean) => {
                  void toggle(email.kind as 'welcome' | 'goodbye', next);
                }}
              />
              <label
                htmlFor={`list-email-enabled-${email.kind}`}
                className="text-sm font-medium text-text"
              >
                {email.enabled ? t('lists.emailEnabledOn') : t('lists.emailEnabledOff')}
              </label>
            </div>
          )}

          {email.templateId === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-text">{t('lists.emailDefaultWording')}</span>
              <Button
                variant="secondary"
                data-testid={`list-email-create-${email.kind}`}
                onClick={() => {
                  if (working === null) void createCustom(email.kind);
                }}
              >
                {working === email.kind ? t('lists.emailWorking') : t('lists.emailWriteCustom')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Link href={`${templatesPath}/${email.templateId}`}>
                {email.templateName ?? t('lists.emailCustomWording')}
              </Link>
              <Button
                variant="secondary"
                data-testid={`list-email-detach-${email.kind}`}
                onClick={() => {
                  if (working === null) void detach(email.kind);
                }}
              >
                {working === email.kind ? t('lists.emailWorking') : t('lists.emailUseDefault')}
              </Button>
            </div>
          )}

          {/* Varování, ne zákaz. Připojit šablonu bez odkazu API nedovolí, ale
              upravit už připojenou ano, a tehdy se to uživatel musí dozvědět
              dřív, než se lidem přestane dařit potvrdit přihlášení. Odeslání
              takového e-mailu se stejně zastaví. */}
          {email.kind === 'confirmation' && email.templateId !== null && !email.hasConfirmLink ? (
            <p role="alert" className="text-sm text-danger-text" data-testid="list-email-no-link">
              {t('lists.emailMissingConfirmLink')}
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}
