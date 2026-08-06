'use client';

import { Alert } from '@mlain/ui/patterns/states';
import { useTranslations } from 'next-intl';
import type { EditorIssue } from '../../model/document-types';
import { findBlock } from '../../model/tree';
import { ISSUE_CODES } from '../../model/issue-codes';
import { useEditorState, useEditorStore } from '../../state/use-editor';

const KNOWN: ReadonlySet<string> = new Set(ISSUE_CODES);

export function IssueBar() {
  const t = useTranslations('editor');
  const store = useEditorStore();
  const all = useEditorState((state) => state.issues);
  const document = useEditorState((state) => state.document);

  /*
   * Nález o chybějícím obrázku se u nového bloku ZAMLČUJE.
   *
   * Server kontroluje `assetIds.has(props.assetId)`, a nově přidaný blok má
   * `assetId: ""`, takže mu odpoví `content_asset_not_found`, tedy česky
   * „Obrázek už v knihovně není." To je věta o obrázku, který tam kdysi byl.
   * Uživatel žádný nevybral, takže z hlášky nepochopil, co má dělat, a ještě
   * to vypadalo jako porucha aplikace.
   *
   * Nález se neztrácí, jen se přesouvá tam, kde dává smysl: blok na plátně
   * sám nabídne „Klepnutím vyberte obrázek". Blok, který obrázek MĚL a ten
   * z knihovny zmizel, hlášku dostane dál, protože jeho `assetId` prázdné není.
   */
  const issues = all.filter((issue) => {
    /*
     * VAROVÁNÍ SE NEVYKRESLUJÍ, jen chyby.
     *
     * Rozhodnutí zadavatele: „Chyby tam nech, ale upozornění nechci zobrazovat
     * žádné." Věty jako „Text na tomhle pozadí je špatně čitelný." se hlásily
     * u obsahu, který uživatel schválně chtěl, a nedaly se odbýt.
     *
     * Hlavní filtr je na vstupu do stavu (`use-validation.ts`), takže se sem
     * varování normálně vůbec nedostanou. Tahle podmínka je pojistka pro
     * vykreslení s ručně dodanými nálezy: bez ní by pruh varování ukázal,
     * a ještě s ikonou chyby, protože jinou už nekreslí.
     */
    if (issue.severity !== 'error') return false;
    if (issue.code !== 'content_asset_not_found' || !issue.blockId) return true;
    const found = findBlock(document, issue.blockId);
    return found?.block.props.assetId !== '';
  });

  /**
   * Text nálezu. Klientská validace vrací **kód a parametry**, ne hotovou větu,
   * aby šla přeložit a neskládala se ze zřetězených fragmentů (kritérium 71).
   *
   * Neznámý kód se nezahazuje: zobrazí se `detail` ze serveru, přesně jak žádá
   * kritérium 76. Až úplně nakonec se ukáže holý kód, aby uživatel měl co poslat
   * podpoře, i kdyby server neposlal nic.
   */
  const textOf = (issue: EditorIssue): string => {
    if (KNOWN.has(issue.code)) {
      // `as never` na klíči i na parametrech: `useTranslations` má klíče
      // i jejich sloty odvozené z katalogu a kód nálezu je až za běhu.
      return t(`issue.${issue.code}` as never, (issue.params ?? {}) as never);
    }
    return issue.message ?? issue.code;
  };

  /*
   * Bez chyb tu není VŮBEC NIC, ani věta „žádná chyba".
   *
   * Pruh, který existuje jen proto, aby oznámil, že je všechno v pořádku, je
   * šum: ubírá místo plátnu a uživatel si na něj zvykne natolik, že si ho
   * nevšimne ani ve chvíli, kdy v něm konečně něco stojí.
   */
  if (issues.length === 0) return null;

  /*
   * VZHLED BERE `Alert`, ne vlastní pruh.
   *
   * Návrh kreslí chybu nad plátnem přesně tak, jak ji `Alert` už umí: hairline
   * rámeček, silná 3px linka vlevo v barvě nebezpečí, rádius 10 px, plocha
   * `danger-surface` a ikona. Dřív tu stál vlastní `<section>` s pozadím
   * `bg-danger-surface/40`, tedy plocha s průhledností, kterou systém nezná
   * a která na tmavém motivu vycházela jinak než všude jinde.
   *
   * Počet chyb je mono verzálky, jak ho má návrh („1 CHYBA"), a věty pod ním
   * jsou 15px text. Zůstává, že se dá na nález kliknout a skočit na blok.
   */
  return (
    <Alert tone="error" aria-label={t('issues.title')} data-testid="issue-bar">
      <p className="meta-caps text-danger-text">
        {t('issues.errorCount', { count: issues.length })}
      </p>
      <ul className="flex flex-col gap-1.5">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.pointer ?? index}`}>
            <button
              type="button"
              className={[
                'flex items-start gap-[var(--spacing-inline)] text-left text-ui text-text',
                'underline underline-offset-[var(--underline-offset)]',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
              ].join(' ')}
              onClick={() => {
                if (issue.blockId) store.select(issue.blockId);
              }}
            >
              {/*
                Ikona je JEDNA, a to ta na celém pruhu. Původní znění mělo ještě
                jednu u každého řádku, což s ikonou hlášky dávalo dvě vedle sebe
                a nic to nesdělovalo: v pruhu jsou od téhle chvíle jen chyby,
                takže se řádky mezi sebou ikonou nerozlišují.
              */}
              <span>{textOf(issue)}</span>
              {/*
                Nález ze serveru, který platí o starší verzi dokumentu. Neschovává
                se, jen se u něj řekne pravda: uživatel právě něco upravil a tenhle
                nález o té úpravě ještě neví. Po uložení se přepočítá a popisek
                zmizí, nebo zmizí celý nález.
              */}
              {issue.stale ? (
                <span data-testid="issue-stale" className="font-mono text-label text-text-muted">
                  {t('issues.stale')}
                </span>
              ) : null}
              {issue.blockId ? (
                <span className="font-mono text-label text-text-muted">
                  {t('issues.goToBlock')}
                </span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
