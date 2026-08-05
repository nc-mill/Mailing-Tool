import { loadConfig } from '../../config/index';
import { enqueueJob, type OnMerged } from '../../queues/enqueue-sql';
import type { Tx } from '../../tx';
import { CONTACTS_QUEUES, type ContactsQueue } from '../queues';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal `enqueue(tx, name, payload)` jako
 * hotový symbol z cizího plánu. Žádný takový v produktu není: P01 vlastní registr front
 * (`packages/core/src/queues/registry.ts`) a `apps/worker` drží instanci pg-boss, ale
 * transakční zařazení nikdo nevystavuje. Volat `boss.send()` mimo transakci není náhrada:
 * job by přežil rollback doménové změny a odstranil by klíč z attributes u pole, jehož
 * smazání se nakonec nepovedlo.
 *
 * Vlastní SQL tady UŽ NENÍ. Sestavuje ho `queues/enqueue-sql.ts`, protože týž příkaz
 * potřebuje sedm domén a sedm kopií se rozešlo přesně tak, jak se to čekalo: všem
 * chyběl sloupec `policy`, takže do řádku úlohy padala NULL, slučovací index se na něj
 * nevztahoval a `singletonKey` neslučoval NIC, ať měla fronta politiku jakoukoli.
 *
 * VÝCHOZÍ `onMerged` JE `drop`, A JE TO ROZHODNUTÍ, NE POHODLNOST. Fronty téhle domény,
 * které slučují, jsou `contacts.recompute_greeting` a `contacts.refingerprint` (obě
 * `short`) a `retention.run` (`exclusive`). U všech tří platí totéž: práci drží databáze,
 * ne úloha. Přepočet oslovení i doplnění otisků si načtou aktuální stav, až na ně přijde
 * řada, a retenční běh maže podle stáří, takže zítřek smaže i to, co zbylo. Zahozený
 * požadavek tedy neznamená neudělanou práci, jen ji udělá běh, který už čeká.
 *
 * Na `fail` tu není ani jedna fronta, protože na žádnou z nich nečeká člověk u obrazovky.
 * Hromadné operace (`contacts.bulk_delete`, `contacts.bulk_tag`) slučování zapnuté
 * NEMAJÍ, takže se u nich zahodit nemůže nic.
 */
export type EnqueueOptions = {
  /** Jeden běh nad jedním klíčem. U front per projekt se předává workspaceId. */
  singletonKey?: string;
  /** Odložený start. Používá se u úklidových jobů. */
  startAfterSeconds?: number;
  /** Přebití výchozího `drop`. Viz rozvaha v hlavičce souboru. */
  onMerged?: OnMerged;
};

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  // Konfigurace se čte líně a jednou. Import modulu nesmí vyžadovat kompletní prostředí,
  // jinak by se doména nedala naimportovat v jednotkovém testu.
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetEnqueueConfig(): void {
  cachedSchema = null;
}

export async function enqueue(
  tx: Tx,
  name: ContactsQueue | string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<void> {
  // Politika opakování se dál bere Z VÝČTU TÉHLE DOMÉNY, ne ze sdíleného registru.
  // Oba se u deseti front rozcházejí (`gdpr.erase` má tady 0 pokusů a v registru 3,
  // `contacts.bulk_delete` totéž), takže přepnutí na registr by tiše změnilo počet
  // pokusů u anonymizace podle článku 17. Rozchod je skutečná vada, ale patří
  // vlastníkům obou registrů, ne do úpravy o slučování.
  const known = (
    CONTACTS_QUEUES as Record<
      string,
      { retryLimit: number; retryBackoff: boolean; expireInSeconds: number }
    >
  )[name];

  await enqueueJob(tx, {
    schema: pgbossSchema(),
    name,
    payload,
    singletonKey: options.singletonKey,
    startAfterSeconds: options.startAfterSeconds,
    retryLimit: known?.retryLimit ?? 3,
    retryBackoff: known?.retryBackoff ?? true,
    expireInSeconds: known?.expireInSeconds ?? 900,
    onMerged: options.onMerged ?? 'drop',
  });
}
