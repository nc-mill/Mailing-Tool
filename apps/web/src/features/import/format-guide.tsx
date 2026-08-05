'use client';

import { Collapsible } from '@mlain/ui/components/collapsible';
import { useLocale, useTranslations } from 'next-intl';
import { sampleCsv, sampleCsvHref } from './sample-csv';

/**
 * Nápověda k formátu souboru.
 *
 * PROČ ROZBALOVACÍ PANEL, A NE DIALOG NEBO SAMOSTATNÁ STRÁNKA: nápovědu člověk
 * čte VEDLE toho, co dělá, tedy zatímco chystá soubor a dívá se na plochu pro
 * nahrání. Dialog by plochu zakryl a stránka by ho z průvodce odvedla pryč.
 * Panel se navíc dá otevřít a nechat otevřený, dokud soubor nesedí.
 *
 * Každé tvrzení odpovídá kódu, který soubor doopravdy čte:
 *   - názvy sloupců: `HEADER_DICTIONARY` v `packages/core/src/contacts/import/mapping.ts`
 *   - oddělovače: `CANDIDATES` v `dialect.ts`
 *   - kódování: `CANDIDATES` a `detectEncoding()` v `encoding.ts`
 *   - limity: `IMPORT_MAX_*` v `packages/core/src/config/schema-domains.ts`
 * Co neumíme, je v nápovědě napsané taky. Slib, který kód neplní, stojí víc
 * než chybějící věta: uživatel podle něj připraví soubor, který neprojde.
 */
export function FormatGuide() {
  const t = useTranslations('import');
  const locale = useLocale();
  const sample = sampleCsv(locale);

  const columns = [
    'email',
    'firstName',
    'lastName',
    'fullName',
    'titlePrefix',
    'titleSuffix',
    'gender',
    'locale',
    'tag',
  ] as const;

  return (
    <Collapsible summary={t('guide.trigger')} className="self-start">
      <div className="flex max-w-3xl flex-col gap-4 rounded-[var(--radius-surface)] border border-border bg-surface-muted p-4 text-sm text-text">
        <p>{t('guide.lead')}</p>

        {/* Vzor je první, ne poslední: kdo si ho stáhne a přepíše, nemusí číst nic dál. */}
        <p>
          <a
            className="font-medium underline"
            href={sampleCsvHref(sample)}
            download={sample.filename}
          >
            {t('guide.sampleDownload')}
          </a>
        </p>
        <p className="text-text-muted">{t('guide.sampleHint')}</p>

        <h3 className="font-semibold">{t('guide.columnsTitle')}</h3>
        <p className="text-text-muted">{t('guide.columnsIntro')}</p>
        <p className="text-text-muted">{t('guide.columnsCustom')}</p>
        <table className="w-full text-left">
          <caption className="sr-only">{t('guide.columnsTitle')}</caption>
          <thead>
            <tr>
              <th scope="col" className="pr-3 pb-1 font-medium">
                {t('guide.columnsHeaderField')}
              </th>
              <th scope="col" className="pr-3 pb-1 font-medium">
                {t('guide.columnsHeaderNames')}
              </th>
              <th scope="col" className="pb-1 font-medium">
                {t('guide.columnsHeaderNote')}
              </th>
            </tr>
          </thead>
          <tbody>
            {columns.map((column) => (
              <tr key={column} className="align-top">
                <th scope="row" className="pr-3 pb-2 font-normal">
                  {t(`guide.columns.${column}.field`)}
                </th>
                <td className="pr-3 pb-2 text-text-muted">{t(`guide.columns.${column}.names`)}</td>
                <td className="pb-2 text-text-muted">{t(`guide.columns.${column}.note`)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h3 className="font-semibold">{t('guide.formatTitle')}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-text-muted">
          <li>{t('guide.formatDelimiter')}</li>
          <li>{t('guide.formatEncoding')}</li>
          <li>{t('guide.formatQuotes')}</li>
          <li>{t('guide.formatHeader')}</li>
        </ul>

        <h3 className="font-semibold">{t('guide.limitsTitle')}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-text-muted">
          <li>{t('guide.limitsFile')}</li>
          <li>{t('guide.limitsRows')}</li>
          <li>{t('guide.limitsColumns')}</li>
          <li>{t('guide.limitsCell')}</li>
        </ul>

        <h3 className="font-semibold">{t('guide.sourcesTitle')}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-text-muted">
          <li>{t('guide.sourcesExcel')}</li>
          <li>{t('guide.sourcesSheets')}</li>
          <li>{t('guide.sourcesOther')}</li>
        </ul>

        <h3 className="font-semibold">{t('guide.missingTitle')}</h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-text-muted">
          <li>{t('guide.missingXlsx')}</li>
          <li>{t('guide.missingConsentColumns')}</li>
        </ul>
      </div>
    </Collapsible>
  );
}
