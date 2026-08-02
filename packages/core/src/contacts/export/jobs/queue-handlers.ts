import { perJob } from '../../../queues';
import { handler as runExport } from './run-export';

/**
 * Codegen workeru globuje soubory tohohle jména. Název fronty je z registru P01
 * doslova, ne odvozený: neregistrovaná fronta by shodila `queue()` při zařazení.
 */
// Jméno `handlers` je závazné, ne libovolné: codegen workeru generuje
// `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
// jménem se soubor sice zkompiluje a testy projdou, ale bundle workeru spadne
// na „No matching export for import handlers", tedy až při buildu image.
// Každá obsluha se obaluje `perJob`: pg-boss volá handler s DÁVKOU úloh,
// kdežto tyhle funkce berou jednu. Bez obalu by dostaly pole, sáhly na `.data`
// a dostaly `undefined`. Fronty by se přitom zaregistrovaly a worker naběhl,
// takže by se to poznalo teprve na první skutečně zpracované úloze.
export const handlers = {
  'contacts.export': perJob(runExport),
} as const;
