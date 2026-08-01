import { createSystemContext } from '../../identity/context';
import { withWorkspace, withoutContext, type Tx } from '../../tx';

export type { Tx };

/**
 * Projekt a jméno jobu, pod kterými se transakce otevře.
 *
 * `workspaceId` je tady OBSAH kontextu, ne parametr filtru: hodnota pochází
 * z ověřeného tokenu, z veřejného klíče nebo z payloadu jobu a putuje do
 * `set_config('mlain.workspace_id')`. Pojmenovaný typ je proto povinný, jinak
 * ho `scope.test.ts` označí za ruční filtr podle projektu.
 */
export type TrackingTxScope = {
  workspaceId: string;
  /** Propíše se do aktéra a odtud do auditu, takže je vidět, co řádek zapsalo. */
  job: string;
};

/**
 * Transakce v kontextu jednoho projektu pod systémovým aktérem.
 * Obálka nastaví `mlain.workspace_id`, takže RLS platí i pro dotazy této domény.
 * Workspace pochází z podepsaného tokenu, z veřejného klíče nebo z payloadu jobu,
 * nikdy ze session: trackovací povrchy session nemají.
 *
 * ODCHYLKA OD PLÁNU, kosmetická: plán psal `withTrackingTx(workspaceId, job, fn)`.
 * Podpis se sbalil do jednoho pojmenovaného objektu kvůli pravidlu z
 * `identity/scope.test.ts`, které zakazuje exportovanou funkci mimo `src/tx`
 * s parametrem `workspaceId: string`.
 */
export function withTrackingTx<T>(scope: TrackingTxScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspace(createSystemContext(scope.workspaceId, scope.job), fn);
}

/**
 * Transakce **napříč projekty**, tedy bez jakéhokoli `set_config`.
 *
 * Používej ji výhradně tam, kde workspace z principu neznáme (dohledání
 * veřejného klíče) nebo kde se pracuje se všemi projekty naráz (retence,
 * přepočty, mapa trackovacích domén). Každé takové místo je vyjmenované
 * v 1.1 plánu a hlídá ho test v Tasku 47.
 *
 * **Dokud P03 nedodá mechanismus pro systémový přístup, vrací tahle cesta
 * nula řádků a nevrací chybu.** Politika `ws_isolation` porovnává
 * `workspace_id` s `current_setting('mlain.workspace_id', true)`, což je
 * bez kontextu `NULL`. Není to důvod obejít to jinde, je to jeden nález
 * na jednom místě.
 *
 * ODCHYLKA OD PLÁNU: obálka se v `@mlain/core/tx` jmenuje `withoutContext`,
 * ne `withoutWorkspace`. P04 jména z P03 schválně nepřejmenovává.
 */
export function withCrossWorkspaceTx<T>(job: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  void job; // drží jméno u volání, aby šlo dohledat, kdo napříč projekty sahá
  return withoutContext(fn);
}
