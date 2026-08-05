'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
// Odkazy i router jdou přes `@mlain/i18n/navigation`, ne přímo z Nextu:
// obálka drží prefix jazyka v adrese. Přímý `next/link` by z projektu odvedl
// na cestu bez locale a middleware by na ni musel přesměrovávat.
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Alert } from '@mlain/ui/patterns/states';
import { applySenderToCampaignAction } from '@/features/senders/actions';

/** Jen to, co se z předvolby opravdu předvyplňuje, plus jméno do seznamu. */
export type SenderIdentityOption = {
  id: string;
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  sender_domain_id: string;
  domain_verified: boolean;
};

/**
 * Výběr uloženého odesílatele nad poli odesílatele v nastavení kampaně.
 *
 * PROČ TO UKLÁDÁ ROVNOU. Účet a doména jsou ve formuláři `SelectField`, který
 * si hodnotu drží ve vlastním `useState` a zvenčí ji přepsat nejde. Kdyby
 * předvolba měnila jen skrytá pole, ukazoval by rozbalovací seznam pořád starý
 * účet, uložilo by se něco jiného, než co je vidět, a nikdo by nepoznal proč.
 *
 * Zapsat a překreslit je poctivější: server uloží pět hodnot, `router.refresh()`
 * je přinese zpátky a `selectKey` ve formuláři na jejich změnu reaguje
 * přemountováním obou seznamů. Rozdělaný text v ostatních polích formuláře
 * přitom zůstane, protože ta jsou neřízená a refresh je nepřemountuje.
 *
 * Je to týž vzor, jaký v tom formuláři už je: „Zrušit plán a upravit" taky dělá
 * vlastní zápis a refresh, ne odeslání celého formuláře.
 */
export function SenderIdentityPicker({
  identities,
  workspaceId,
  campaignId,
  selectedId,
  basePath,
}: {
  identities: readonly SenderIdentityOption[];
  workspaceId: string;
  campaignId: string;
  /** `campaign.sender_identity_id`. `null` znamená „vyplněno ručně". */
  selectedId: string | null;
  basePath: string;
}) {
  const t = useTranslations('campaigns.senders.picker');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  // Bez jediné uložené předvolby je z rozbalovacího seznamu jen prázdné pole,
  // které nic nevysvětluje. Místo něj se řekne, že se pole níž vyplňují ručně,
  // a ukáže cesta k tomu, kde předvolby vznikají. Odkaz zve k ZALOŽENÍ, ne ke
  // „správě": spravovat se dá jen to, co existuje.
  if (identities.length === 0) {
    return (
      <p className="text-sm text-text-muted" data-testid="sender-picker-empty">
        {t('empty')}{' '}
        <Link href={`${basePath}/settings/senders`} className="underline">
          {t('emptyAction')}
        </Link>
      </p>
    );
  }

  async function apply(id: string) {
    const identity = identities.find((item) => item.id === id);
    if (identity === undefined) return;
    setPending(true);
    setFailure(null);
    try {
      const result = await applySenderToCampaignAction({
        workspaceId,
        campaignId,
        identity: {
          id: identity.id,
          from_name: identity.from_name,
          from_email: identity.from_email,
          reply_to: identity.reply_to,
          provider_id: identity.provider_id,
          sender_domain_id: identity.sender_domain_id,
        },
      });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('failed') : result.detail);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1" data-testid="sender-picker">
      <span aria-hidden className="mb-1 block text-sm font-medium text-text">
        {t('label')}
      </span>
      <Select
        {...(selectedId === null ? {} : { value: selectedId })}
        onValueChange={(next) => {
          if (!pending) void apply(next);
        }}
        placeholder={t('placeholder')}
        aria-label={t('label')}
      >
        {identities.map((identity) => (
          <SelectItem key={identity.id} value={identity.id}>
            {identity.domain_verified
              ? identity.name
              : t('unverifiedOption', { name: identity.name })}
          </SelectItem>
        ))}
      </Select>
      <p className="text-sm text-text-muted">
        {pending ? t('applying') : t('hint')}{' '}
        <Link href={`${basePath}/settings/senders`} className="underline">
          {t('manage')}
        </Link>
      </p>
      {failure !== null && (
        <Alert tone="error" data-testid="sender-picker-error">
          {failure}
        </Alert>
      )}
    </div>
  );
}
