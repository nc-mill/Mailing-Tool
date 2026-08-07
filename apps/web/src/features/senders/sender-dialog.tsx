'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { passwordManagerOptOut } from '@mlain/ui/lib/password-manager';
import { Alert } from '@mlain/ui/patterns/states';
import { Select, SelectItem } from '@mlain/ui/components/select';
import type { SenderActionResult, SenderIdentityBody } from './actions';
import type { SenderIdentityView } from './senders-screen';

export type SenderDomainOption = {
  id: string;
  domain: string;
  provider_id: string;
  provider_name: string;
  verified: boolean;
};

/**
 * Doménová část adresy. Kontrola v prohlížeči je POHODLÍ, ne ochrana: poslední
 * slovo má `checkSenderIdentity` v jádru a pod ním cizí klíč v databázi. Smysl
 * má proto, že uživatel jinak zjistí překlep v doméně až po odeslání formuláře.
 */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf('@');
  if (at <= 0 || at === email.length - 1) return null;
  return email.slice(at + 1).toLowerCase();
}

function belongsTo(email: string, domain: string): boolean {
  const host = domainOf(email);
  if (host === null) return false;
  const root = domain.toLowerCase();
  return host === root || host.endsWith(`.${root}`);
}

type FormState = {
  name: string;
  fromName: string;
  fromEmail: string;
  replyTo: string;
  domainId: string;
  isDefault: boolean;
};

function initialState(
  identity: SenderIdentityView | null,
  domains: SenderDomainOption[],
): FormState {
  if (identity !== null) {
    return {
      name: identity.name,
      fromName: identity.from_name,
      fromEmail: identity.from_email,
      replyTo: identity.reply_to ?? '',
      domainId: identity.sender_domain_id,
      isDefault: identity.is_default,
    };
  }
  return {
    name: '',
    fromName: '',
    fromEmail: '',
    replyTo: '',
    // Ověřená doména má přednost: z neověřené se stejně neodešle a nabídnout ji
    // jako první by znamenalo poslat uživatele nejkratší cestou do spamu.
    domainId: (domains.find((d) => d.verified) ?? domains[0])?.id ?? '',
    isDefault: false,
  };
}

/**
 * Dialog na založení i úpravu předvolby odesílatele.
 *
 * ODESÍLACÍ ÚČET SE NEVYBÍRÁ, a je to úmysl. Doména v našem nástroji vždycky
 * patří právě jednomu účtu (`sender_domains.provider_id`), takže výběrem domény
 * je účet určený. Kdyby tu byly dva rozbalovací seznamy, uměl by uživatel
 * sestavit dvojici, kterou server odmítne, a nedozvěděl by se proč. Účet se
 * proto jen ukazuje vedle vybrané domény.
 */
