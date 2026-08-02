'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import type { CreateProviderInput, CreateProviderResult } from './actions';

/**
 * Porty a šifrování NEJSOU vymyšlené: obojí je opsané ze schématu
 * `packages/core/src/providers/config-schema.ts`, kde `port` je sjednocení
 * čtyř literálů a `encryption` výčet tří hodnot.
 *
 * ODCHYLKA OD KONTRAKTU, vědomá a hlídaná tímhle výběrem: `openapi.json`
 * i routa v `providers.routes.ts` berou u SMTP `port: integer` bez omezení,
 * ale `providerConfigSchema` uvnitř `createProviderFromApi` propustí jen
 * těchhle čtyři. Volný číselník v poli by tedy vyrobil neošetřený pád
 * hluboko v aplikační vrstvě, ne čitelnou chybu. Platí API, a API je tady
 * ta přísnější vrstva pod routou.
 */
const SMTP_PORTS = ['587', '465', '25', '2525'] as const;
const ENCRYPTIONS = ['starttls', 'tls', 'none'] as const;

type Encryption = (typeof ENCRYPTIONS)[number];

/** Klíče katalogu se skládají výčtem, ne šablonou: překlep by jinak našel až uživatel. */
const ENCRYPTION_LABEL_KEY: Record<
  Encryption,
  'encryptionStarttls' | 'encryptionTls' | 'encryptionNone'
> = {
  starttls: 'encryptionStarttls',
  tls: 'encryptionTls',
  none: 'encryptionNone',
};

/** Tvar regionu je ze `sesSchema`: `z.string().regex(/^[a-z]{2}-[a-z]+-\d$/)`. */
const REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d$/;

type FormState = {
  name: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  configurationSetName: string;
  host: string;
  port: string;
  username: string;
  password: string;
  encryption: Encryption;
  isDefault: boolean;
};

const EMPTY: FormState = {
  name: '',
  region: 'eu-central-1',
  accessKeyId: '',
  secretAccessKey: '',
  configurationSetName: '',
  host: '',
  port: '587',
  username: '',
  password: '',
  encryption: 'starttls',
  isDefault: false,
};

/**
 * Dialog pro založení odesílacího účtu.
 *
 * Typ účtu je PŘEPÍNAČ, ne rozbalovací seznam, a je to věcné rozhodnutí:
 * SES a SMTP mají dvě různé sady polí a uživatel má obě možnosti vidět naráz,
 * včetně vysvětlení, čím se liší. Rozbalovací seznam by druhou možnost schoval.
 *
 * Kontroly v prohlížeči zrcadlí `providerConfigSchema` z `packages/core`,
 * ale rozhoduje server: odpověď 422 se vykreslí stejně jako chyba z pole.
 * Kontrola tady je pohodlí, ne ochrana, stejně jako u brzd doručitelnosti.
 */
