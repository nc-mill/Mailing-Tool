import { handler as recount } from './recount';
import { handler as cleanupAfterReactivation } from './cleanup-after-reactivation';

/**
 * Codegen workeru globuje soubory tohohle jména. Názvy front jsou z registru P01
 * doslova, ne odvozené: neregistrovaná fronta by shodila `queue()` při zařazení.
 */
export const queueHandlers = {
  'segments.recount': recount,
  'contacts.cleanup_after_reactivation': cleanupAfterReactivation,
} as const;
