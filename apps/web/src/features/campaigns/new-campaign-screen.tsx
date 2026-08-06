'use client';

import { useState, useTransition } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@mlain/i18n/navigation';
import { Button } from '@mlain/ui/components/button';
import { Card } from '@mlain/ui/components/card';
import { Input } from '@mlain/ui/components/input';
import { Label } from '@mlain/ui/components/label';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { Alert } from '@mlain/ui/patterns/states';
import { startCampaignFromBlankAction, startCampaignFromTemplateAction } from './actions';
import { CAMPAIGN_STEPS, campaignStepHref } from './steps';

export type TemplateOption = { id: string; name: string };

/**
 * První krok zakládání kampaně: OBSAH.
 *
 * Kampaň se dřív zakládala jediným kliknutím v seznamu a uživatel skončil na
 * nastavení, kde si mohl leda vybrat hotovou šablonu. Vytvořit e-mail rovnou
 * v kampani nešlo. Tenhle krok to obrací: nejdřív se rozhodne, čím e-mail
 * začne, a teprve pak se doplňuje odesílatel, publikum a plán.
 *
 * PRŮVODCE SE NESKLÁDÁ Z `Wizard`. Ta komponenta drží krok v URL a mezi kroky
 * překlikává vlastními tlačítky „Zpět" a „Pokračovat". Tady je ale první krok
 * opravdu první (není kam se vracet) a druhý krok je jiná stránka s vlastním
 * ukládáním, takže by z `Wizard` zbylo hlášení kroku a jedno tlačítko, jehož
 * stav běhu neumí ukázat. Ohlášení kroku pro čtečku se proto skládá tady,
 * ve stejném tvaru, v jakém ho vypisuje `Wizard`.
 *
 * KAMPAŇ VZNIKÁ AŽ TÍMHLE ROZHODNUTÍM, ne otevřením obrazovky. Odchod z téhle
 * stránky proto nenechává v seznamu prázdné kampaně, které nikdo nechtěl,
 * a všechno, co se rozhodne dál, už je uložené na serveru.
 */
