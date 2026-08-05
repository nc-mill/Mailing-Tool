'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Alert } from '@mlain/ui/patterns/states';
import { SelectField } from '@/lib/forms/select-field';
import { RegionChangeWarning, RegionSelect } from './region-select';
import type { DeleteProviderResult, UpdateProviderInput, UpdateProviderResult } from './actions';
import type { ProviderView } from './sending-settings';

/**
 * Dva dialogy nad hotovým odesílacím účtem: úprava a odebrání.
 *
 * Jsou v jednom souboru schválně. Otevírají se z jednoho řádku seznamu, oba
 * pracují s týmž `ProviderView` a oba po sobě nechávají obrazovku znovu načíst
 * data. Rozdělit je do dvou souborů by znamenalo tentýž import a tentýž typ
 * dvakrát, a hlavně dva soubory, které se musí měnit společně.
 *
 * Zakládání účtu je v `add-provider-dialog.tsx` a zůstává tam: má jinou sadu
 * polí (typ účtu, obě tajemství povinně) a jiný koncový bod.
 */

/** Porty i šifrování jsou opsané ze `providerConfigSchema` v `packages/core`. */
const SMTP_PORTS = ['587', '465', '25', '2525'] as const;
const ENCRYPTIONS = ['starttls', 'tls', 'none'] as const;

type Encryption = (typeof ENCRYPTIONS)[number];

const ENCRYPTION_LABEL_KEY: Record<
  Encryption,
  'encryptionStarttls' | 'encryptionTls' | 'encryptionNone'
> = {
  starttls: 'encryptionStarttls',
  tls: 'encryptionTls',
  none: 'encryptionNone',
};

type FormState = {
  name: string;
  region: string;
  configurationSetName: string;
  accessKeyId: string;
  secretAccessKey: string;
  host: string;
  port: string;
  username: string;
  password: string;
  encryption: Encryption;
};

/**
 * Předvyplní se JEN to, co server opravdu vrací. Tajemství se z API nikdy
 * nevracejí, takže jejich pole zůstávají prázdná a prázdná hodnota znamená
 * „nech, jak to je". Předvyplnit je maskovanou hodnotou by bylo horší než
 * nechat je prázdné: uživatel by odeslal `AKIA****MPLE` jako nový klíč.
 */
function initialForm(provider: ProviderView): FormState {
  const config = provider.config ?? {};
  return {
    name: provider.name,
    region: config.region ?? '',
    configurationSetName: config.configuration_set_name ?? '',
    accessKeyId: '',
    secretAccessKey: '',
    host: config.host ?? '',
    port: String(config.port ?? 587),
    username: '',
    password: '',
    encryption: config.encryption ?? 'starttls',
  };
}

