'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Card, CardTitle } from '@mlain/ui/components/card';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { CopyButton } from '@mlain/ui/components/copy-button';
import { PageHeader } from '@mlain/ui/components/page-header';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
import { ChevronRight, ExternalLink } from '@mlain/ui/icons';
import { CheckIcon } from '@/lib/ui/status-icons';
import { EMBED_CLASSES } from '@/features/public/embed-script';
import type { FormEmbedView } from './types';

type Strategy = 'self' | 'delegate' | 'hosted';

/**
 * Úchyty, na které jde cílit CSS. Berou se z JEDINÉHO ZDROJE, tedy z toho, co
 * skript opravdu vypisuje: dva seznamy vedle sebe by se rozešly a obrazovka by
 * uživateli slibovala třídy, které na formuláři nejsou.
 */
const EMBED_HOOKS = Object.values(EMBED_CLASSES);

/**
 * Ukázkové CSS. Je schválně STŘÍDMÉ a bez barev: má ukázat, kde se co chytá,
 * ne vnutit vzhled. Kdo chce víc, má výčet úchytů nad ním.
 */
const SAMPLE_CSS = `.ml-form { display: grid; gap: 1rem; max-width: 28rem; }
.ml-field { display: grid; gap: 0.25rem; }
.ml-label { font-weight: 600; }
.ml-input { padding: 0.5rem; border: 1px solid currentColor; border-radius: 0.25rem; }
.ml-field[data-ml-invalid="true"] .ml-input { border-width: 2px; }
.ml-consent { display: flex; gap: 0.5rem; align-items: start; }
.ml-error { margin: 0; font-weight: 600; }
.ml-button { padding: 0.625rem 1.25rem; cursor: pointer; }
.ml-form[data-ml-state="sending"] .ml-button { opacity: 0.6; }
.ml-success { font-weight: 600; }`;

/**
 * Kus kódu ke zkopírování. Popisek nad ním jsou mono verzálky, protože je to
 * nálepka, ne nadpis; samotný kód sedí na tlumené ploše se čtyřkovým rádiusem,
 * tedy tam, kde v návrhu bydlí všechny „technické" údaje.
 */
function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useTranslations('common.actions');
  return (
    <figure className="flex flex-col gap-[var(--spacing-inline)]">
      <figcaption className="meta-caps text-text-muted">{label}</figcaption>
      <pre className="overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface-muted p-[var(--spacing-stack)] font-mono text-meta text-text">
        <code>{code}</code>
      </pre>
      <div>
        <CopyButton value={code} label={t('copy')} copiedLabel={t('copied')} />
      </div>
    </figure>
  );
}

/**
 * Jedna volba „kdo formulář vloží".
 *
 * Popisek i vysvětlení jsou UVNITŘ `<label>`, takže je čtečka přečte jako
 * přístupný název přepínače. Není to jen vzhled: test na to přímo dohlíží,
 * protože u delegování musí zaznít, že e-mail za uživatele neodešleme.
 */
