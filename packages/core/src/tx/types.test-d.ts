import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Tx as DbTx } from '@mlain/db';
import type * as schema from '@mlain/db/schema';
import type { Tx } from './index';

// 1. Tx z adaptéru je TENTÝŽ typ jako Tx z @mlain/db, ne jeho kopie ani obal.
//    Přiřazení musí projít oběma směry; kdyby adaptér typ jakkoli přebalil,
//    jeden ze dvou řádků přestane platit.
const _sameAsDb: DbTx = null as unknown as Tx;
const _sameAsAdapter: Tx = null as unknown as DbTx;

// 2. A je to Drizzle handle nad naším schématem. Kdyby ho někdo vrátil na syrový
//    klient z pg, tohle přiřazení přestane platit.
const _isDrizzle: NodePgDatabase<typeof schema> = null as unknown as Tx;
const _isDrizzleBack: Tx = null as unknown as NodePgDatabase<typeof schema>;

// 3. Tx MUSÍ mít metody, kvůli kterým celá vrstva existuje.
type HasDrizzleApi = Tx extends {
  select: unknown;
  insert: unknown;
  delete: unknown;
  execute: unknown;
}
  ? true
  : false;
const _hasApi: HasDrizzleApi = true;

export type { HasDrizzleApi };
export { _sameAsDb, _sameAsAdapter, _isDrizzle, _isDrizzleBack, _hasApi };
