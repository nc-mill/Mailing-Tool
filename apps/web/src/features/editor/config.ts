/** Vypnutím se editor přepne do degradovaného režimu podle části 3, 3.3.3: bloky se přesouvají
 *  jen klávesnicí a tlačítky v ovládání bloku. Editor zůstane plně použitelný. */
export const EDITOR_DND_ENABLED = true;

export const AUTOSAVE_DEBOUNCE_MS = 1500;
export const UNLOAD_GUARD_MS = 2000; // kritérium 7 části 6
export const HISTORY_LIMIT = 50;
export const MAX_BLOCKS = 300; // část 3, 3.1.2
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_SECTIONS = 60;
export const PREVIEW_WIDTHS = { desktop: 700, mobile: 375 } as const;
