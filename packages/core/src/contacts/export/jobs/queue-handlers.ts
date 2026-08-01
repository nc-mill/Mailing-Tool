import { handler as runExport } from './run-export';

/**
 * Codegen workeru globuje soubory tohohle jména. Název fronty je z registru P01
 * doslova, ne odvozený: neregistrovaná fronta by shodila `queue()` při zařazení.
 */
export const queueHandlers = {
  'contacts.export': runExport,
} as const;
