import { defineAuditActions } from '../audit/action';

/**
 * Kategorie „provoz" podle 01-platforma 3.7. Konvence je
 * <entita>.<sloveso v minulém čase>. Do metadat nikdy nepatří klíče, hesla
 * ani obsah e-mailů; u zálohy jde jen o jméno adresáře, počty řádků a otisk
 * klíče, což je veřejná hodnota.
 *
 * ODCHYLKA OD PLÁNU. Plán tu měl navíc `demo_data.seeded` a `demo_data.purged`.
 * Ty už deklaruje `packages/core/src/demo/audit.ts` a test
 * `audit-actions.test.ts` vynucuje, že se žádný název neopakuje ve dvou
 * doménách. Kdyby byly na obou místech, spadl by ten test, ne tenhle soubor.
 */
export const OPS_AUDIT_ACTIONS = defineAuditActions([
  'backup.created',
  'backup.verified',
  'backup.restored',
  'credentials.rotated',
  // Údržba oddílů, tedy `mlain partitions`. Bez tohohle záznamu neexistoval
  // v celé instalaci žádný doklad o tom, že úklid odeslané pošty proběhl:
  // příkaz se pouští z plánovače hostitele, jeho výpis nikde nezůstane
  // a po úspěšném běhu nezbude nic, do čeho by se dalo podívat. Provozovatel
  // tedy nepoznal, že mu retence týden neběžela a data leží přes lhůtu.
  // Na tenhle záznam se dívá `mlain doctor` (nález partition_maintenance_stale).
  'partition.maintained',
  'user.password_reset_from_cli',
]);
