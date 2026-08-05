'use client';

import { useTranslations } from 'next-intl';
import type { EditorIssue } from '../../model/document-types';
import { findBlock } from '../../model/tree';
import { ISSUE_CODES } from '../../model/issue-codes';
import { useEditorState, useEditorStore } from '../../state/use-editor';
import { XCircle } from '../icons';

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

  return (
    <section
      aria-label={t('issues.title')}
      className="border-b border-border bg-danger-surface/40 px-4 py-2"
    >
      <p className="text-sm font-medium">{t('issues.errorCount', { count: issues.length })}</p>
      <ul className="mt-1 space-y-1">
        {issues.map((issue, index) => (
          <li key={`${issue.code}-${issue.pointer ?? index}`}>
            <button
              type="button"
              className="flex items-center gap-2 text-left text-xs underline"
              onClick={() => {
                if (issue.blockId) store.select(issue.blockId);
              }}
            >
              {/* Jedna ikona stačí: v pruhu jsou od téhle chvíle jen chyby. */}
              <XCircle aria-hidden className="size-3 text-danger-text" />
              <span>{textOf(issue)}</span>
              {/*
                Nález ze serveru, který platí o starší verzi dokumentu. Neschovává
                se, jen se u něj řekne pravda: uživatel právě něco upravil a tenhle
                nález o té úpravě ještě neví. Po uložení se přepočítá a popisek
                zmizí, nebo zmizí celý nález.
              */}
              {issue.stale ? (
                <span data-testid="issue-stale" className="text-text-muted">
                  {t('issues.stale')}
                </span>
              ) : null}
              {issue.blockId ? (
                <span className="text-text-muted">{t('issues.goToBlock')}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
