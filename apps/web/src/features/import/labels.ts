import type { FileUploadLabels } from '@mlain/ui/patterns/file-upload';
import type { WizardLabels } from '@mlain/ui/patterns/wizard';

/**
 * Překladač katalogu. Do komponent se předává `t` z `useTranslations('import')`,
 * v testech se skládá přímo nad JSON katalogem.
 *
 * ODCHYLKA OD PLÁNU: plán psal `uploadLabels('cs')`, tedy funkci, která si
 * katalog načte sama podle jazyka. Tady bere překladač, protože jinak by se
 * katalog obou jazyků dostal do klientského balíku, a to je přesně to, čemu se
 * next-intl vyhýbá. Vlastnost, kvůli které to plán chtěl, zůstává: konformanční
 * test hledá v DOM texty Z KATALOGU, ne natvrdo napsané řetězce.
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

/**
 * Popisky K4. Jména propů se liší od plánu, protože komponentu vlastní P05
 * a její typ `FileUploadLabels` je závazný: `chooseFile` místo `browse`,
 * `fileInput` místo `field`.
 */
export function uploadLabels(t: Translate): FileUploadLabels {
  return {
    dropzone: t('upload.dropzone'),
    chooseFile: t('upload.browse'),
    fileInput: t('upload.field'),
    cancel: t('upload.cancel'),
    progress: (percent) => t('upload.progress', { percent }),
    tooLarge: (limit) => t('upload.tooLargeShort', { limit }),
    wrongType: t('upload.wrongType'),
    selectedFile: (name) => t('upload.selectedFile', { name }),
  };
}

/** Popisky K3. `stepOf` je funkce, protože věta „krok 3 z 6" je jedna zpráva. */
export function wizardLabels(t: Translate): WizardLabels {
  return {
    stepOf: (current, total) => t('wizard.stepAnnouncement', { current, total }),
    back: t('wizard.back'),
    next: t('wizard.next'),
    destructiveBackTitle: t('wizard.destructiveBackTitle'),
    destructiveBackConfirm: t('wizard.destructiveBackConfirm'),
    destructiveBackRetreat: t('wizard.destructiveBackRetreat'),
  };
}

/** Jedenáct kódů varování v pořadí, ve kterém se zobrazují na výsledku. */
export const WARNING_CODES = [
  'excel_serial_date_assumed',
  'number_format_ambiguous',
  'value_truncated',
  'name_split_low_confidence',
  'vietnamese_order_assumed',
  'gender_unknown',
  'gender_conflict',
  'vocative_low_confidence',
  'non_latin_script',
  'suppressed_skipped',
  'trailing_fields_padded',
] as const;

export type WarningCode = (typeof WARNING_CODES)[number];

/**
 * Číslo v českém tvaru s pevnou mezerou po tisících. Jazyk se předává, nikdy
 * se nebere z prostředí: server a klient by jinak mohly formátovat jinak
 * a React by na tom nesouhlas hydratace nesrovnal.
 */
export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value);
}
