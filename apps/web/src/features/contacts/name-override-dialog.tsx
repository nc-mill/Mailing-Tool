'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui/components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '@mlain/ui/components/dialog';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Alert } from '@mlain/ui/patterns/states';
import { upsertNameOverrideAction } from './actions';
import type { NameOverrideRow } from './name-overrides-table';

/**
 * ZALOŽENÍ I ÚPRAVA PŘEPISU JMÉNA V JEDNOM DIALOGU.
 *
 * Na serveru je to jedna operace: `POST /name-overrides` je upsert podle dvojice
 * `kind` a normalizovaného tvaru jména. Dva dialogy by předstíraly rozdíl, který
 * v datech není, a druhý by se navíc musel ptát na klíč, který uživatel nikdy
 * nepsal.
 *
 * PŘI ÚPRAVĚ SE JMÉNO A DRUH NEMĚNÍ, protože právě ty dvě hodnoty tvoří klíč.
 * Přepsat je by nebyla úprava, ale založení dalšího přepisu, a ten původní by
 * ve slovníku tiše zůstal. Kdo chce jiné jméno, smaže a založí znovu.
 *
 * PRÁZDNÉ POLE HODNOTU MAŽE, a to od opravy zápisu ze 7. 8. 2026. Dialog posílá
 * prázdné pole jako `null` a server `null` čte jako „vymaž"; dřív ho slil
 * s vynecháním (`coalesce(excluded.x, name_overrides.x)`) a hodnota zůstávala,
 * takže tady musela stát omluvná věta „prázdné pole nemaže". Zůstává jen upozornění,
 * že rod a pátý pád nesmí zmizet oba naráz, protože takový přepis nemá co přepsat.
 */
const GENDERS = ['female', 'male', 'unknown'] as const;

export function NameOverrideDialog({
  open,
  onOpenChange,
  workspaceId,
  override,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  /** `null` znamená založení nového přepisu. */
  override: NameOverrideRow | null;
  /** Zavolá se po úspěchu. Tabulka si podle toho vyžádá nová data ze serveru. */
  onSaved: () => void;
}) {
  const t = useTranslations('contacts.nameOverrides');
  const tc = useTranslations('common.actions');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'first' | 'last'>('first');
  const [gender, setGender] = useState<'female' | 'male' | 'unknown' | 'unset'>('unset');
  const [vocative, setVocative] = useState('');
  const [note, setNote] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Předvyplnění se odvíjí od otevření, ne od složení komponenty: tabulka drží
  // jednu instanci dialogu pro všechny řádky, takže by jinak zůstala v poli
  // hodnota z řádku, který uživatel otevřel předtím.
  useEffect(() => {
    if (!open) return;
    setName(override?.nameKey ?? '');
    setKind(override?.kind ?? 'first');
    setGender(override?.gender ?? 'unset');
    setVocative(override?.vocative ?? '');
    setNote(override?.note ?? '');
    setFailure(null);
  }, [open, override]);

  const editing = override !== null;
  // Server žádá rod NEBO pátý pád (`ck_name_overrides__has_value`). Prázdný
  // přepis by neměl co přepsat a skončil by na 422; říct to jde dřív a lépe.
  const incomplete = name.trim() === '' || (gender === 'unset' && vocative.trim() === '');

  async function submit() {
    setBusy(true);
    setFailure(null);
    try {
      const result = await upsertNameOverrideAction({
        workspaceId,
        kind,
        name,
        gender: gender === 'unset' ? null : gender,
        vocative: vocative.trim() === '' ? null : vocative,
        note: note.trim() === '' ? null : note,
      });
      if (result.status === 'error') {
        setFailure(result.detail === '' ? t('saveFailed') : result.detail);
        return;
      }
      onOpenChange(false);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{editing ? t('editTitle') : t('createTitle')}</DialogTitle>
      <DialogBody>
        <div className="flex flex-col gap-[var(--spacing-gutter)]">
          {/* Při úpravě se jméno ani druh nenabízejí k přepsání, protože tvoří
              klíč přepisu. Ukazují se jako text, ne jako zamčené pole: zašedlé
              pole vypadá jako porucha, kdežto text říká „tohle je dané". */}
          {editing ? (
            <div className="flex flex-col gap-1.5" data-testid="name-override-key">
              <span className="text-sm font-semibold text-text">{t('name')}</span>
              <p className="text-ui text-text">
                {name} ({kind === 'first' ? t('kindFirst') : t('kindLast')})
              </p>
              <p className="text-meta text-text-muted">{t('nameLockedHint')}</p>
            </div>
          ) : (
            <>
              <Field label={t('name')} hint={t('nameHint')}>
                <Input
                  data-testid="name-override-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>

              <div data-testid="name-override-kind" className="flex flex-col gap-1.5">
                <span aria-hidden className="text-sm font-semibold text-text">
                  {t('kind')}
                </span>
                <Select
                  value={kind}
                  onValueChange={(value) => setKind(value as 'first' | 'last')}
                  placeholder={t('kind')}
                  aria-label={t('kind')}
                >
                  <SelectItem value="first">{t('kindFirst')}</SelectItem>
                  <SelectItem value="last">{t('kindLast')}</SelectItem>
                </Select>
              </div>
            </>
          )}

          <div data-testid="name-override-gender" className="flex flex-col gap-1.5">
            <span aria-hidden className="text-sm font-semibold text-text">
              {t('gender')}
            </span>
            <Select
              value={gender}
              onValueChange={(value) => setGender(value as typeof gender)}
              placeholder={t('gender')}
              aria-label={t('gender')}
            >
              <SelectItem value="unset">{t('unset')}</SelectItem>
              {GENDERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === 'female'
                    ? t('genderFemale')
                    : value === 'male'
                      ? t('genderMale')
                      : t('genderNeutral')}
                </SelectItem>
              ))}
            </Select>
            <p className="text-meta text-text-muted">{t('genderHint')}</p>
          </div>

          <Field label={t('vocative')} hint={t('vocativeHint')}>
            <Input
              data-testid="name-override-vocative"
              value={vocative}
              onChange={(event) => setVocative(event.target.value)}
            />
          </Field>

          <Field label={t('note')} hint={t('noteHint')}>
            <Input
              data-testid="name-override-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>

          {/* Prázdné pole hodnotu vymaže. Věta zůstává, protože přesně u pátého
              pádu jde o tichý zásah do odchozí pošty a rod s pátým pádem navíc
              nesmí zmizet oba naráz. */}
          {editing ? (
            <Alert tone="info" data-testid="name-override-clear-hint">
              {t('clearHint')}
            </Alert>
          ) : null}

          {failure !== null && (
            <Alert tone="error" data-testid="name-override-error">
              {failure}
            </Alert>
          )}
        </div>
      </DialogBody>
      <DialogFooter
        retreat={
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {tc('cancel')}
          </Button>
        }
        confirm={
          <Button
            variant="primary"
            data-testid="name-override-submit"
            pending={busy}
            pendingLabel={t('savePending')}
            // Primární tlačítko se nezakazuje (princip P5): místo zašedlého
            // tlačítka se řekne, co zbývá doplnit.
            {...(incomplete ? { unavailableReason: t('saveIncomplete') } : {})}
            onClick={() => void submit()}
          >
            {t('saveSubmit')}
          </Button>
        }
      />
    </Dialog>
  );
}
