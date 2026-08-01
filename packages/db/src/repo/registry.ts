// packages/db/src/repo/registry.ts
import type { WorkspaceContext } from '../context';
import type { Tx } from './tx';

/**
 * Metadata jednoho doménového repository modulu. Doménový plán se sem
 * zaregistruje a generický test izolace jeho čtecí funkce automaticky zavolá
 * pod cizím kontextem. Části 2 až 5 tak nemusí psát vlastní izolační testy.
 *
 * Bez registru by každý doménový plán musel na izolaci pamatovat sám,
 * a to je přesně ten druh ochrany, který nic nevynucuje.
 */
export type RepoModule = {
  /** Doména, například 'contacts'. */
  name: string;
  /**
   * Čtecí funkce modulu. Každá dostane kontext cizího projektu a musí vrátit
   * prázdný výsledek nebo null, nikdy cizí data a nikdy výjimku.
   */
  readers: ReadonlyArray<{
    name: string;
    /**
     * Bere `Tx`, ne `Pool` (rozhodnutí R38). Doménové funkce se podle vzoru,
     * který zavedl P04, píšou jako `sluzba(tx, ctx)` a transakci otevírá až
     * volající. S `Pool` by se sem taková funkce nedala zapojit bez obalu
     * a ten obal by předaný pool zahodil, protože adaptér P04 si pool bere
     * ze singletonu; registr by tedy dostával argument, který nikdo nepoužije.
     *
     * Transakci otevírá generický test izolace, ne registrovaná funkce.
     * Jen tak ji test umí zabalit do CIZÍHO kontextu, což je celý smysl
     * registru.
     */
    call: (tx: Tx, ctx: WorkspaceContext) => Promise<unknown>;
  }>;
};

const modules = new Map<string, RepoModule>();

export function registerRepoModule(module: RepoModule): void {
  if (modules.has(module.name)) {
    throw new Error(`repository modul ${module.name} je už zaregistrovaný`);
  }
  modules.set(module.name, module);
}

export function registeredRepoModules(): RepoModule[] {
  return [...modules.values()];
}
