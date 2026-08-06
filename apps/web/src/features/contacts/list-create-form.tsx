'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Textarea } from '@mlain/ui/components/textarea';
import { ChevronRight, Plus } from '@mlain/ui/icons';
import { Alert } from '@mlain/ui/patterns/states';
import { createListAction } from './list-create-actions';

/**
 * Obrazovka „nový seznam".
 *
 * Ptá se na tři věci a víc ne. Zbytek nastavení (e-maily, veřejné nabízení,
 * platnost odkazu) je na detailu seznamu, kam se po založení rovnou přejde:
 * dlouhý formulář před prvním seznamem je nejjistější způsob, jak člověka
 * odradit od věci, kterou zvládne jedna věta.
 *
 * Návrh tuhle obrazovku nemá, takže se drží rytmu ostatních: hlavička,
 * karta s obsahem.
 */
export function ListCreateForm({
  basePath,
  workspaceId,
}: {
  basePath: string;
  workspaceId: string;
}) {
  const t = useTranslations('contacts');
  const tc = useTranslations('common');
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
    <>
      <PageHeader
        title={t('lists.createTitle')}
        description={t('lists.createLead')}
        breadcrumbs={
          <nav aria-label={tc('a11y.breadcrumbs')} className="flex items-center gap-2">
            <Link href={basePath} className="text-sm underline-offset-[3px]">
              {t('lists.title')}
            </Link>
            <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
            <span className="min-w-0 truncate font-mono text-meta text-text-muted">
              {t('lists.createTitle')}
            </span>
          </nav>
        }
      />

      <div className="flex max-w-[640px] flex-col gap-[var(--spacing-gutter)]">
        <Card gap="gutter">
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
              rows={3}
              data-testid="new-list-description"
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
        </Card>

        <Card gap="gutter">
          <CardTitle>{t('lists.doubleOptIn')}</CardTitle>
          <RadioGroup
            name="new-list-opt-in"
            value={optIn}
            className="gap-[var(--spacing-stack)]"
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
                  className="mt-1"
                />
                <div className="flex flex-col gap-1.5">
                  <span
                    id={`new-list-opt-in-label-${option.value}`}
                    className="text-ui font-semibold text-text"
                  >
                    {t(`lists.${option.label}`)}
                  </span>
                  <span className="text-meta text-text-muted">{t(`lists.${option.hint}`)}</span>
                </div>
              </div>
            ))}
          </RadioGroup>
        </Card>

        {error === null ? null : <Alert tone="error">{error}</Alert>}

        <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
          <Button
            variant="primary"
            data-testid="new-list-submit"
            pending={saving}
            pendingLabel={t('lists.createWorking')}
            onClick={() => {
              if (!saving) void submit();
            }}
          >
            <Plus aria-hidden className="icon-md" />
            {t('lists.create')}
          </Button>
          <Link href={basePath}>{t('form.cancel')}</Link>
        </div>
      </div>
    </>
  );
}
