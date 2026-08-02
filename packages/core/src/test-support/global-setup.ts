/**
 * Běží JEDNOU pro celý běh vitestu v `packages/core`.
 *
 * Nedělá skoro nic: sáhne po sdíleném kontejneru `mlain-test-pg` (nastartuje ho
 * jen tehdy, když na stroji ještě neběží), počká, až bude šablona hotová,
 * a ohlásí běhu host a port. Všechna práce je v `pg-harness.ts`, tady je jen
 * proto, aby ji udělal JEDEN proces dřív, než se rozjedou workery. Bez toho by
 * se o poradní zámek přetahovalo tolik procesů, kolik má vitest vláken.
 *
 * TEARDOWN SCHVÁLNĚ NENÍ. Kontejner sdílí ostatní běhy na stroji i ostatní
 * agenti; kdyby ho každý běh na konci zastavil, sebral by ho jim uprostřed
 * práce. Uklízí se ručně, viz `tools/dev/uklizec-kontejneru.sh`. Databáze,
 * které v něm testy nadělají, si harness zahazuje sám a co po spadlém běhu
 * zůstane, sebere `dropOrphans()` při příštím startu.
 */
import type { TestProject } from 'vitest/node';
import { ensureSharedServer } from './pg-harness';

export default async function setup(project: TestProject) {
  const { host, port } = await ensureSharedServer();
  project.provide('corePgHost', host);
  project.provide('corePgPort', port);
}

declare module 'vitest' {
  export interface ProvidedContext {
    corePgHost: string;
    corePgPort: number;
  }
}
