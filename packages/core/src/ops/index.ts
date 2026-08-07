export { OPS_AUDIT_ACTIONS } from './audit';
export {
  BACKUP_MIN_KEPT,
  backupDirName,
  listBackups,
  pruneBackups,
  runBackup,
  selectBackupsToDelete,
} from './backup';
export type { BackupEntry, RunBackupResult } from './backup';
export { assertDumpRoleSeesAllRows, DumpRoleBlindError } from './backup-guard';
export {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  compareRowCounts,
  fileSha256,
  isBackupFromNewerVersion,
  parseManifest,
  readManifest,
  writeManifest,
} from './backup-manifest';
export type { BackupManifest, RowCountDiff } from './backup-manifest';
export { verifyBackup } from './backup-verify';
export type { VerifyReport } from './backup-verify';
export { exitCodeFor, formatJson, formatReport, summarize } from './doctor/format';
export { runDoctor } from './doctor/run';
export type { DoctorContext, DoctorFinding, DoctorSeverity } from './doctor/types';
export { keyringEnvFromConfig, knownKeyIds, loadOpsKeyring, missingGenerations } from './keyring';
export type { KeyringEnv, OpsKeyring } from './keyring';
export { isDatabaseEmpty, RestoreRefusedError, restoreBackup } from './restore';
export type { RestoreReport } from './restore';
export { binaryMajorVersion, majorVersionOf, ProcessFailedError, runProcess } from './run-process';
export {
  decideKeyId,
  generateSecretKey,
  keyIdsInEnv,
  MAX_KEY_ID,
  rotationRunbook,
  type KeyIdDecision,
} from './genkey';
export {
  ENCRYPTED_COLUMNS,
  discoverEncryptedColumns,
  unregisteredEncryptedColumns,
} from './encrypted-columns';
export { enqueueRefingerprint, rotateCredentials } from './rotate-credentials';
export type { RotateReport } from './rotate-credentials';
export { MIN_PASSWORD_LENGTH, resetPassword, UserNotFoundError } from './reset-password';
export { rebuildEngagement } from './rebuild-engagement';
/**
 * Přepočet stavu souhlasů z append-only logu. Bez příkazu byla obsluha fronty
 * `consents.rebuild_state` nedosažitelná: vedl k ní jedině ruční INSERT do
 * tabulky úloh pg-bossu, a to zrovna po obnově ze zálohy.
 */
export { rebuildConsents, type RebuildConsentsReport } from './rebuild-consents';
/**
 * Jednorázové převlečení uložených e-mailů do barev značky. Pro instalace,
 * které značku mají a od upgradu ji znovu neuloží; jinak to dělá samo uložení.
 */
export { redressAllWorkspacesToBrand, type RedressBrandReport } from './redress-brand';
export {
  maintainPartitions,
  partitionMaintenanceMetadata,
  recordPartitionMaintenance,
  retentionTargets,
  runPartitionMaintenance,
} from './partition-retention';
export type {
  MaintainPartitionsInput,
  MaintainPartitionsResult,
  RetentionReport,
  RetentionTarget,
  RunInput as PartitionMaintenanceInput,
  TargetReport,
} from './partition-retention';
export { ProcessesStillRunningError, runUpgrade } from './upgrade';
export { backupJob, backupVerifyJob } from './jobs/backup-jobs';
