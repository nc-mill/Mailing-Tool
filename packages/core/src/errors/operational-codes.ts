import type { OperationalCodeEntry } from './types';

/**
 * Šestý jmenný prostor podle rozhodnutí R5.
 *
 * Bez něj by si migrační runner v P03 a `mlain doctor` v P16 zakládaly kódy
 * samy, protože se do prvních pěti druhů nevejdou: nemají HTTP status, nejsou
 * to hodnoty sloupce a nevznikají při validaci vstupu. Uzávěr S7 to zakazuje,
 * takže je předdeklaruje P01, stejně jako všechny ostatní.
 *
 * Exit kódy 3, 4, 5 a 75 fixuje část 1, kapitola 3.13; 6, 64, 69 a 78 doplnil
 * plán P01 (rozhodnutí D9). Musí se shodovat s apps/cli/src/exit-codes.ts
 * a hlídá to test.
 */
export const OPERATIONAL_CODES: readonly OperationalCodeEntry[] = [
  // --- Provoz a migrace, exit kódy CLI --------------------------------------
  { code: 'migration_failed', scope: 'cli', exitCode: 3, owner: 'P03', source: 'spec' },
  { code: 'major_version_skipped', scope: 'cli', exitCode: 4, owner: 'P16', source: 'spec' },
  { code: 'schema_version_ahead', scope: 'cli', exitCode: 5, owner: 'P03', source: 'spec' },
  { code: 'migration_hash_mismatch', scope: 'cli', exitCode: 6, owner: 'P03', source: 'derived' },
  { code: 'usage_error', scope: 'cli', exitCode: 64, owner: 'P01', source: 'derived' },
  { code: 'command_not_implemented', scope: 'cli', exitCode: 69, owner: 'P01', source: 'derived' },
  { code: 'migration_lock_timeout', scope: 'cli', exitCode: 75, owner: 'P03', source: 'spec' },
  { code: 'config_invalid', scope: 'cli', exitCode: 78, owner: 'P01', source: 'spec' },

  // --- Nálezy `mlain doctor`, část 1, kapitola 3.14 -------------------------
  {
    code: 'missing_key_generations',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'secret_key_previous_empty',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'secret_key_fingerprint_mismatch',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'key_id_ceiling_near',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'data_volume_empty',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  { code: 'no_backup_yet', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  { code: 'backup_stale', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  {
    code: 'backup_binary_missing',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'backup_binary_version_mismatch',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'schema_version_ahead',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'spec',
  },
  {
    code: 'connection_pool_over_budget',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'spec',
  },
  // Údržba oddílů se pouští z plánovače hostitele, ne z workeru (odpojení
  // oddílu je DDL). Po úspěšném běhu nezbude nic, do čeho by se dalo podívat,
  // takže se nedalo poznat, že plánovač nikdo nenastavil nebo že týden neběžel
  // a odeslaná pošta leží přes lhůtu. Dvojice nálezů je záměrná a kopíruje
  // zálohu: „ještě nikdy" je jiná práce než „přestalo to běžet".
  {
    code: 'no_partition_maintenance_yet',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  {
    code: 'partition_maintenance_stale',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  // Ověřování zálohy tiká TÝDNĚ, takže ho hlídač ticha ve workeru pokrýt nemůže:
  // pg-boss maže dokončené úlohy po sedmi dnech, a z chybějícího řádku se ticho
  // delší než týden doložit nedá. Audit ten problém nemá, `backup.verified`
  // v něm leží měsíce. Dvojice nálezů je opět záměrná: „nikdy se neověřovalo"
  // znamená nezapojenou úlohu, „přestalo se ověřovat" znamená selhávající běhy.
  {
    code: 'no_backup_verify_yet',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  {
    code: 'backup_verify_stale',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  // TŘETÍ KÓD, a není to nadbytek. `platform.backup_verify` zapíše auditní
  // záznam i tehdy, když ověření NEPROŠLO (`ok: false`), takže instalace, které
  // se ověření každou neděli nepovede, má záznam čerstvý a podle stáří by
  // vypadala v pořádku. Klid odvozený z pravidelně nastávající poruchy je to
  // nejhorší, co může diagnostika říct.
  {
    code: 'backup_verify_failed',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  { code: 'trial_mode_enabled', scope: 'doctor', severity: 'info', owner: 'P16', source: 'spec' },
  { code: 'demo_data_present', scope: 'doctor', severity: 'info', owner: 'P16', source: 'spec' },
  { code: 'check_failed', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  // Projekt nemá odesílací účet, kterým by šla odeslat systémová pošta. Bez ní
  // neodejde pozvánka ani obnova hesla, a dosud se to dalo poznat jen z logu.
  {
    code: 'system_mail_unavailable',
    scope: 'doctor',
    severity: 'warning',
    owner: 'P16',
    source: 'derived',
  },
  // Nález N24 evidence: doctor musí umět hlásit i to, že se na aktuální roli
  // nevztahuje RLS. P03 pro to dodává checkIsolationPrerequisites().
  {
    code: 'isolation_prerequisites_missing',
    scope: 'doctor',
    severity: 'critical',
    owner: 'P16',
    source: 'derived',
  },
];