function StrategyChoice({
  value,
  id,
  label,
  hint,
  badge,
}: {
  value: Strategy;
  id: string;
  label: string;
  hint?: string;
  badge?: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <RadioGroupItem value={value} id={id} className="mt-1" />
      <span className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
          <span className="text-ui font-semibold text-text">{label}</span>
          {badge}
        </span>
        {hint === undefined ? null : <span className="text-meta text-text-muted">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * Obrazovka s kódem k vložení.
 *
 * VZHLED JE ODVOZENÝ Z DETAILU SEZNAMU (`Mlain Mailer - Seznamy.dc.html`):
 * hlavička s drobečky, karty po tématech a přepínače s povinným vysvětlením
 * u každé volby, přesně jako u „Potvrzení přihlášení". Široký sloupec s kódem
 * a užší postranní panel jsou mřížka `12 / 8 + 4` z rozcestníku; kód potřebuje
 * šířku, „Zkouška" je krátká a patří stranou, ne pod kód.
 *
 * Je to JEDINÉ MÍSTO V PRODUKTU, kde netechnický uživatel narazí na kód, a řídí se
 * proto stejnou strategií jako DNS záznamy: delegovat. Předvybraná volba je „Pošlu
 * to člověku, který spravuje náš web", ne „Vložím to sám".
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ ROZSAHEM. Plán chtěl u delegování tlačítko, které
 * návod rovnou odešle přes `POST /api/v1/forms/{id}/delegate`. Ten endpoint neexistuje
 * a systémovou poštu vlastní jiný plán, takže by se odesílání muselo obcházet v rozhraní.
 * Delegování proto zatím připraví celý text návodu i s kódem do schránky a uživatel ho
 * pošle svou poštou. Volba zůstává doporučená, mění se jen poslední krok.
 *
 * Blok „Zkouška" je stejně důležitý jako kód sám: bez něj uživatel neví, jestli
 * vložení fungovalo, dokud se někdo nepřihlásí.
 */
export function EmbedPanel({
  formId,
  formName,
  embed,
  basePath,
}: {
  formId: string;
  formName: string;
  embed: FormEmbedView;
  /** Cesta k sekci formulářů bez slugu projektu. */
  basePath: string;
}) {
  const t = useTranslations('contacts.embed');
  const tf = useTranslations('forms');
  const tcs = useTranslations('contacts');
  const ta = useTranslations('common.a11y');
  const format = useFormatter();
  const [strategy, setStrategy] = useState<Strategy>('delegate');

  const instructions = [
    tf('embed.instructionsIntro'),
    '',
    embed.script,
    '',
    tf('embed.instructionsOutro'),
  ].join('\n');

  return (
    <>
      <PageHeader
        title={t('title')}
        // Meta řádek nese jméno formuláře. Je to údaj, který se čte po znacích
        // a odlišuje jednu instanci téhle obrazovky od druhé, proto mono.
        meta={formName}
        breadcrumbs={
          <nav aria-label={ta('breadcrumbs')} className="flex flex-wrap items-center gap-2">
            <Link href={basePath} className="text-sm underline-offset-[3px]">
              {tcs('forms.title')}
            </Link>
            <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
            {/* Jméno formuláře se nemusí podařit načíst (detail je zvlášť), pak se
                z drobečků vynechá, místo aby tam zel prázdný odkaz. */}
            {formName === '' ? null : (
              <>
                <Link
                  href={`${basePath}/${formId}`}
                  className="min-w-0 truncate text-sm underline-offset-[3px]"
                >
                  {formName}
                </Link>
                <ChevronRight aria-hidden className="icon-xs shrink-0 text-border-strong" />
              </>
            )}
            <span className="min-w-0 truncate font-mono text-meta text-text-muted">
              {t('title')}
            </span>
          </nav>
        }
      />

      <div className="grid grid-cols-12 gap-[var(--spacing-gutter)]">
        <div className="col-span-12 flex flex-col gap-[var(--spacing-gutter)] lg:col-span-8">
          <Card gap="gutter">
            <CardTitle as="h2">{t('who')}</CardTitle>
            <RadioGroup
              value={strategy}
              onValueChange={(next: string) => setStrategy(next as Strategy)}
              aria-label={t('who')}
              className="gap-[var(--spacing-stack)]"
            >
              <StrategyChoice
                value="delegate"
                id="embed-delegate"
                label={t('whoDelegate')}
                // Vlastní věta místo `contacts.embed.whoDelegateHint`. Ta slibuje
                // „připravíme e-mail, vy jen doplníte adresu", což je do doby, než
                // bude endpoint na odeslání, nepravda. Popisek volby musí říkat,
                // co obrazovka doopravdy udělá.
                hint={tf('embed.delegateNote')}
                badge={
                  <Badge tone="success" icon={CheckIcon}>
                    {t('whoDelegateBadge')}
                  </Badge>
                }
              />
              <StrategyChoice value="self" id="embed-self" label={t('whoSelf')} />
              <StrategyChoice
                value="hosted"
                id="embed-hosted"
                label={t('whoHosted')}
                hint={t('whoHostedHint')}
              />
            </RadioGroup>
          </Card>

          {strategy === 'delegate' && (
            <Card gap="gutter" data-testid="embed-delegate">
              <CardTitle as="h2">{t('howTo')}</CardTitle>
              {/* Co se zkopíruje, stojí u volby výš; tady už zbývá jen samotný krok. */}
              <div>
                <CopyButton
                  value={instructions}
                  label={tf('embed.delegateCopy')}
                  copiedLabel={tf('embed.delegateCopy')}
                />
              </div>
            </Card>
          )}

          {strategy === 'self' && (
            <Card gap="gutter" data-testid="embed-self">
              <CardTitle as="h2">{t('howTo')}</CardTitle>
              <CodeBlock code={embed.script} label={t('variantScript')} />
              <p className="text-meta text-text-muted">{t('variantScriptHint')}</p>

              {/*
               * Formulář nenese ani jeden styl, takže bez tohohle bloku by na webu
               * vypadal jako neostylovaný a nikdo by nevěděl, na co cílit. Ukázkové
               * CSS je ke zkopírování, ne k opisování z obrázku.
               */}
              <Card as="div" tone="muted" padding="sm" gap="stack" data-testid="embed-styling">
                <h3 className="text-base font-semibold text-text">{tf('embed.stylingTitle')}</h3>
                <p className="text-meta text-text-muted">{tf('embed.stylingBody')}</p>
                {/* Názvy tříd jsou kód, proto mono na tlumené ploše se čtyřkovým
                    rádiusem: stejný tvar jako odznak, jen bez významu stavu. */}
                <ul className="flex flex-wrap gap-[var(--spacing-inline)]">
                  {EMBED_HOOKS.map((hook) => (
                    <li
                      key={hook}
                      className="rounded-[var(--radius-control)] border border-border bg-surface px-2 py-1 font-mono text-micro text-text"
                    >
                      .{hook}
                    </li>
                  ))}
                </ul>
                <p className="text-meta text-text-muted">{tf('embed.stylingStates')}</p>
                <CodeBlock code={SAMPLE_CSS} label={tf('embed.stylingSample')} />
                <p className="text-meta text-text-muted">{tf('embed.stylingHosted')}</p>
              </Card>

              {/*
                Varianty jsou DVĚ, ne tři. Třetí, „čistě HTML formulář", zmizela:
                statický kód na cizím webu nemá jak získat nonce, takže odeslání
                tiše zahazovala a návštěvník přitom viděl děkovací stránku. Kdo chce
                plnou kontrolu nad vzhledem, má ji u skriptové varianty; kdo nemůže
                použít JavaScript, má rámeček.
              */}
              <Collapsible summary={t('otherVariants')}>
                <div className="flex flex-col gap-[var(--spacing-gutter)] pt-2">
                  <CodeBlock code={embed.iframe} label={t('variantIframe')} />
                  <p className="text-meta text-text-muted">{t('variantIframeHint')}</p>
                  <p className="text-meta text-text-muted">{tf('embed.variantIframeNoJs')}</p>
                </div>
              </Collapsible>
            </Card>
          )}

          {strategy === 'hosted' && (
            <Card gap="gutter" data-testid="embed-hosted">
              <CardTitle as="h2">{t('hostedUrl')}</CardTitle>
              {/* Adresa se čte po znacích, proto mono na tlumené ploše. */}
              <p className="rounded-[var(--radius-control)] border border-border bg-surface-muted px-[var(--spacing-stack)] py-[var(--spacing-inline)] font-mono text-meta break-all text-text">
                {embed.hosted_url}
              </p>
              <div>
                <CopyButton value={embed.hosted_url} label={t('copy')} copiedLabel={t('copied')} />
              </div>
            </Card>
          )}
        </div>

        <Card
          as="aside"
          gap="gutter"
          data-testid="embed-test"
          className="col-span-12 self-start lg:col-span-4"
        >
          <CardTitle as="h2">{t('testTitle')}</CardTitle>
          <p className="text-meta text-text-muted">
            {embed.first_submission_at === null
              ? t('testEmpty')
              : t('testDone', {
                  date: format.dateTime(new Date(embed.first_submission_at), 'short'),
                })}
          </p>
          <a
            href={embed.hosted_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-[var(--spacing-inline)] text-ui"
            data-testid="embed-preview-link"
          >
            <ExternalLink aria-hidden className="icon-sm shrink-0" />
            {t('testPreview')}
          </a>
        </Card>
      </div>
    </>
  );
}