export function AddProviderDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (provider: CreateProviderInput) => Promise<CreateProviderResult>;
}) {
  const t = useTranslations('campaigns.sending.addDialog');
  const [type, setType] = useState<'ses' | 'smtp'>('ses');
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      if (!(key in prev)) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  /** Vrátí chyby polí. Prázdný objekt znamená, že se smí odeslat. */
  function validate(): Record<string, string> {
    const found: Record<string, string> = {};
    const name = form.name.trim();
    if (name === '') found['name'] = t('required');
    else if (name.length > 120) found['name'] = t('tooLong', { max: 120 });

    if (type === 'ses') {
      if (!REGION_PATTERN.test(form.region.trim())) found['region'] = t('invalidRegion');
      if (form.accessKeyId.trim().length < 16) found['accessKeyId'] = t('tooShort', { min: 16 });
      if (form.secretAccessKey.length < 16) found['secretAccessKey'] = t('tooShort', { min: 16 });
      if (form.configurationSetName.trim().length > 64) {
        found['configurationSetName'] = t('tooLong', { max: 64 });
      }
    } else {
      if (form.host.trim() === '') found['host'] = t('required');
      if (form.username.trim() === '') found['username'] = t('required');
      if (form.password === '') found['password'] = t('required');
    }
    return found;
  }

  function buildInput(): CreateProviderInput {
    if (type === 'ses') {
      const configurationSet = form.configurationSetName.trim();
      return {
        type: 'ses',
        name: form.name.trim(),
        region: form.region.trim(),
        access_key_id: form.accessKeyId.trim(),
        secret_access_key: form.secretAccessKey,
        // Prázdná hodnota se NEPOSÍLÁ. Server si doplní vlastní název sady;
        // prázdný řetězec by naopak spadl na `min(1)` v `providerConfigSchema`.
        ...(configurationSet === '' ? {} : { configuration_set_name: configurationSet }),
        ...(form.isDefault ? { is_default: true } : {}),
      };
    }
    return {
      type: 'smtp',
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port),
      username: form.username.trim(),
      password: form.password,
      encryption: form.encryption,
      ...(form.isDefault ? { is_default: true } : {}),
    };
  }

  async function submit() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setFailure(null);
    setPending(true);
    try {
      const result = await onSubmit(buildInput());
      if (result.status === 'error') {
        // Neznámý kód spadne na `detail` ze serveru, nikdy na prázdno.
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      setForm(EMPTY);
      setType('ses');
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  function fieldError(key: string): { error: string } | Record<string, never> {
    const message = errors[key];
    return message === undefined ? {} : { error: message };
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title')}</DialogTitle>
      <DialogBody>
        <p className="text-text-muted">{t('explanation')}</p>

        {/*
          Roluje SE JEN seznam polí, ne celý dialog, a je to oprava naměřené vady.
          Když měl posuvník celý dialog, výchozí zaostření tlačítka ústupu (viz
          `onOpenAutoFocus` v `packages/ui`) obsah odrolovalo a nadpis „Nový
          odesílací účet" nebyl po otevření vůbec vidět. Ověřeno snímkem obrazovky.
        */}
        <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-1">
          <fieldset className="flex flex-col gap-2 border-0 p-0">
            <legend className="mb-1 text-sm font-medium text-text">{t('typeLabel')}</legend>
            <RadioGroup
              value={type}
              onValueChange={(next) => {
                setType(next as 'ses' | 'smtp');
                setErrors({});
                setFailure(null);
              }}
              aria-label={t('typeLabel')}
              className="gap-3"
            >
              {(['ses', 'smtp'] as const).map((kind) => (
                <div key={kind} className="flex items-start gap-3">
                  <RadioGroupItem
                    value={kind}
                    id={`provider-type-${kind}`}
                    data-testid={`provider-type-${kind}`}
                    // Přístupné jméno nese `aria-label`, protože `RadioGroupItem`
                    // je Radix tlačítko bez vlastního textu. Zní doslova stejně
                    // jako viditelný popisek vedle něj.
                    aria-label={t(kind === 'ses' ? 'typeSes' : 'typeSmtp')}
                    className="mt-1 shrink-0"
                  />
                  <label htmlFor={`provider-type-${kind}`} className="cursor-pointer">
                    <span className="block text-sm font-medium text-text">
                      {t(kind === 'ses' ? 'typeSes' : 'typeSmtp')}
                    </span>
                    <span className="block text-sm text-text-muted">
                      {t(kind === 'ses' ? 'typeSesHint' : 'typeSmtpHint')}
                    </span>
                  </label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          <Field label={t('name')} hint={t('nameHint')} {...fieldError('name')}>
            <Input
              data-testid="provider-name"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>

          {type === 'ses' ? (
            <>
              <Field label={t('region')} hint={t('regionHint')} {...fieldError('region')}>
                <Input
                  data-testid="provider-region"
                  value={form.region}
                  onChange={(event) => set('region', event.target.value)}
                />
              </Field>
              <Field label={t('accessKeyId')} {...fieldError('accessKeyId')}>
                <Input
                  data-testid="provider-access-key-id"
                  autoComplete="off"
                  value={form.accessKeyId}
                  onChange={(event) => set('accessKeyId', event.target.value)}
                />
              </Field>
              <Field label={t('secretAccessKey')} {...fieldError('secretAccessKey')}>
                <Input
                  data-testid="provider-secret-access-key"
                  type="password"
                  autoComplete="new-password"
                  value={form.secretAccessKey}
                  onChange={(event) => set('secretAccessKey', event.target.value)}
                />
              </Field>
              <Field
                label={t('configurationSet')}
                hint={t('configurationSetHint')}
                optionalLabel={t('optional')}
                {...fieldError('configurationSetName')}
              >
                <Input
                  data-testid="provider-configuration-set"
                  value={form.configurationSetName}
                  onChange={(event) => set('configurationSetName', event.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t('host')} hint={t('hostHint')} {...fieldError('host')}>
                <Input
                  data-testid="provider-host"
                  value={form.host}
                  onChange={(event) => set('host', event.target.value)}
                />
              </Field>
              <SelectField
                name="provider-port"
                label={t('port')}
                placeholder={t('port')}
                defaultValue={form.port}
                options={SMTP_PORTS.map((port) => ({ value: port, label: port }))}
                onSelected={(next) => set('port', next)}
              />
              <Field label={t('username')} {...fieldError('username')}>
                <Input
                  data-testid="provider-username"
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) => set('username', event.target.value)}
                />
              </Field>
              <Field label={t('password')} {...fieldError('password')}>
                <Input
                  data-testid="provider-password"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                />
              </Field>
              <SelectField
                name="provider-encryption"
                label={t('encryption')}
                placeholder={t('encryption')}
                defaultValue={form.encryption}
                options={ENCRYPTIONS.map((value) => ({
                  value,
                  label: t(ENCRYPTION_LABEL_KEY[value]),
                }))}
                onSelected={(next) => set('encryption', next as Encryption)}
              />
            </>
          )}

          <div className="flex items-center gap-2">
            <Checkbox
              id="provider-is-default"
              data-testid="provider-is-default"
              checked={form.isDefault}
              onCheckedChange={(next) => set('isDefault', next === true)}
            />
            <label htmlFor="provider-is-default" className="cursor-pointer text-sm text-text">
              {t('isDefault')}
            </label>
          </div>
        </div>

        {/* Chyba stojí MIMO rolovací oblast, aby ji uživatel viděl i tehdy,
            když je odrolovaný dole u tlačítek. */}
        {failure !== null && (
          <Alert tone="error" data-testid="add-provider-error">
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
            data-testid="add-provider-submit"
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
