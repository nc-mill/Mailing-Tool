'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Textarea } from '@mlain/ui/components/textarea';
import { createListAction } from './list-create-actions';

/**
 * Obrazovka „nový seznam".
 *
 * Ptá se na tři věci a víc ne. Zbytek nastavení (e-maily, veřejné nabízení,
 * platnost odkazu) je na detailu seznamu, kam se po založení rovnou přejde:
 * dlouhý formulář před prvním seznamem je nejjistější způsob, jak člověka
 * odradit od věci, kterou zvládne jedna věta.
 */
export function ListCreateForm({
  basePath,
  workspaceId,
}: {
  basePath: string;
  workspaceId: string;
}) {
  const t = useTranslations('contacts');
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [optIn, setOptIn] = useState<'single' | 'double'>('double');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (name.trim() === '') {
      setError(t('lists.createNameRequired'));
      return;
    }
    setSaving(true);
    setError(null);
    const result = await createListAction({ workspaceId, name, description, optIn });
    setSaving(false);
    if (result.status === 'error') {
      // Zabrané jméno je jediná chyba, kterou uživatel opravdu opraví, takže má
      // vlastní větu. Zbytek je obecné „nepovedlo se".
      setError(
        result.code === 'already_exists' ? t('lists.createNameTaken') : t('lists.createFailed'),
      );
      return;
    }
    router.push(`${basePath}/${result.id}`);
  }

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-text">{t('lists.createTitle')}</h1>
      <p className="text-sm text-text-muted">{t('lists.createLead')}</p>

      <Field label={t('lists.name')} hint={t('lists.createNameHint')}>
        <Input
          value={name}
          maxLength={120}
          data-testid="new-list-name"
          onChange={(event) => setName(event.target.value)}
        />
      </Field>

      <Field label={t('lists.description')} optionalLabel={t('lists.publicOptional')}>
        <Textarea
          value={description}
          maxLength={2000}
          rows={2}
          data-testid="new-list-description"
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <h2 className="font-semibold text-text">{t('lists.doubleOptIn')}</h2>
      <RadioGroup
        name="new-list-opt-in"
        value={optIn}
        onValueChange={(next: string) => setOptIn(next as 'single' | 'double')}
      >
        {(
          [
            { value: 'double', label: 'optInDouble', hint: 'optInDoubleHint' },
            { value: 'single', label: 'optInSingle', hint: 'optInSingleHint' },
          ] as const
        ).map((option) => (
          <div key={option.value} className="flex items-start gap-3">
            <RadioGroupItem
              value={option.value}
              id={`new-list-opt-in-${option.value}`}
              aria-labelledby={`new-list-opt-in-label-${option.value}`}
            />
            <div className="flex flex-col gap-1">
              <span
                id={`new-list-opt-in-label-${option.value}`}
                className="text-sm font-medium text-text"
              >
                {t(`lists.${option.label}`)}
              </span>
              <span className="text-sm text-text-muted">{t(`lists.${option.hint}`)}</span>
            </div>
          </div>
        ))}
      </RadioGroup>

      {error === null ? null : (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          data-testid="new-list-submit"
          onClick={() => {
            if (!saving) void submit();
          }}
        >
          {saving ? t('lists.createWorking') : t('lists.create')}
        </Button>
        <Link href={basePath}>{t('form.cancel')}</Link>
      </div>
    </section>
  );
}
