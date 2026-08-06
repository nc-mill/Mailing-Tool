'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Alert } from '@mlain/ui/patterns/states';
import { BackupRunButton } from './backup-run-button';

export type BackupListEntry = {
  name: string;
  createdAt: string;
  bytes: number;
  contacts: number;
  verifiedAt: string | null;
  verifiedOk: boolean | null;
};

/** Sloupce s číslem se zarovnávají doprava, aby šly řády porovnat pohledem. */
const NUMBER_CELL = 'px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] text-right font-mono';

/**
 * Seznam záloh.
 *
 * VZHLED podle tabulky ze základu (2.6): hlavička na tlumené ploše s `meta-caps`
 * v tlumeném textu a okrajem 12/20, řádky s okrajem 14/20, spodní hairline
 * linkou a podbarvením při najetí. Do 5. 8. 2026 tu stála úplně holá `<table>`
 * bez jediné třídy, takže obrazovka vypadala jako výchozí HTML uprostřed
 * navrženého nastavení.
 *
 * ČÍSLA A ČASY JDOU PŘES `useFormatter`, ne přes `toLocaleString()` bez
 * argumentů. Ten se řídí locale prostředí, ne jazykem aplikace, takže
 * v prohlížeči s anglickým systémem vypisoval „8/5/2026, 5:00:20 AM“ i v české
 * aplikaci. Počet kontaktů měl naopak natvrdo `'cs-CZ'`, takže v anglické
 * aplikaci ukazoval české oddělovače. Obojí je teď na jazyku rozhraní.
 *
 * PŮVODNÍ ODCHYLKA OD PLÁNU JE ZRUŠENÁ. Komentář tu léta tvrdil, že `Alert`
 * v `packages/ui` neexistuje, a varování o klíči se proto kreslilo ručně
 * třídami `border-warning-border` a `bg-warning-bg`. **Ty dva tokeny v
 * `tokens.css` nikdy nebyly**, takže varování nemělo ani rámeček, ani plochu
 * a splývalo s okolím. `Alert` dneska existuje a tón `warning` je přesně to,
 * co plán chtěl.
 *
 * Varování je vidět VŽDY, i u prázdného seznamu: záloha bez keyringu je
 * obnovitelná jen zdánlivě. Data se vrátí, ale uložené přístupy nikdo
 * nedešifruje a otisky smazaných adres přestanou platit.
 */
export function BackupList({ entries }: { entries: readonly BackupListEntry[] }) {
  const t = useTranslations('onboarding.backups');
  const format = useFormatter();

  // `role="note"` přebíjí `role="alert"`, které si `Alert` nasazuje u varovného
  // tónu. Je to záměr: tenhle text visí na stránce trvale, není to reakce na
  // akci, a čtečka by ho jinak vykřikla při každém překreslení.
  const keyWarning = (
    <Alert tone="warning" role="note">
      {t('keyWarning')}
    </Alert>
  );

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-start gap-[var(--spacing-gutter)]">
        {keyWarning}
        <p className="text-ui text-text-muted">{t('empty')}</p>
        <BackupRunButton />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-[var(--spacing-gutter)]">
      {keyWarning}

      <div className="w-full overflow-x-auto">
        <table className="w-full border-collapse text-left text-ui">
          <caption className="sr-only">{t('title')}</caption>
          <thead>
            <tr className="bg-surface-muted">
              <th
                scope="col"
                className="meta-caps px-[var(--spacing-row-x)] py-3 text-left text-text-muted"
              >
                {t('columnCreated')}
              </th>
              <th
                scope="col"
                className="meta-caps px-[var(--spacing-row-x)] py-3 text-right text-text-muted"
              >
                {t('columnSize')}
              </th>
              <th
                scope="col"
                className="meta-caps px-[var(--spacing-row-x)] py-3 text-right text-text-muted"
              >
                {t('columnRows')}
              </th>
              <th
                scope="col"
                className="meta-caps px-[var(--spacing-row-x)] py-3 text-left text-text-muted"
              >
                {t('columnVerified')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.name} className="border-b border-border hover:bg-surface-muted">
                <th
                  scope="row"
                  className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] text-left font-mono font-normal whitespace-nowrap"
                >
                  {format.dateTime(new Date(e.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </th>
                <td className={NUMBER_CELL}>
                  {/* Megabajty, ne bajty: u zálohy nikoho nezajímá poslední
                      číslice, zajímá ho řád. */}
                  {t('sizeMegabytes', { size: Math.round(e.bytes / 1_000_000) })}
                </td>
                <td className={NUMBER_CELL}>{format.number(e.contacts)}</td>
                <td className="px-[var(--spacing-row-x)] py-[var(--spacing-row-y)] text-text-muted">
                  {e.verifiedAt === null
                    ? t('neverVerified')
                    : e.verifiedOk
                      ? t('verifiedOk', {
                          when: format.dateTime(new Date(e.verifiedAt), { dateStyle: 'medium' }),
                        })
                      : t('verifiedFailed', {
                          when: format.dateTime(new Date(e.verifiedAt), { dateStyle: 'medium' }),
                        })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BackupRunButton />
    </div>
  );
}