export function EditProviderDialog({
  provider,
  open,
  onOpenChange,
  onSubmit,
}: {
  provider: ProviderView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (patch: UpdateProviderInput) => Promise<UpdateProviderResult>;
}) {
  const t = useTranslations('campaigns.sending.editDialog');
  const isSes = provider.type === 'ses';
  const [form, setForm] = useState<FormState>(() => initialForm(provider));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFailure(null);
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

    if (isSes) {
      if (form.region.trim() === '') found['region'] = t('regionRequired');
      if (form.configurationSetName.trim().length > 64) {
        found['configurationSetName'] = t('tooLong', { max: 64 });
      }
      /*
       * Klíč a tajemství se u Amazonu vydávají v páru a tajemství se zpětně
       * nedá vyčíst. Vyměnit jen jednu půlku páru proto vždycky znamená účet,
       * který přestane fungovat, a formulář to nepustí dál.
       */
      const wantsRotation = form.accessKeyId.trim() !== '' || form.secretAccessKey !== '';
      if (wantsRotation) {
        if (form.accessKeyId.trim().length < 16) found['accessKeyId'] = t('rotatePair');
        if (form.secretAccessKey.length < 16) found['secretAccessKey'] = t('rotatePair');
      }
    } else {
      if (form.host.trim() === '') found['host'] = t('required');
    }
    return found;
  }

  /** Pošle se jen to, co se opravdu změnilo. PATCH vynechané pole nechává být. */
  function buildPatch(): UpdateProviderInput {
    const patch: UpdateProviderInput = {};
    const config = provider.config ?? {};
    if (form.name.trim() !== provider.name) patch.name = form.name.trim();

    if (isSes) {
      const region = form.region.trim();
      if (region !== (config.region ?? '')) patch.region = region;
      const set_ = form.configurationSetName.trim();
      // Prázdná sada se NEPOSÍLÁ: server ji má `min(1)` a vymazat ji nejde.
      if (set_ !== '' && set_ !== (config.configuration_set_name ?? '')) {
        patch.configuration_set_name = set_;
      }
      if (form.accessKeyId.trim() !== '') patch.access_key_id = form.accessKeyId.trim();
      if (form.secretAccessKey !== '') patch.secret_access_key = form.secretAccessKey;
      return patch;
    }

    const host = form.host.trim();
    if (host !== (config.host ?? '')) patch.host = host;
    if (Number(form.port) !== config.port) patch.port = Number(form.port);
    if (form.encryption !== config.encryption) patch.encryption = form.encryption;
    if (form.username.trim() !== '') patch.username = form.username.trim();
    if (form.password !== '') patch.password = form.password;
    return patch;
  }

  async function submit() {
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      // Prázdný PATCH by server přijal a obrazovka by hlásila úspěch nad tím,
      // že se nestalo nic. Uživatel se to dozví rovnou tady.
      setFailure(t('noChanges'));
      return;
    }

    setFailure(null);
    setPending(true);
    try {
      const result = await onSubmit(patch);
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  function fieldError(key: string): { error: string } | Record<string, never> {
    const message = errors[key];
    return message === undefined ? {} : { error: message };
  }

  const config = provider.config ?? {};

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{t('title', { name: provider.name })}</DialogTitle>
      <DialogBody>
        <p className="text-text-muted">{t('explanation')}</p>

        {/* Roluje se jen seznam polí, ne celý dialog: jinak výchozí zaostření
            tlačítka ústupu odroluje nadpis z obrazovky. Stejný důvod jako
            u dialogu zakládání. */}
        <div className="flex max-h-[52vh] flex-col gap-3 overflow-y-auto pr-1">
          <Field label={t('name')} hint={t('nameHint')} {...fieldError('name')}>
            <Input
              data-testid="edit-provider-name"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
            />
          </Field>

          {isSes ? (
            <>
              <RegionSelect
                name="edit-provider-region"
                value={form.region}
                onChange={(next) => set('region', next)}
                {...(errors['region'] === undefined ? {} : { error: errors['region'] })}
              />
              {/*
                Varování o změně regionu se ukáže JEN při skutečné změně, a to
                dřív, než uživatel klikne na Uložit. Zadavatel právě přepnul
                Frankfurt na Irsko a přišel přitom o konfigurační sadu, ověřené
                identity i platnost DKIM záznamů, aniž by mu to kdokoli řekl.
              */}
              {form.region.trim() !== '' && form.region.trim() !== (config.region ?? '') && (
                <RegionChangeWarning from={config.region ?? ''} to={form.region.trim()} />
              )}
              <Field
                label={t('configurationSet')}
                optionalLabel={t('optional')}
                {...fieldError('configurationSetName')}
              >
                <Input
                  data-testid="edit-provider-configuration-set"
                  value={form.configurationSetName}
                  onChange={(event) => set('configurationSetName', event.target.value)}
                />
              </Field>
              <Field
                label={t('accessKeyId')}
                hint={t('secretHint', { current: config.access_key_id_masked ?? '' })}
                {...fieldError('accessKeyId')}
              >
                <Input
                  data-testid="edit-provider-access-key-id"
                  autoComplete="off"
                  placeholder={t('unchanged')}
                  value={form.accessKeyId}
                  onChange={(event) => set('accessKeyId', event.target.value)}
                />
              </Field>
              <Field
                label={t('secretAccessKey')}
                hint={t('secretAccessKeyHint')}
                {...fieldError('secretAccessKey')}
              >
                <Input
                  data-testid="edit-provider-secret-access-key"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('unchanged')}
                  value={form.secretAccessKey}
                  onChange={(event) => set('secretAccessKey', event.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label={t('host')} {...fieldError('host')}>
                <Input
                  data-testid="edit-provider-host"
                  value={form.host}
                  onChange={(event) => set('host', event.target.value)}
                />
              </Field>
              <SelectField
                name="edit-provider-port"
                label={t('port')}
                placeholder={t('port')}
                defaultValue={form.port}
                options={SMTP_PORTS.map((port) => ({ value: port, label: port }))}
                onSelected={(next) => set('port', next)}
              />
              <Field
                label={t('username')}
                hint={t('secretHint', { current: config.username_masked ?? '' })}
                {...fieldError('username')}
              >
                <Input
                  data-testid="edit-provider-username"
                  autoComplete="off"
                  placeholder={t('unchanged')}
                  value={form.username}
                  onChange={(event) => set('username', event.target.value)}
                />
              </Field>
              <Field label={t('password')} hint={t('passwordHint')} {...fieldError('password')}>
                <Input
                  data-testid="edit-provider-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t('unchanged')}
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                />
              </Field>
              <SelectField
                name="edit-provider-encryption"
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
        </div>

        {failure !== null && (
          <Alert tone="error" data-testid="edit-provider-error">
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
            data-testid="edit-provider-submit"
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

/** Chybové kódy, u kterých má odebrání vlastní vysvětlení, ne obecnou větu. */
const DELETE_ERROR_KEY: Record<string, 'conflict' | 'forbidden' | 'notFound'> = {
  conflict: 'conflict',
  forbidden: 'forbidden',
  insufficient_scope: 'forbidden',
  not_found: 'notFound',
};

export function DeleteProviderDialog({
  provider,
  open,
  onOpenChange,
  onConfirm,
}: {
  provider: ProviderView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<DeleteProviderResult>;
}) {
  const t = useTranslations('campaigns.sending.deleteDialog');
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function confirm() {
    setFailure(null);
    setPending(true);
    try {
      const result = await onConfirm();
      if (result.status === 'error') {
        const key = DELETE_ERROR_KEY[result.code];
        setFailure(key ? t(key) : result.detail === '' ? t('failed') : result.detail);
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    // `destructive` znamená, že dialog nejde zavřít kliknutím mimo. Odebrání
    // účtu je nevratné, takže se nesmí zavřít omylem.
    <Dialog open={open} onOpenChange={onOpenChange} destructive>
      <DialogTitle>{t('title', { name: provider.name })}</DialogTitle>
      <DialogBody>
        {/* Dialog říká, CO se stane, ne jen „opravdu?". Tři věty, tři důsledky:
            přijdete o údaje, historie zůstane, rozjetá kampaň to zablokuje. */}
        <p>{t('explanation')}</p>
        <p className="text-text-muted">{t('historyStays')}</p>
        <p className="text-text-muted">{t('runningCampaigns')}</p>

        {provider.is_default && (
          <Alert tone="warning" data-testid="delete-provider-default-warning">
            {t('defaultWarning')}
          </Alert>
        )}

        {failure !== null && (
          <Alert tone="error" data-testid="delete-provider-error">
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
            variant="destructive"
            data-testid="delete-provider-submit"
            pending={pending}
            pendingLabel={t('submitting')}
            onClick={() => void confirm()}
          >
            {t('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
