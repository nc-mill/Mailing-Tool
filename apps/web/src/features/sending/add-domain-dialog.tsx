'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Alert } from '@mlain/ui/patterns/states';
import type { CreateDomainResult } from './actions';

/** Doména se v `sender_domains` ukládá do `varchar(255)`, delší vstup nemá smysl posílat. */
const MAX_DOMAIN_LENGTH = 255;

/**
 * Tvar domény po očištění. NENÍ to plná kontrola: rozhoduje `normalizeDomain`
 * v jádru, které stojí na seznamu veřejných přípon (psl) a pozná i to, že
 * `co.uk` sama o sobě není registrovatelná doména. Sem se ten seznam netáhne,
 * protože kontrola v prohlížeči je pohodlí, ne ochrana, stejně jako u brzd
 * doručitelnosti a u odesílacích účtů.
 *
 * Chytá ale nejčastější překlepy laika, a to je tady důležité: jádro hlásí
 * neregistrovatelnou doménu obyčejnou výjimkou, takže by uživatel místo rady
 * dostal obecnou chybu serveru.
 */
const DOMAIN_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;

/**
 * Očista vstupu je opsaná z `normalizeDomain` (`packages/core/src/providers/ses/identity.ts`).
 * Uživatel typicky zkopíruje adresu z prohlížeče i s `https://` a `www.`, a je
 * lepší mu to tiše srovnat než mu vynadat za něco, co server sám opraví.
 */
function cleanDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^[^@]*@/, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

export type DomainProviderOption = { id: string; name: string; is_default: boolean };

/**
 * Dialog pro přidání odesílací domény.
 *
 * Formulář je záměrně krátký, protože skutečná práce začíná až po odeslání:
 * uživatel musí vložit DNS záznamy u správce své domény. Většinu okna proto
 * zabírá vysvětlení, co doména znamená, proč to bez DNS nejde, kde ty záznamy
 * vloží a jak dlouho to trvá. Bez toho zůstane úplný začátečník stát nad
 * tabulkou záznamů a neví, co s ní.
 *
 * Výběr účtu se ukazuje jen tehdy, když je z čeho vybírat. `provider_id` je
 * v API povinné, takže s jediným účtem není co rozhodovat a otázka by jen
 * zdržovala; bez účtu se doména založit nedá vůbec a dialog to řekne rovnou.
 */
export function AddDomainDialog({
  open,
  onOpenChange,
  providers,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: DomainProviderOption[];
  onSubmit: (input: { domain: string; providerId: string }) => Promise<CreateDomainResult>;
}) {
  const t = useTranslations('campaigns.sending.domainDialog');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [providerId, setProviderId] = useState<string>(
    () => (providers.find((p) => p.is_default) ?? providers[0])?.id ?? '',
  );

  const firstProvider = providers[0];

  /** Vrátí text chyby, nebo `null`, když se smí odeslat. */
  function validate(value: string): string | null {
    if (value === '') return t('required');
    if (value.length > MAX_DOMAIN_LENGTH) return t('tooLong', { max: MAX_DOMAIN_LENGTH });
    if (!DOMAIN_PATTERN.test(value)) return t('invalidDomain');
    return null;
  }

  async function submit() {
    const value = cleanDomain(domain);
    const found = validate(value);
    setError(found);
    if (found !== null || providerId === '') return;

    setFailure(null);
    setPending(true);
    try {
      const result = await onSubmit({ domain: value, providerId });
      if (result.status === 'error') {
        // Neznámý kód spadne na `detail` ze serveru, nikdy na prázdno.
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      setDomain('');
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogBody>
        <p className="text-text-muted">{t('explanation')}</p>

        {/* Roluje se JEN obsah, ne celý dialog: totéž jako u nového odesílacího
            účtu, kde zaostření tlačítka ústupu odrolovalo nadpis z dohledu. */}
        <div className="flex max-h-[52vh] flex-col gap-4 overflow-y-auto pr-1">
          {firstProvider === undefined ? (
            <Alert tone="warning" data-testid="add-domain-no-providers">
              {t('noProviders')}
            </Alert>
          ) : (
            <>
              <Field
                label={t('domain')}
                hint={t('domainHint')}
                {...(error === null ? {} : { error })}
              >
                <Input
                  data-testid="domain-name"
                  autoComplete="off"
                  placeholder="kolo-shop.cz"
                  value={domain}
                  onChange={(event) => {
                    setDomain(event.target.value);
                    setError(null);
                  }}
                />
              </Field>

              {providers.length === 1 ? (
                <p className="text-sm text-text-muted" data-testid="domain-provider-single">
                  {t('providerSingle', { name: firstProvider.name })}
                </p>
              ) : (
                <fieldset className="flex flex-col gap-2 border-0 p-0">
                  <legend className="mb-1 text-sm font-medium text-text">
                    {t('providerLabel')}
                  </legend>
                  <RadioGroup
                    value={providerId}
                    onValueChange={setProviderId}
                    aria-label={t('providerLabel')}
                    className="gap-3"
                  >
                    {providers.map((p) => (
                      <div key={p.id} className="flex items-start gap-3">
                        <RadioGroupItem
                          value={p.id}
                          id={`domain-provider-${p.id}`}
                          data-testid={`domain-provider-${p.id}`}
                          // Přístupné jméno nese `aria-label`: `RadioGroupItem`
                          // je Radix tlačítko bez vlastního textu.
                          aria-label={p.name}
                          className="mt-1 shrink-0"
                        />
                        <label
                          htmlFor={`domain-provider-${p.id}`}
                          className="cursor-pointer text-sm text-text"
                        >
                          {p.name}
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                  <p className="text-sm text-text-muted">{t('providerHint')}</p>
                </fieldset>
              )}
            </>
          )}

          {/* Postup stojí NATVRDO, ne v rozbalovací nápovědě. Je to jediná část
              okna, kterou uživatel opravdu potřebuje: formulář má jedno pole,
              ale práce s DNS ho čeká mimo naši aplikaci a nikdo mu ji tam
              nepřipomene. */}
          <div className="flex flex-col gap-2" data-testid="add-domain-next">
            <p className="text-sm font-medium text-text">{t('nextTitle')}</p>
            <ol className="flex list-none flex-col gap-2 p-0">
              {(['nextStep1', 'nextStep2', 'nextStep3'] as const).map((step) => (
                <li key={step} className="text-sm text-text-muted">
                  {t(step)}
                </li>
              ))}
            </ol>
            <p className="text-sm text-text-muted">{t('timingText')}</p>
          </div>
        </div>

        {/* Chyba stojí MIMO rolovací oblast, aby ji uživatel viděl i odrolovaný dole. */}
        {failure !== null && (
          <Alert tone="error" data-testid="add-domain-error">
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
            data-testid="add-domain-submit"
            // Primární tlačítko `disabled` nepřijímá (princip P5): místo zhasnutí
            // zůstane klikatelné a řekne důvod, proč akci teď provést nejde.
            {...(firstProvider === undefined ? { unavailableReason: t('submitUnavailable') } : {})}
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
