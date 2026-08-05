import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { ApiError } from '../../errors/api-error';
import { createSystemContext } from '../../identity/context';
import { wsEq } from '../../identity/scope';
import { withWorkspace, type Tx } from '../../tx';
import { activityDependentSegmentIds } from '../activity';
import { segmentsLogger } from '../logging';
import { SEGMENTS_RECOUNT_QUEUE } from '../service';
import { enqueueSegmentJob } from './enqueue';

export const RECALC_FOR_CONTACT_QUEUE = 'segments.recalc_for_contact';

export type RecalcForContactPayload = { workspaceId: string; contactId: string };

export type RecalcForContactResult = {
  /** Segmenty, kterým tenhle běh zařadil přepočet. */
  queued: string[];
  /** Proč se nezařadilo nic. `null` u běhu, který doopravdy fanoutoval. */
  skipped: 'debounced' | 'no_dependent_segments' | 'cooldown' | null;
};

/**
 * Kolik nejméně smí uplynout mezi dvěma přepočty téhož segmentu vyvolanými
 * aktivitou.
 *
 * Číslo je rozpočet, ne odhad. Část 2, 4.11.6 říká, že cyklus přepočtu je
 * šestihodinový PRÁVĚ PROTO, že projekt s 200 segmenty nad 5 miliony kontaktů
 * spotřebuje na jeden úplný cyklus 7 až 20 minut databázového času, a že
 * častější přepočet by ukrádal výkon odesílání. Zároveň platí bod 10 zadání
 * části 2: „Segmenty se nepřepočítávají v reálném čase."
 *
 * Hodina je proto strop, ne cíl: aktivita zrychlí přepočet nejvýš šestkrát
 * proti cronu, a jen u segmentů, které chování doopravdy čtou, a jen v projektu,
 * kde se doopravdy něco děje. Na tichém webu se nezařadí nic.
 *
 * Konstanta ZÁMĚRNĚ není v konfiguraci: `packages/core/src/config` vlastní jiný
 * plán a přidat tam proměnnou by znamenalo sáhnout mimo doménu segmentů.
 */
export const ACTIVITY_RECOUNT_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Kolik projektů si proces pamatuje, než starší záznamy zahodí. Mapa je jen
 * zrychlovač, ne stav: co z ní vypadne, dohoní databázová podmínka níž.
 */
const DEBOUNCE_CAPACITY = 1000;

/**
 * Kdy naposledy tenhle proces fanoutoval pro daný projekt.
 *
 * PROČ V PAMĚTI: při běžném provozu přijde na frontu jedna úloha na kontakt
 * a událost. Web se stovkou návštěvníků za minutu vyrobí stovku úloh, a bez
 * tohohle by každá z nich znamenala dotaz do databáze, který skoro vždycky
 * vrátí prázdno. Mapa ten dotaz ušetří.
 *
 * NENÍ to zámek a nesmí na ní stát správnost: po restartu je prázdná a víc
 * workerů má každý svou. Správnost drží podmínka `recompute_state = 'idle'`
 * plus `cached_at` v UPDATE níž, která běží v databázi a je společná všem.
 */
const lastFanoutAt = new Map<string, number>();

/** Jen pro testy: zapomene doběh, aby šlo ověřit i druhé zařazení. */
export function resetRecalcDebounce(): void {
  lastFanoutAt.clear();
}

function debounced(workspaceId: string, now: number): boolean {
  const last = lastFanoutAt.get(workspaceId);
  return last !== undefined && now - last < ACTIVITY_RECOUNT_COOLDOWN_MS;
}

function rememberFanout(workspaceId: string, now: number): void {
  if (lastFanoutAt.size >= DEBOUNCE_CAPACITY) {
    for (const [id, at] of lastFanoutAt) {
      if (now - at >= ACTIVITY_RECOUNT_COOLDOWN_MS) lastFanoutAt.delete(id);
    }
    // Když ani úklid nepomohl, jsou všechny záznamy čerstvé a mapa se prostě
    // nechá přerůst. Zahodit čerstvý záznam by znamenalo pustit fanout znovu.
  }
  lastFanoutAt.set(workspaceId, now);
}

/**
 * Strážce PROTI NEJTIŠŠÍ PORUŠE v celé téhle doméně.
 *
 * `segments` má politiku `ws_isolation`. Když se dotaz spustí bez nastaveného
 * `mlain.workspace_id`, je porovnání s NULL nepravda, RLS vrátí NULA ŘÁDKŮ
 * a NEVYHODÍ CHYBU. Obsluha by doběhla zeleně, vrátila `{ queued: [] }`
 * a nikdy nic nepřepočítala. Kontrola je jeden `current_setting`, tedy bez
 * dotknutí tabulky, a proměnný text v jednom místě dělá z tiché nuly hlasitý pád.
 */
async function assertWorkspaceContext(tx: Tx, workspaceId: string): Promise<void> {
  const { rows } = await tx.execute<{ ws: string | null }>(
    sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
  );
  const actual = rows[0]?.ws ?? null;
  if (actual === workspaceId) return;
  throw new ApiError('service_unavailable', {
    params: { code: 'workspace_context_missing', expected: workspaceId, actual },
  });
}

