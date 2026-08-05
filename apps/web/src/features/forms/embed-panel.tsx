'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@mlain/i18n/navigation';
import { Badge } from '@mlain/ui/components/badge';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { CopyButton } from '@mlain/ui/components/copy-button';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';
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

function CodeBlock({ code, label }: { code: string; label: string }) {
  const t = useTranslations('common.actions');
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-text">{label}</figcaption>
      <pre className="overflow-x-auto rounded-[var(--radius-control)] bg-surface-muted p-3 text-xs">
        <code>{code}</code>
      </pre>
      <div>
        <CopyButton value={code} label={t('copy')} copiedLabel={t('copied')} />
      </div>
    </figure>
  );
}

/**
 * Obrazovka s kódem k vložení.
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
 * Blok „Zkouška" dole je stejně důležitý jako kód sám: bez něj uživatel neví, jestli
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
    <section className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`${basePath}/${formId}`} className="text-sm text-text-muted underline">
          {tf('editor.back')}
        </Link>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="text-sm text-text-muted">{formName}</p>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-text">{t('who')}</legend>
        <RadioGroup
          value={strategy}
          onValueChange={(next: string) => setStrategy(next as Strategy)}
          aria-label={t('who')}
        >
          <label className="flex items-start gap-3 text-sm text-text">
            <RadioGroupItem value="delegate" id="embed-delegate" />
            <span>
              {t('whoDelegate')}{' '}
              <Badge tone="success" icon={CheckIcon}>
                {t('whoDelegateBadge')}
              </Badge>
              {/* Vlastní věta místo `contacts.embed.whoDelegateHint`. Ta slibuje
                  „připravíme e-mail, vy jen doplníte adresu", což je do doby, než
                  bude endpoint na odeslání, nepravda. Popisek volby musí říkat,
                  co obrazovka doopravdy udělá. */}
              <span className="block text-text-muted">{tf('embed.delegateNote')}</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-text">
            <RadioGroupItem value="self" id="embed-self" />
            <span>{t('whoSelf')}</span>
          </label>
          <label className="flex items-start gap-3 text-sm text-text">
            <RadioGroupItem value="hosted" id="embed-hosted" />
            <span>
              {t('whoHosted')}
              <span className="block text-text-muted">{t('whoHostedHint')}</span>
            </span>
          </label>
        </RadioGroup>
      </fieldset>

      {strategy === 'delegate' && (
        <div className="flex flex-col gap-3" data-testid="embed-delegate">
          <div>
            <CopyButton
              value={instructions}
              label={tf('embed.delegateCopy')}
              copiedLabel={tf('embed.delegateCopy')}
            />
          </div>
        </div>
      )}

      {strategy === 'self' && (
        <div className="flex flex-col gap-4" data-testid="embed-self">
          <h2 className="text-lg font-medium text-text">{t('howTo')}</h2>
          <CodeBlock code={embed.script} label={t('variantScript')} />
          <p className="text-sm text-text-muted">{t('variantScriptHint')}</p>

          {/*
           * Formulář nenese ani jeden styl, takže bez tohohle bloku by na webu
           * vypadal jako neostylovaný a nikdo by nevěděl, na co cílit. Ukázkové
           * CSS je ke zkopírování, ne k opisování z obrázku.
           */}
          <div className="flex flex-col gap-2" data-testid="embed-styling">
            <h3 className="text-sm font-medium text-text">{tf('embed.stylingTitle')}</h3>
            <p className="text-sm text-text-muted">{tf('embed.stylingBody')}</p>
            <ul className="flex flex-wrap gap-2 text-xs">
              {EMBED_HOOKS.map((hook) => (
                <li
                  key={hook}
                  className="rounded-[var(--radius-control)] bg-surface-muted px-2 py-1"
                >
                  .{hook}
                </li>
              ))}
            </ul>
            <p className="text-sm text-text-muted">{tf('embed.stylingStates')}</p>
            <CodeBlock code={SAMPLE_CSS} label={tf('embed.stylingSample')} />
            <p className="text-sm text-text-muted">{tf('embed.stylingHosted')}</p>
          </div>

          {/*
            Varianty jsou DVĚ, ne tři. Třetí, „čistě HTML formulář", zmizela:
            statický kód na cizím webu nemá jak získat nonce, takže odeslání
            tiše zahazovala a návštěvník přitom viděl děkovací stránku. Kdo chce
            plnou kontrolu nad vzhledem, má ji u skriptové varianty; kdo nemůže
            použít JavaScript, má rámeček.
          */}
          <Collapsible summary={t('otherVariants')}>
            <div className="flex flex-col gap-4 pt-2">
              <CodeBlock code={embed.iframe} label={t('variantIframe')} />
              <p className="text-sm text-text-muted">{t('variantIframeHint')}</p>
              <p className="text-sm text-text-muted">{tf('embed.variantIframeNoJs')}</p>
            </div>
          </Collapsible>
        </div>
      )}

      {strategy === 'hosted' && (
        <div className="flex flex-col gap-3" data-testid="embed-hosted">
          <h2 className="text-lg font-medium text-text">{t('hostedUrl')}</h2>
          <p className="break-all text-sm text-text">{embed.hosted_url}</p>
          <div>
            <CopyButton value={embed.hosted_url} label={t('copy')} copiedLabel={t('copied')} />
          </div>
        </div>
      )}

      <section
        className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border p-5"
        data-testid="embed-test"
      >
        <h2 className="text-lg font-medium text-text">{t('testTitle')}</h2>
        <p className="text-sm text-text-muted">
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
          className="text-sm underline"
          data-testid="embed-preview-link"
        >
          {t('testPreview')}
        </a>
      </section>
    </section>
  );
}
