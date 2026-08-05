// packages/db/src/index.ts
//
// Vstupní bod balíčku. NENÍ to doménový barrel: doménové repository si píše
// každý doménový plán do packages/core/<domena> a importuje se podcestou.
export {
  checkIsolationPrerequisites,
  createDb,
  createPool,
  type Database,
  type PoolKind,
} from './client';
// unsafeWorkspaceContext tu SCHVÁLNĚ NENÍ. Importuje se výhradně podcestou
// @mlain/db/unsafe-context, tedy vždy vědomě. Dokud byla tady, nabízel ji
// našeptávač každému, kdo psal `import { w` z '@mlain/db', a jediná ochrana
// bylo pravidlo ESLintu, které si tenhle plán přál a po nikom nevyžádal.
export { type Actor, type Permission, type Role, type WorkspaceContext } from './context';
// `schema` se tu SCHVÁLNĚ nereexportuje (rozhodnutí R37). Importuje se výhradně
// podcestou `@mlain/db/schema`, podle které už píše P04 i doménové plány.
// Kdyby tu navíc bylo `export * as schema`, existovaly by dvě rovnocenné cesty
// k témuž a plány by si vybíraly každý po svém, což je přesně ten stav,
// kterému se to mělo vyhnout. Hlídá to test kořenového exportu v kroku 2.
export {
  pgErrorCode,
  withReadOnly,
  withUser,
  withWorkspace,
  withoutContext,
  type ReadOnlyOptions,
  type Tx,
} from './repo/tx';
export { registerRepoModule, registeredRepoModules, type RepoModule } from './repo/registry';
export { listGlobalAuditForUser, type GlobalAuditRow } from './repo/audit-global';
export {
  createWorkspaceAsUser,
  listWorkspacesForUser,
  type CreateWorkspaceInput,
  type WorkspaceRow,
} from './repo/workspaces-global';
export {
  MESSAGES_STORAGE,
  PARTITIONED_REFERENCES,
  PARTITIONED_TABLES,
  UNIQUE_INDEX_EXCEPTIONS,
  applyPartitionPlan,
  createIndexConcurrentlyOnPartitioned,
  createMonthlyPartitions,
  dropPartitionsBefore,
  ensurePartitionsForRange,
  ensureUpcomingPartitions,
  parseBounds,
  partitionName,
  planPartitionsBefore,
  type PartitionDecision,
  type PartitionVeto,
  type PartitionedReference,
  type PartitionedTable,
  type Queryable,
  type StorageOptions,
  type VetoResult,
} from './partitions';
export {
  EXTRA_POLICIES,
  MAINTENANCE_BYPASS_TABLES,
  RLS_REGISTRY,
  SENDER_BYPASS_TABLES,
  TABLES_WITHOUT_RLS,
  TABLES_WITHOUT_WORKSPACE_ID,
  expectedPolicies,
  type PolicyKind,
  type TablePolicy,
} from './rls';
export {
  attributeIndexName,
  dropAttributeIndex,
  ensureAttributeIndex,
  isAttributeIndexValid,
} from './attribute-index';
// Migrační runner se z kořene SCHVÁLNĚ nereexportuje, importuje se podcestou
// `@mlain/db/migrate`. Je to nástroj CLI, ne součást datové vrstvy.
//
// Dokud tenhle řádek existoval, tahal se runner do bundlu KAŽDÉHO konzumenta
// `@mlain/db`, tedy i do Next.js aplikace přes řetěz
// route.ts -> openapi.ts -> *.routes.ts -> core/tx -> db. Runner si přitom
// skládá cestu k adresáři s migracemi přes `new URL('../migrations', ...)`,
// což bundler neumí přeložit, a celé `/api/v1/**` skončilo chybou
// „Module not found: Can't resolve '../migrations'". Projevilo se to až
// při prvním skutečném požadavku z prohlížeče: typecheck i všechny testy
// byly zelené, protože ty runner načítají v Node, ne přes bundler.