export function SenderDialog({
  open,
  onOpenChange,
  identity,
  domains,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `null` znamená zakládání. */
  identity: SenderIdentityView | null;
  domains: SenderDomainOption[];
  onSubmit: (body: SenderIdentityBody) => Promise<SenderActionResult>;
}) {
  const t = useTranslations('campaigns.senders.dialog');
  const [form, setForm] = useState<FormState>(() => initialState(identity, domains));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /*
   * Dialog zůstává namountovaný i zavřený, takže by druhé otevření ukázalo
   * hodnoty z prvního. Stav se proto sype při každém otevření a při každé
   * změně upravované předvolby.
   */
  useEffect(() => {
    if (!open) return;
    setForm(initialState(identity, domains));
    setErrors({});
    setFailure(null);
    // `domains` se do závislostí NEDÁVÁ: je to nové pole při každém renderu
    // rodiče, takže by se stav sypal i uprostřed vyplňování. Čte se tedy
    // z uzávěru posledního renderu, což je přesně to, co tu chceme.
  }, [open, identity]);

  const domain = useMemo(
    () => domains.find((d) => d.id === form.domainId) ?? null,
    [domains, form.domainId],
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key === 'fromEmail' ? 'from_email' : key === 'name' ? 'name' : String(key)];
      return next;
    });
  }

  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    if (form.name.trim() === '') found['name'] = t('required');
    if (form.fromName.trim() === '') found['from_name'] = t('required');
    if (form.fromEmail.trim() === '') found['from_email'] = t('required');
    else if (domainOf(form.fromEmail.trim()) === null) found['from_email'] = t('invalidEmail');
    else if (domain !== null && !belongsTo(form.fromEmail.trim(), domain.domain)) {
      found['from_email'] = t('outsideDomain', { domain: domain.domain });
    }
    if (form.replyTo.trim() !== '' && domainOf(form.replyTo.trim()) === null) {
      found['reply_to'] = t('invalidEmail');
    }
    if (form.domainId === '') found['sender_domain_id'] = t('required');
    return found;
  }

  async function submit() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0 || domain === null) return;

    setFailure(null);
    setPending(true);
    try {
      const result = await onSubmit({
        name: form.name.trim(),
        from_name: form.fromName.trim(),
        from_email: form.fromEmail.trim().toLowerCase(),
        reply_to: form.replyTo.trim() === '' ? null : form.replyTo.trim().toLowerCase(),
        provider_id: domain.provider_id,
        sender_domain_id: domain.id,
        is_default: form.isDefault,
      });
      if (result.status === 'error') {
        if (Object.keys(result.fieldErrors).length > 0) setErrors(result.fieldErrors);
        // Neznámý kód spadne na `detail` ze serveru, nikdy na prázdno.
        else setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  const noDomains = domains.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{identity === null ? t('createTitle') : t('editTitle')}</DialogTitle>
      <DialogBody>
        <p className="text-text-muted">{t('explanation')}</p>

        {/* Roluje se JEN obsah, ne celý dialog: totéž jako u nové domény. */}
        <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto pr-1">
          {noDomains ? (
            <Alert tone="warning" data-testid="sender-no-domains">
              {t('noDomains')}
            </Alert>
          ) : (
            <>
              <Field
                label={t('name')}
                hint={t('nameHint')}
                {...(errors['name'] === undefined ? {} : { error: errors['name'] })}
              >
                <Input
                  data-testid="sender-name"
                  autoComplete="off"
                  placeholder={t('namePlaceholder')}
                  value={form.name}
                  onChange={(event) => set('name', event.target.value)}
                />
              </Field>

              <div data-testid="sender-domain-select">
                <span aria-hidden className="mb-1 block text-sm font-medium text-text">
                  {t('domain')}
                </span>
                <Select
                  {...(form.domainId === '' ? {} : { value: form.domainId })}
                  onValueChange={(next) => set('domainId', next)}
                  placeholder={t('domainPlaceholder')}
                  aria-label={t('domain')}
                >
                  {domains.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {`${d.domain} (${d.provider_name})`}
                    </SelectItem>
                  ))}
                </Select>
                <p className="mt-1 text-sm text-text-muted">{t('domainHint')}</p>
                {domain !== null && !domain.verified && (
                  <Alert tone="warning" data-testid="sender-domain-unverified">
                    {t('domainUnverified')}
                  </Alert>
                )}
              </div>

              <Field
                label={t('fromName')}
                hint={t('fromNameHint')}
                {...(errors['from_name'] === undefined ? {} : { error: errors['from_name'] })}
              >
                <Input
                  data-testid="sender-from-name"
                  autoComplete="off"
                  value={form.fromName}
                  onChange={(event) => set('fromName', event.target.value)}
                />
              </Field>

              <Field
                label={t('fromEmail')}
                hint={
                  domain === null
                    ? t('fromEmailHint')
                    : t('fromEmailHintDomain', { domain: domain.domain })
                }
                {...(errors['from_email'] === undefined ? {} : { error: errors['from_email'] })}
              >
                {/* Adresa ODESÍLATELE, ne přihlašovací. Samotné `autoComplete="off"`
                    správci hesel ignorují, značky níž ne. Podrobnosti
                    v `@mlain/ui/lib/password-manager`. */}
                <Input
                  data-testid="sender-from-email"
                  type="email"
                  autoComplete="off"
                  {...passwordManagerOptOut}
                  value={form.fromEmail}
                  onChange={(event) => set('fromEmail', event.target.value)}
                />
              </Field>

              <Field
                label={t('replyTo')}
                hint={t('replyToHint')}
                optionalLabel={t('optional')}
                {...(errors['reply_to'] === undefined ? {} : { error: errors['reply_to'] })}
              >
                <Input
                  data-testid="sender-reply-to"
                  type="email"
                  autoComplete="off"
                  {...passwordManagerOptOut}
                  value={form.replyTo}
                  onChange={(event) => set('replyTo', event.target.value)}
                />
              </Field>

              <label className="flex items-start gap-2 text-sm text-text">
                <Checkbox
                  data-testid="sender-is-default"
                  checked={form.isDefault}
                  onCheckedChange={(next) => set('isDefault', next === true)}
                />
                <span>
                  {t('isDefault')}
                  <span className="block text-text-muted">{t('isDefaultHint')}</span>
                </span>
              </label>
            </>
          )}
        </div>

        {/* Chyba stojí MIMO rolovací oblast, aby ji uživatel viděl i odrolovaný dole. */}
        {failure !== null && (
          <Alert tone="error" data-testid="sender-dialog-error">
            {failure}
          </Alert>
        )}
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="primary"
            data-testid="sender-submit"
            // Primární tlačítko `disabled` nepřijímá (princip P5): zůstane
            // klikatelné a řekne důvod, proč to teď nejde.
            {...(noDomains ? { unavailableReason: t('submitUnavailable') } : {})}
            pending={pending}
            pendingLabel={t('submitting')}
            onClick={() => void submit()}
          >
            {t('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
