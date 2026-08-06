'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useEditorState } from '../../state/use-editor';

/** Stav ukládání patří do hlavičky. Toast by se objevoval každé dvě sekundy (část 6, 8.5.1). */
export function SaveStatus(props: {
  /**
   * Rozjetá kampaň se needituje. Slib „ukládá se průběžně samo" by tam byl
   * lež: neuloží se nic, protože se ani nic nedá změnit. Ostatní hlášení
   * (ukládáme, uloženo, chyba) v takovém editoru nikdy nenastanou.
   */
  readOnly?: boolean | undefined;
}) {
  const t = useTranslations('editor');
  const format = useFormatter();
  const status = useEditorState((state) => state.status);
  const saveIssue = useEditorState((state) => state.saveIssue);
  const savedAt = useEditorState((state) => state.savedAt);
  const isDirty = useEditorState((state) => state.isDirty);

  const text =
    status === 'saving'
      ? t('header.saving')
      : status === 'invalid'
        ? // Věta ze serveru má přednost před obecnou: doménová závora v ní
          // posílá instrukci, co opravit, a obecné „dokument je neplatný"
          // by z opravitelné chyby udělalo záhadu.
          (saveIssue ?? t('header.saveInvalid'))
        : status === 'error'
          ? t('header.saveFailed')
          : status === 'conflict'
            ? // NE `state.conflictTitle`. Ten říká jen „šablonu mezitím upravil
              // někdo jiný", což je popis cizí akce, ne informace pro toho, kdo
              // tu sedí. Od chvíle, kdy se po konfliktu přestalo ukládat
              // (`use-autosave.ts`), je tohle POSLEDNÍ hlášení, které uživatel
              // uvidí: musí z něj poznat, že jeho úpravy nejsou uložené a že
              // reload je zahodí, takže si je má napřed zkopírovat.
              t('header.saveConflict')
            : isDirty
              ? t('header.unsaved')
              : savedAt
                ? t('header.saved', {
                    time: format.dateTime(new Date(savedAt), { timeStyle: 'short' }),
                  })
                : // ČERSTVĚ OTEVŘENÝ EDITOR NESMÍ MLČET.
                  //
                  // Dokud uživatel nic nezmění, je `status` `idle`, `isDirty`
                  // `false` a `savedAt` `null`, takže tady dřív stál prázdný
                  // řetězec. Obrazovka tím o ukládání neřekla vůbec nic
                  // a jedinou jistotou, kterou uživatel měl, bylo tlačítko
                  // „Uložit". Ukládání přitom běží samo (`useAutosave`,
                  // odklad 1,5 s), jen se to nikde nedalo dočíst.
                  props.readOnly
                  ? ''
                  : t('header.autosave');

  /*
   * ŽIVÁ OBLAST, ale zdrženlivá.
   *
   * `aria-live="polite"` znamená, že čtečka změnu ohlásí, až domluví, tedy
   * uživatele nepřeruší uprostřed psaní. `aria-atomic` k tomu říká, ať přečte
   * celou větu, ne jen to slovo, které se změnilo: bez toho se z „Uloženo
   * v 10:24" po další minutě ohlásí jen „10:25" a to samo o sobě nic neříká.
   *
   * Ohlašuje se STAV, ne úhozy. Text se během psaní nemění, jen jednou přejde
   * na „Neuložené změny" a po uložení na „Uloženo v {time}", takže na jednu
   * dávku úprav padnou tři ohlášení, ne jedno na klávesu.
   */
  return (
    <p
      data-testid="save-status"
      aria-live="polite"
      aria-atomic="true"
      className="text-meta text-text-muted"
    >
      {text}
    </p>
  );
}
