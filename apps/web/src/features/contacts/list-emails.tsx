'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Switch } from '@mlain/ui/components/switch';
import { Alert } from '@mlain/ui/patterns/states';
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
 *
 * PROTIMLUV, KTERÝ TU BYL DO 7. 8. 2026. Karta tvrdila „nejde vypnout"
 * i u seznamu s jednoduchým přihlášením („Přihlásit rovnou"), kde se
 * potvrzovací e-mail při běžném přihlášení VŮBEC NEPOSÍLÁ. Uživatel tak četl
 * na jedné obrazovce dvě věty, které si odporují, a nemohl z ní poznat, co se
 * doopravdy stane. Zdrojem pravdy je nastavení `opt_in`, proto ho karta dostává
 * z nadřazené obrazovky a mění se rovnou s přepnutím, bez znovunačtení.
 *
 * NA JEDNODUCHÉM PŘIHLÁŠENÍ SE ALE NEŘÍKÁ „NEPOSÍLÁ SE NIKDY", protože by to
 * byla nepravda. Stavový automat (`lists/state-machine.ts`) pošle potvrzení
 * i na single opt-in seznamu ve dvou případech: vrací se někdo, kdo se dřív
 * odhlásil, a vypršel potvrzovací odkaz. Obojí je ochrana příjemce a vypnout to
 * nejde, takže to karta říká rovnou.
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
  optIn,
  emails,
}: {
  workspaceId: string;
  listId: string;
  listName: string;
  language: 'cs' | 'en';
  templatesPath: string;
  /**
   * Způsob přihlášení do seznamu. Rozhoduje o tom, co karta o potvrzovacím
   * e-mailu tvrdí, viz hlavička souboru. Předává se ŽIVÁ hodnota ze stavu
   * nadřazené obrazovky, ne ta z posledního načtení: přepnutí přepínače o kus
   * výš musí být na kartě vidět hned.
   */
  optIn: 'single' | 'double';
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
    <Card data-testid="list-emails">
      <CardTitle>{t('lists.emailsTitle')}</CardTitle>
      <p className="text-meta text-text-muted">{t('lists.emailsLead')}</p>

      {/* Věta ze serveru, ne obecné „nepodařilo se". Obě závory seznamu
          (potvrzovací e-mail bez odkazu, odhlašovací odkaz v uvítacím) říkají
          rovnou, co s tím, a musí být vidět. */}
      {error === null ? null : <Alert tone="error">{error}</Alert>}

      {emails.map((email) => (
        <Card
          key={email.kind}
          as="div"
          tone="muted"
          padding="sm"
          gap="none"
          className="gap-3"
          data-testid={`list-email-${email.kind}`}
        >
          <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
            <h3 className="text-base font-semibold text-text">{t(`lists.email_${email.kind}`)}</h3>
            {/* Potvrzovací e-mail vypínač nemá a mít nesmí. Odznak říká, co
                se s ním doopravdy děje, aby se vypínač nehledal. Na jednoduchém
                přihlášení je to jiná věta, protože jde o jiný stav: e-mail se
                při běžném přihlášení neposílá. */}
            {email.kind === 'confirmation' ? (
              <Badge tone={optIn === 'single' ? 'neutral' : 'success'} className="ml-auto">
                {optIn === 'single' ? t('lists.emailOnlyOnReturn') : t('lists.emailCannotDisable')}
              </Badge>
            ) : null}
          </div>
          <p className="text-meta text-text-muted">
            {email.kind === 'confirmation' && optIn === 'single'
              ? t('lists.email_confirmation_hint_single')
              : t(`lists.email_${email.kind}_hint`)}
          </p>

          {email.kind === 'confirmation' ? null : (
            <div className="flex items-center gap-3">
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
                className="text-ui font-semibold text-text"
              >
                {email.enabled ? t('lists.emailEnabledOn') : t('lists.emailEnabledOff')}
              </label>
            </div>
          )}

          {email.templateId === null ? (
            <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
              <span className="text-ui text-text">{t('lists.emailDefaultWording')}</span>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                data-testid={`list-email-create-${email.kind}`}
                pending={working === email.kind}
                pendingLabel={t('lists.emailWorking')}
                onClick={() => {
                  if (working === null) void createCustom(email.kind);
                }}
              >
                {t('lists.emailWriteCustom')}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
              <Link href={`${templatesPath}/${email.templateId}`} className="text-ui">
                {email.templateName ?? t('lists.emailCustomWording')}
              </Link>
              <Button
                variant="secondary"
                size="sm"
                className="ml-auto"
                data-testid={`list-email-detach-${email.kind}`}
                pending={working === email.kind}
                pendingLabel={t('lists.emailWorking')}
                onClick={() => {
                  if (working === null) void detach(email.kind);
                }}
              >
                {t('lists.emailUseDefault')}
              </Button>
            </div>
          )}

          {/* Varování, ne zákaz. Připojit šablonu bez odkazu API nedovolí, ale
              upravit už připojenou ano, a tehdy se to uživatel musí dozvědět
              dřív, než se lidem přestane dařit potvrdit přihlášení. Odeslání
              takového e-mailu se stejně zastaví. */}
          {email.kind === 'confirmation' && email.templateId !== null && !email.hasConfirmLink ? (
            <Alert tone="error" data-testid="list-email-no-link">
              {t('lists.emailMissingConfirmLink')}
            </Alert>
          ) : null}
        </Card>
      ))}
    </Card>
  );
}
