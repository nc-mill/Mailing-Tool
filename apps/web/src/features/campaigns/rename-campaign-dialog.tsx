'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { CAMPAIGN_NAME_MAX } from './campaign-rename';
import type { RenameOutcome } from './campaign-name-field';

/**
 * Přejmenování kampaně z řádku seznamu.
 *
 * PROČ DIALOG A NE POLE NA MÍSTĚ. V hlavičce kroku 1 je název pole, do kterého se
 * píše rovnou (`campaign-name-field.tsx`), a je to tam správně: je to jediný
 * nadpis obrazovky. V řádku tabulky by totéž znamenalo pole v buňce, tedy prvek,
 * který soupeří s prokliknutím řádku a s výběrem, a u padesáti řádků pod sebou
 * padesát rámečků. Nabídka „…" otevře okno, které se ptá na jednu věc.
 *
 * PRAVIDLA JSOU TÁŽ, ne podobná: mez délky je `CAMPAIGN_NAME_MAX` ze sdíleného
 * `campaign-rename.ts` a hlášky jsou doslova ty, které na totéž dává krok 2
 * (`campaigns.settings.errors.*`). Dvě různé věty za jedno pravidlo by vypadaly
 * jako dvě různá pravidla.
 */
export function RenameCampaignDialog({
  campaign,
  open,
  onOpenChange,
  onRename,
}: {
  campaign: { name: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => Promise<RenameOutcome>;
}) {
  const t = useTranslations('campaigns.settings');
  const tr = useTranslations('campaigns.renameDialog');
  const [value, setValue] = useState(campaign.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(): Promise<void> {
    const next = value.trim();
    if (next === '') {
      setError(t('errors.nameRequired'));
      return;
    }
    if (next.length > CAMPAIGN_NAME_MAX) {
      setError(t('errors.nameTooLong'));
      return;
    }
    /*
      Beze změny se okno jen zavře. Volat server kvůli témuž jménu by znamenalo
      zapsat do auditu úpravu, ke které nedošlo.
    */
    if (next === campaign.name) {
      onOpenChange(false);
      return;
    }

    setError(null);
    setPending(true);
    try {
      const result = await onRename(next);
      if (result.status === 'error') {
        setError(result.code === 'campaign_locked' ? t('renameLocked') : t('renameFailed'));
        return;
      }
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{tr('title', { name: campaign.name })}</DialogTitle>
      <DialogBody>
        {/* `form` kvůli Enteru: v okně s jedním polem je odeslání klávesou to,
            co uživatel čeká, a bez formuláře by Enter neudělal nic. */}
        <form
          id="rename-campaign-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Field label={t('name')} {...(error === null ? {} : { error })}>
            <Input
              name="name"
              autoFocus
              data-testid="rename-campaign-input"
              maxLength={CAMPAIGN_NAME_MAX}
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </Field>
        </form>
      </DialogBody>

      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tr('back')}
          </Button>
        }
        confirm={
          <Button
            type="submit"
            form="rename-campaign-form"
            variant="primary"
            data-testid="rename-campaign-submit"
            pending={pending}
            pendingLabel={tr('submitting')}
          >
            {tr('submit')}
          </Button>
        }
      />
    </Dialog>
  );
}