export function NewCampaignScreen({
  workspaceId,
  basePath,
  templates,
}: {
  workspaceId: string;
  basePath: string;
  templates: TemplateOption[];
}) {
  const t = useTranslations('campaigns.new');
  const tList = useTranslations('campaigns.list');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName] = useState(t('defaultName'));
  // Výchozí je prázdný e-mail: je to jediná volba, která funguje i v projektu
  // bez jediné šablony, tedy hned po založení.
  const [source, setSource] = useState<'blank' | 'template'>('blank');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function validate(): string | null {
    const trimmed = name.trim();
    if (trimmed === '') return t('nameRequired');
    if (trimmed.length > 200) return t('nameTooLong');
    if (source === 'template' && templateId === null) return t('templateRequired');
    return null;
  }

  function submit() {
    // Dvojklik nesmí založit dvě kampaně. Tlačítko se nezašeďuje, jen se
    // po dobu běhu mění popisek a druhé kliknutí se zahodí.
    if (pending) return;
    const problem = validate();
    if (problem !== null) {
      setError(problem);
      return;
    }
    setError(null);

    startTransition(async () => {
      const trimmed = name.trim();
      const result =
        source === 'blank'
          ? await startCampaignFromBlankAction({ workspaceId, name: trimmed, locale })
          : await startCampaignFromTemplateAction({
              workspaceId,
              name: trimmed,
              templateId: templateId as string,
            });

      if (result.status === 'error') {
        setError(t('failed'));
        return;
      }

      /*
       * OBĚ VOLBY VEDOU DO KROKU 1, tedy do editoru obsahu kampaně. Prázdný
       * e-mail se v něm teprve napíše, kampaň ze šablony si v něm uživatel
       * upraví převzatý obsah; ani jedna nemá důvod začínat u předmětu.
       *
       * Míří se na krok kampaně, ne na editor knihovní šablony. Dřív tahle
       * cesta končila v `/templates/{id}` s parametry návratu, takže uživatel
       * psal e-mail na obrazovce šablon a do kampaně se vracel tlačítkem;
       * kampaň přitom byla už založená a čekala na obsah.
       */
      router.push(campaignStepHref(basePath, result.campaignId, 'content'));
    });
  }

  return (
    <div className="flex max-w-[820px] flex-col">
      <PageHeader
        title={t('contentTitle')}
        description={t('intro')}
        /* Počet kroků se BERE ZE ZDROJE, ne z ruky. Zakládání je vstup do
           prvního kroku kampaně a hlášení „Krok 1 z 2" by po přeskládání
           kroků slibovalo o krok míň, než kolik jich kampaň má. */
        eyebrow={
          <span role="status" aria-live="polite">
            {t('stepOf', { current: 1, total: CAMPAIGN_STEPS.length })}
          </span>
        }
        breadcrumbs={
          <nav aria-label={tc('a11y.breadcrumbs')}>
            <Link href={`${basePath}/campaigns`} className="text-sm">
              {tList('title')}
            </Link>
          </nav>
        }
      />

      <div className="flex flex-col gap-[var(--spacing-gutter)]">
        {error !== null && (
          <Alert tone="error" data-testid="new-campaign-error">
            {error}
          </Alert>
        )}

        <Card gap="gutter">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">{t('name')}</Label>
            <Input
              id="campaign-name"
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <p className="text-meta text-text-muted">{t('nameHint')}</p>
          </div>

          <fieldset className="flex flex-col gap-3">
            <legend className="meta-caps mb-[var(--spacing-inline)] text-text-muted">
              {t('choiceLegend')}
            </legend>
            <RadioGroup
              value={source}
              onValueChange={(next) => {
                setSource(next as 'blank' | 'template');
                setError(null);
              }}
              aria-label={t('choiceLegend')}
              className="gap-3"
            >
              {(['blank', 'template'] as const).map((kind) => (
                <div key={kind} className="flex items-start gap-3">
                  <RadioGroupItem
                    value={kind}
                    id={`campaign-source-${kind}`}
                    data-testid={`campaign-source-${kind}`}
                    // Přístupné jméno nese `aria-label`, protože `RadioGroupItem`
                    // je Radix tlačítko bez vlastního textu. Zní doslova stejně
                    // jako viditelný popisek vedle něj.
                    aria-label={t(kind === 'blank' ? 'blank' : 'fromTemplate')}
                    className="mt-1 shrink-0"
                  />
                  <label htmlFor={`campaign-source-${kind}`} className="cursor-pointer">
                    <span className="block text-ui font-semibold text-text">
                      {t(kind === 'blank' ? 'blank' : 'fromTemplate')}
                    </span>
                    <span className="block text-meta text-text-muted">
                      {t(kind === 'blank' ? 'blankHint' : 'fromTemplateHint')}
                    </span>
                  </label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>

          {source === 'template' && (
            <fieldset className="flex flex-col gap-3" data-testid="template-choice">
              <legend className="meta-caps mb-[var(--spacing-inline)] text-text-muted">
                {t('templateLegend')}
              </legend>
              {templates.length === 0 ? (
                /* Prázdná nabídka se nevynechává, ale vysvětlí a nabídne cestu ven. */
                <p className="text-sm text-text-muted">
                  {t('noTemplates')} <Link href={`${basePath}/templates`}>{t('toTemplates')}</Link>
                </p>
              ) : (
                <RadioGroup
                  value={templateId ?? ''}
                  onValueChange={(next) => {
                    setTemplateId(next);
                    setError(null);
                  }}
                  aria-label={t('templateLegend')}
                  className="gap-2"
                >
                  {templates.map((template) => (
                    <div key={template.id} className="flex items-center gap-3">
                      <RadioGroupItem
                        value={template.id}
                        id={`campaign-template-${template.id}`}
                        aria-label={template.name}
                        className="shrink-0"
                      />
                      <label
                        htmlFor={`campaign-template-${template.id}`}
                        className="cursor-pointer text-ui text-text"
                      >
                        {template.name}
                      </label>
                    </div>
                  ))}
                </RadioGroup>
              )}
            </fieldset>
          )}

          <div className="flex flex-wrap items-center gap-[var(--spacing-stack)]">
            <Button
              variant="primary"
              data-testid="new-campaign-continue"
              pending={pending}
              pendingLabel={t('creating')}
              onClick={submit}
            >
              {t('next')}
            </Button>
            <Link href={`${basePath}/campaigns`}>{t('cancel')}</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
