import { RESTORE_WINDOW_DAYS } from '../../identity/workspace-service';
import { purgeDeletedWorkspaces } from '../maintenance-scan';

/**
 * 3.3: měkce smazaný workspace jde 30 dní obnovit, pak se maže tvrdě.
 * Smazání workspace je jediná operace, která maže data kaskádou.
 *
 * Job je idempotentní: opakovaný běh nad už smazaným projektem nic nenajde.
 *
 * BĚŽÍ POD `mlain_maintenance`, ne pod aplikační rolí, a to je na téhle funkci
 * to jediné podstatné. Dřív se mazalo přes `withoutContext`, tedy pod
 * `mlain_app` bez nastaveného `mlain.workspace_id`, a politiky z migrace 0004
 * v tom stavu nepustí ani řádek. `DELETE FROM workspaces` proto zasáhl NULA
 * ŘÁDKŮ, nevrátil chybu a job hlásil úspěch: retence běžela a neuklidila nic.
 * Ověřeno spuštěním s projektem smazaným před 60 dny, vrátilo `DELETE 0`.
 *
 * Bez `DATABASE_URL_MAINTENANCE` job spadne s vysvětlením. Je to záměr:
 * neproveditelný úklid má být vidět jako chyba úlohy, ne jako trvalá nula.
 */
export async function handler(): Promise<number> {
  return purgeDeletedWorkspaces(RESTORE_WINDOW_DAYS);
}
