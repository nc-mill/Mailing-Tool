'use client';

import { Card, CardTitle } from '@mlain/ui/components/card';
import { Collapsible } from '@mlain/ui/components/collapsible';
import { useLocale, useTranslations } from 'next-intl';
import { sampleCsv, sampleCsvHref } from './sample-csv';

/** Odrážkový seznam nápovědy. Čtyřikrát totéž, tak ať to není čtyřikrát opsané. */
function GuideList({ items }: { items: string[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-meta text-text-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

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
      <Card
        as="div"
        tone="muted"
        padding="md"
        gap="gutter"
        className="max-w-[var(--container-prose)] text-ui text-text"
      >
        <p>{t('guide.lead')}</p>

        {/* Vzor je první, ne poslední: kdo si ho stáhne a přepíše, nemusí číst nic dál. */}
        <p>
          <a href={sampleCsvHref(sample)} download={sample.filename} className="font-semibold">
            {t('guide.sampleDownload')}
          </a>
        </p>
        <p className="text-meta text-text-muted">{t('guide.sampleHint')}</p>

        <CardTitle as="h3">{t('guide.columnsTitle')}</CardTitle>
        <p className="text-meta text-text-muted">{t('guide.columnsIntro')}</p>
        <p className="text-meta text-text-muted">{t('guide.columnsCustom')}</p>

        {/* Tabulka je široká, takže se posouvá uvnitř vlastního rámu. Stránka
            se vodorovně posouvat nesmí. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left">
            <caption className="sr-only">{t('guide.columnsTitle')}</caption>
            <thead>
              <tr>
                <th scope="col" className="meta-caps pr-3 pb-1.5 text-text-muted">
                  {t('guide.columnsHeaderField')}
                </th>
                <th scope="col" className="meta-caps pr-3 pb-1.5 text-text-muted">
                  {t('guide.columnsHeaderNames')}
                </th>
                <th scope="col" className="meta-caps pb-1.5 text-text-muted">
                  {t('guide.columnsHeaderNote')}
                </th>
              </tr>
            </thead>
            <tbody>
              {columns.map((column) => (
                <tr key={column} className="align-top">
                  <th scope="row" className="pr-3 pb-2 text-ui font-semibold">
                    {t(`guide.columns.${column}.field`)}
                  </th>
                  {/* Přijímané názvy sloupců se opisují do souboru znak po znaku,
                      takže mono. */}
                  <td className="pr-3 pb-2 font-mono text-meta text-text-muted">
                    {t(`guide.columns.${column}.names`)}
                  </td>
                  <td className="pb-2 text-meta text-text-muted">
                    {t(`guide.columns.${column}.note`)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CardTitle as="h3">{t('guide.formatTitle')}</CardTitle>
        <GuideList
          items={[
            t('guide.formatDelimiter'),
            t('guide.formatEncoding'),
            t('guide.formatQuotes'),
            t('guide.formatHeader'),
          ]}
        />

        <CardTitle as="h3">{t('guide.limitsTitle')}</CardTitle>
        <GuideList
          items={[
            t('guide.limitsFile'),
            t('guide.limitsRows'),
            t('guide.limitsColumns'),
            t('guide.limitsCell'),
          ]}
        />

        <CardTitle as="h3">{t('guide.sourcesTitle')}</CardTitle>
        <GuideList
          items={[t('guide.sourcesExcel'), t('guide.sourcesSheets'), t('guide.sourcesOther')]}
        />

        <CardTitle as="h3">{t('guide.missingTitle')}</CardTitle>
        <GuideList items={[t('guide.missingXlsx'), t('guide.missingConsentColumns')]} />
      </Card>
    </Collapsible>
  );
}