type Candidate = {
  id: string;
  definition: unknown;
  cachedAt: Date | null;
  recomputeState: 'idle' | 'queued' | 'running' | 'error';
};

/**
 * Obsluha fronty `segments.recalc_for_contact`.
 *
 * CO DĚLÁ: přeloží „tenhle kontakt se projevil" na „těmhle segmentům může být
 * počet neplatný" a zařadí jim `segments.recount`. Nic víc dělat NEMŮŽE, protože
 * dynamické segmenty se podle části 2, 4.11.6 NEMATERIALIZUJÍ: `segment_members`
 * nese jen zmrazené statické segmenty, které se z definice nepřepočítávají,
 * a jediná odvozená hodnota dynamického segmentu je `cached_count`. Členství
 * jednoho kontaktu ve všech segmentech se tedy nikam neukládá a nebylo by co
 * zapsat; „přepočet příslušnosti" z registru se v tomhle schématu realizuje
 * jako zneplatnění počtu.
 *
 * CO ZÁMĚRNĚ NEDĚLÁ: nepočítá segment sám. Přepočet umí `segments.recount`,
 * má na to vlastní frontu, retry i stavy, a duplikát téhož výpočtu by znamenal
 * dva výklady toho, co je čerstvý počet.
 *
 * TŘI POJISTKY PROTI LAVINĚ, každá na jiné úrovni:
 *   1. filtr podle definice: segment, který nečte web_events ani
 *      last_activity_at, se do fanoutu vůbec nedostane;
 *   2. `recompute_state = 'idle'` v UPDATE: dokud čeká nebo běží přepočet,
 *      další se nezařadí. Nahrazuje `singletonKey`, na který se spolehnout NEJDE:
 *      všechny fronty jsou v pg-boss založené s `policy = 'standard'`, kde se
 *      `singleton_key` ukládá, ale nic podle něj nesjednocuje;
 *   3. `cached_at` starší než hodina: strop četnosti proti rozpočtu z 4.11.6.
 * Nad tím vším ještě doběh v paměti procesu, který ušetří samotný dotaz.
 */
export const handler = async (job: {
  data: RecalcForContactPayload;
}): Promise<RecalcForContactResult> => {
  const { workspaceId } = job.data;
  const now = Date.now();
  if (debounced(workspaceId, now)) return { queued: [], skipped: 'debounced' };

  const ctx = createSystemContext(workspaceId, RECALC_FOR_CONTACT_QUEUE);

  return withWorkspace(ctx, async (tx: Tx) => {
    await assertWorkspaceContext(tx, workspaceId);

    const rows = (await tx
      .select({
        id: segments.id,
        definition: segments.definition,
        cachedAt: segments.cachedAt,
        recomputeState: segments.recomputeState,
      })
      .from(segments)
      .where(
        and(wsEq(ctx, segments), isNull(segments.deletedAt), eq(segments.kind, 'dynamic')),
      )) as Candidate[];

    // Zapamatovat se musí i běh, který nakonec nic nezařadil. Jinak by projekt
    // bez závislých segmentů platil plný dotaz za každou jednu událost.
    rememberFanout(workspaceId, now);

    if (rows.length === 0) return { queued: [], skipped: 'no_dependent_segments' };

    const dependent = activityDependentSegmentIds(rows);
    const ripe = rows.filter(
      (row) =>
        dependent.has(row.id) &&
        row.recomputeState === 'idle' &&
        (row.cachedAt === null || now - row.cachedAt.getTime() >= ACTIVITY_RECOUNT_COOLDOWN_MS),
    );
    if (ripe.length === 0) {
      return { queued: [], skipped: dependent.size === 0 ? 'no_dependent_segments' : 'cooldown' };
    }

    // Zabrání se PODMÍNĚNÝM zápisem, ne dvěma kroky. `recompute_state = 'idle'`
    // v podmínce znamená, že souběžný běh druhého workeru si tentýž segment
    // nezabere, a `RETURNING` říká, co se doopravdy zabralo. Kdyby se stav četl
    // napřed a zapisoval potom, propustily by se dva přepočty téhož segmentu.
    const claimed = (await tx
      .update(segments)
      .set({ recomputeState: 'queued' })
      .where(
        and(
          wsEq(ctx, segments),
          inArray(
            segments.id,
            ripe.map((row) => row.id),
          ),
          eq(segments.recomputeState, 'idle'),
        ),
      )
      .returning({ id: segments.id })) as { id: string }[];

    for (const row of claimed) {
      await enqueueSegmentJob(
        tx,
        SEGMENTS_RECOUNT_QUEUE,
        { workspaceId, segmentId: row.id },
        { singletonKey: row.id },
      );
    }

    const queued = claimed.map((row) => row.id);
    segmentsLogger().info(
      { workspaceId, dependent: dependent.size, queued: queued.length },
      'segments.recalc_for_contact fanned out',
    );
    return { queued, skipped: null };
  });
};
