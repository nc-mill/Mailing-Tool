import { withMaintenance, type Tx } from '../tx';
import { ApiError } from '../errors/api-error';
import { rawSql } from '../campaigns/repo/raw-sql';
import { RESUME_ON_QUOTA_SQL } from '../campaigns/jobs/resume-on-quota';
import type { PauseReason } from '../campaigns/pause-reason';

/**
 * JEDINÉ místo v aplikaci, které čte napříč projekty.
 *
 * Je to schválně jeden soubor a ne funkce roztroušené po doménách: výjimka
 * z izolace projektů je hlavní bezpečnostní vlastnost produktu, takže musí jít
 * přečíst celá na jedné obrazovce. Kdo sem přidá dotaz, přidává výjimku
 * a musí k ní přidat i politiku v migraci a řádek v testu izolace.
 *
 * Jak to drží pohromadě, ve třech vrstvách:
 *
 *  1. ROLE. Spojení jede pod `mlain_maintenance` z `DATABASE_URL_MAINTENANCE`,
 *     ne pod aplikační rolí. Bez té proměnné `withMaintenance` vyhodí výjimku
 *     s vysvětlením; úloha skončí v chybě, což je vidět, na rozdíl od prázdného
 *     výsledku, který by vydala aplikační role.
 *  2. GRANTY. Role má práva na pět tabulek: SELECT na `workspaces`,
 *     `campaigns` a `sender_domains`, SLOUPCOVÝ SELECT na `imports`
 *     a `segments` a DELETE na `workspaces`. Dotaz na cokoli jiného skončí
 *     na `permission denied`, ne prázdnem.
 *  3. POLITIKY. Migrace 0009 dává prvním třem tabulkám `maintenance_*` s
 *     `USING (true)` pro čtení a mazání omezuje na už měkce smazané projekty;
 *     migrace 0024 dodává totéž pro `imports` a `segments`.
 *
 * PRAVIDLO PRO VOLAJÍCÍ: odtud se bere JEN identifikace, tedy ID projektu
 * a ID entity. Jakmile ho úloha má, pokračuje přes `withWorkspace` v systémovém
 * kontextu toho projektu, takže na zbytek práce dopadá RLS úplně stejně jako
 * na požadavek z API. Kdyby se sem přidalo čtení kontaktů nebo obsahu kampaně,
 * obešla by se tím izolace projektů, i kdyby to vypadalo pohodlněji.
 */

/**
 * ID živých projektů. Potřebuje ho plánovač kampaní (`campaign.scheduler`)
 * a rekonciliace outboxu (`outbox.reconcile`).
 *
 * Měkce smazané projekty se vynechávají: kampaň ve smazaném projektu se
 * odeslat nesmí a rekonciliovat není co, data čekají na úklid.
 */
export async function listWorkspaceIds(): Promise<string[]> {
  return withMaintenance(async (tx: Tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(`SELECT id FROM workspaces WHERE deleted_at IS NULL ORDER BY created_at`, []),
    );
    return r.rows.map((row) => row.id);
  });
}

export type RunningCampaignRow = {
  workspaceId: string;
  campaignId: string;
  audienceBuiltAt: string | null;
  status: string;
  pauseReason: PauseReason | null;
};

/**
 * Kampaně, na které se má podívat hlídač (`campaign.watchdog`).
 *
 * Výběr je širší než „běžící": kromě `queueing` a `sending` bere i `paused`.
 * Hlídač u pozastavených dopisuje audit pauz, které provedl SENDER, protože ten
 * do `audit_log` granty nemá a mít je nemá. Bez pozastavených ve výběru by
 * automatické pauzy v auditu chyběly úplně.
 */
export async function listRunningCampaigns(): Promise<RunningCampaignRow[]> {
  return withMaintenance(async (tx: Tx) => {
    const r = await tx.execute<{
      id: string;
      workspace_id: string;
      audience_built_at: string | null;
      status: string;
      pause_reason: PauseReason | null;
    }>(
      rawSql(
        `SELECT id, workspace_id, audience_built_at, status, pause_reason
           FROM campaigns
          WHERE deleted_at IS NULL
            AND status IN ('queueing', 'sending', 'paused')
          ORDER BY workspace_id, id`,
        [],
      ),
    );
    return r.rows.map((row) => ({
      workspaceId: row.workspace_id,
      campaignId: row.id,
      audienceBuiltAt: row.audience_built_at,
      status: row.status,
      pauseReason: row.pause_reason,
    }));
  });
}

export type PausedOnQuotaRow = {
  workspaceId: string;
  campaignId: string;
  providerId: string | null;
  source: string;
};

/**
 * Kampaně pozastavené vyčerpanou kvótou, pro `campaign.resume_on_quota`.
 *
 * Dotaz je `RESUME_ON_QUOTA_SQL` z modulu jobu, ne druhá kopie podmínky. Ta
 * podmínka je citlivá na hodnotu: dřívější znění vybíralo `pause_reason = 'quota'`,
 * kdežto sender zapisuje kód `provider_quota_exhausted`, takže job nerozjel
 * NIKDY nic a nikde to nebylo vidět.
 */
export async function listPausedOnQuota(): Promise<PausedOnQuotaRow[]> {
  return withMaintenance(async (tx: Tx) => {
    const r = await tx.execute<{
      id: string;
      workspace_id: string;
      provider_id: string | null;
      source: string | null;
    }>(rawSql(RESUME_ON_QUOTA_SQL, []));
    return r.rows.map((row) => ({
      workspaceId: row.workspace_id,
      campaignId: row.id,
      providerId: row.provider_id,
      source: row.source ?? 'unknown',
    }));
  });
}

export type DueDomainRow = { workspaceId: string; domainId: string; wasVerified: boolean };

/**
 * Odesílací domény, jejichž kontrola je na řadě (`domain.recheck`).
 *
 * `wasVerified` se počítá ze `spf_ok` a `dkim_ok`, tedy z týchž dvou sloupců,
 * které rozhodují o `verified_at` v `saveChecks`. Job na tom staví hlášení
 * změny stavu, takže druhá definice „ověřeno" by vyrobila falešné události.
 */
export async function listDueDomains(limit: number): Promise<DueDomainRow[]> {
  return withMaintenance(async (tx: Tx) => {
    const r = await tx.execute<{
      id: string;
      workspace_id: string;
      was_verified: boolean;
    }>(
      rawSql(
        `SELECT id, workspace_id,
                (spf_ok IS TRUE AND dkim_ok IS TRUE) AS was_verified
           FROM sender_domains
          WHERE next_check_at IS NOT NULL AND next_check_at <= now()
          ORDER BY next_check_at
          LIMIT ${Number(limit)}`,
        [],
      ),
    );
    return r.rows.map((row) => ({
      workspaceId: row.workspace_id,
      domainId: row.id,
      wasVerified: row.was_verified,
    }));
  });
}

/**
 * Odliší „není co dělat" od „nevidím na nic".
 *
 * Ptá se na dvě čísla v JEDNÉ transakci. `workspaces` je tabulka, na kterou má
 * tahle role výjimku od migrace 0009, takže odpovídá na otázku, jestli je
 * instalace vůbec používaná. Druhá tabulka je ta skenovaná.
 *
 * PROČ NE `users`, jak se ptaly obě původní verze tohohle strážce uvnitř jobů:
 * `users` je ve `FORBIDDEN_TABLES` testu izolace a role na ni ZÁMĚRNĚ nemá
 * právo, protože drží `password_hash`. Pod `mlain_maintenance` by tedy dotaz
 * skončil na `permission denied for table users` a strážce by hlásil poruchu
 * pokaždé. Otázka „je instalace používaná" se dá stejně dobře položit
 * `workspaces` a nevyžaduje kvůli tomu rozšířit výjimku o tabulku uživatelů.
 *
 * ZNÁMÉ OMEZENÍ, přebrané beze změny z původních strážců: instalace, která má
 * projekty a přitom NULA importů nebo NULA segmentů, je věrohodný stav
 * (nikdo zatím nic nenaimportoval) a strážce ho nerozliší od zablokovaného
 * skenu. Chová se tedy jako hlásič, ne jako důkaz. Dokud existují politika
 * i grant z migrace 0024, chybějící kus se projeví jinak: bez grantu skončí
 * dotaz na `permission denied`, tedy taky hlasitě.
 */
async function assertCrossWorkspaceVisibility(
  tx: Tx,
  table: 'imports' | 'segments',
): Promise<void> {
  const r = await tx.execute<{ workspaces: number; scanned: number }>(
    rawSql(
      `SELECT (SELECT count(*) FROM workspaces WHERE deleted_at IS NULL)::int AS workspaces,
              (SELECT count(*) FROM ${table})::int AS scanned`,
      [],
    ),
  );
  const seen = r.rows[0];
  if (seen !== undefined && seen.workspaces > 0 && seen.scanned === 0) {
    throw new ApiError('service_unavailable', {
      params: { code: 'cross_workspace_scan_blocked', table, workspaces: seen.workspaces },
    });
  }
}

export type StaleImportRow = { workspaceId: string; importId: string };

/**
 * Zaseknuté importy pro obnovu (`contacts.import.recover_stale`).
 *
 * Jediný signál živosti je `imports.updated_at`, které zapisuje KAŽDÁ
 * checkpointová transakce importéru. Zabitý worker ho přestane posouvat a řádek
 * zůstane ve stavu `importing`.
 *
 * PROČ TENHLE SKEN MUSÍ BÝT TADY, a ne pod aplikační rolí, jak byl dřív:
 * `imports` má politiku `ws_isolation` a `withoutContext` žádný kontext
 * nenastavuje, takže porovnání s NULL vyloučí všechny řádky. Ověřeno spuštěním
 * proti běžící databázi, `mlain_migrator` vidí 3 řádky, `mlain_app` bez
 * kontextu 0. Dopad není kosmetický: `confirmImport` odmítne každý další import
 * v projektu, dokud tam leží řádek ve stavu `importing`
 * (`import_already_running`), takže projekt zůstane bez importů napořád.
 *
 * Vrací POUZE identifikaci. `filename`, `mapping` ani `error_summary` tahle role
 * přečíst nesmí a sloupcový grant z migrace 0024 to vynucuje.
 */
export async function listStaleImports(staleMinutes: number): Promise<StaleImportRow[]> {
  return withMaintenance(async (tx: Tx) => {
    await assertCrossWorkspaceVisibility(tx, 'imports');
    const r = await tx.execute<{ id: string; workspace_id: string }>(
      rawSql(
        `SELECT id, workspace_id
           FROM imports
          WHERE status = 'importing'
            AND updated_at < now() - make_interval(mins => $1::int)
          ORDER BY workspace_id, id`,
        [staleMinutes],
      ),
    );
    return r.rows.map((row) => ({ workspaceId: row.workspace_id, importId: row.id }));
  });
}

/**
 * Práce, o které databáze tvrdí, že BĚŽÍ, a která se dlouho nehnula.
 *
 * `kind` a `id` jsou schválně TÝŽ PÁR, jakým mluví Centrum úloh
 * (`platform/jobs/registry.ts`), aby se nález dal otevřít odkazem a nemusel se
 * překládat. `idleSeconds` je stáří posledního zápisu, tedy jediný signál
 * živosti, který obě úlohy mají: heartbeat nemá ani jedna.
 */
export type ClaimedRunningJobRow = {
  workspaceId: string;
  kind: 'import' | 'campaign_audience';
  id: string;
  /** Doménový stav, ať je v hlášení vidět, o kterou fázi jde. */
  state: string;
  idleSeconds: number;
};

/**
 * Úlohy, které se TVÁŘÍ jako běžící a dlouho se nehnuly, napříč projekty.
 *
 * K ČEMU TO JE. Hlídač osiřelých úloh (`apps/worker/src/job-watch.ts`) potřebuje
 * jednu stranu porovnání: co si o sobě myslí doména. Druhou stranu, tedy co
 * doopravdy leží ve frontě, si přečte z `pgboss.job` sám, protože na to má
 * aplikační role právo a tahle ne.
 *
 * PROČ SE NEPTÁ NA `previewing` A `pending`. V těch fázích se čeká na ČLOVĚKA
 * a žádná úloha existovat nemá, takže by to nebyl nález, ale běžný provoz.
 * Výčet je proto doslova ten, který `platform/jobs/built-in-sources.ts` hlásí
 * jako `running`; kdyby se rozešly, hlídač by hlídal něco jiného, než co vidí
 * uživatel v Centru úloh.
 *
 * PROČ SE NEVOLÁ `assertCrossWorkspaceVisibility`. Ten strážce patří ke skenu,
 * který OPRAVUJE: když oslepne, tiše se přestane opravovat a nikdo to nepozná.
 * Tenhle sken jenom hlásí a běží po pěti minutách, takže by strážce na každé
 * čerstvé instalaci (projekty jsou, importů nula) hlásil poruchu pořád dokola,
 * a poplach, který chodí při běžném provozu, se přestane číst. Chybějící GRANT
 * se navíc projeví hlasitě sám: dotaz skončí na `permission denied`, ne prázdnem.
 *
 * Vrací POUZE identifikaci a řídicí sloupce, jak předepisuje hlavička souboru.
 */
export async function listJobsClaimingToRun(
  minIdleMinutes: number,
): Promise<ClaimedRunningJobRow[]> {
  return withMaintenance(async (tx: Tx) => {
    const imports = await tx.execute<{
      id: string;
      workspace_id: string;
      status: string;
      idle: number;
    }>(
      rawSql(
        `SELECT id, workspace_id, status,
                EXTRACT(EPOCH FROM (now() - updated_at))::int AS idle
           FROM imports
          WHERE status IN ('validating', 'importing')
            AND updated_at < now() - make_interval(mins => $1::int)
          ORDER BY workspace_id, id`,
        [minIdleMinutes],
      ),
    );

    /*
     * STAVBA PUBLIKA. Kampaň ve stavu `queueing` s nepostaveným publikem čeká
     * na úlohu `campaign.materialize`. Plánovač ji zařazuje jen do doby, než
     * kampaň opustí stav `scheduled` (`campaigns/jobs/system-deps.ts`), takže
     * odsud ji už nikdo znovu nezařadí a pád workeru tu kampaň zamkne natrvalo.
     * `campaign.watchdog` to nechytí: uzavírá až kampaně, které mají publikum
     * postavené, a tahle větev je za `if (!c.audienceBuiltAt) continue`.
     */
    const audiences = await tx.execute<{ id: string; workspace_id: string; idle: number }>(
      rawSql(
        `SELECT id, workspace_id,
                EXTRACT(EPOCH FROM (now() - updated_at))::int AS idle
           FROM campaigns
          WHERE deleted_at IS NULL
            AND status = 'queueing'
            AND audience_built_at IS NULL
            AND updated_at < now() - make_interval(mins => $1::int)
          ORDER BY workspace_id, id`,
        [minIdleMinutes],
      ),
    );

    return [
      ...imports.rows.map((row) => ({
        workspaceId: row.workspace_id,
        kind: 'import' as const,
        id: row.id,
        state: row.status,
        idleSeconds: Number(row.idle),
      })),
      ...audiences.rows.map((row) => ({
        workspaceId: row.workspace_id,
        kind: 'campaign_audience' as const,
        id: row.id,
        state: 'queueing',
        idleSeconds: Number(row.idle),
      })),
    ];
  });
}

export type StaleSegmentRow = { workspaceId: string; segmentId: string };

/**
 * Dynamické segmenty, jejichž přepočet je na řadě (`segments.recount`).
 *
 * Hranici stáří počítá VOLAJÍCÍ a předává ji sem hotovou, ne aby si ji dotaz
 * vyrobil z `now()`. Je to tentýž důvod jako u lhůty na obnovu projektu
 * v `purgeDeletedWorkspaces`: hodnota patří úloze, ne skenu.
 *
 * Podmínky odpovídají částečnému indexu `idx_segments__stale`. Bez výjimky
 * z izolace vracel tenhle dotaz pod aplikační rolí prázdno a index zůstal
 * nepoužitý.
 */
export async function listStaleSegments(cutoff: Date): Promise<StaleSegmentRow[]> {
  return withMaintenance(async (tx: Tx) => {
    await assertCrossWorkspaceVisibility(tx, 'segments');
    const r = await tx.execute<{ id: string; workspace_id: string }>(
      rawSql(
        `SELECT id, workspace_id
           FROM segments
          WHERE deleted_at IS NULL
            AND kind = 'dynamic'
            AND (cached_at IS NULL OR cached_at < $1::timestamptz)
          ORDER BY workspace_id, id`,
        [cutoff.toISOString()],
      ),
    );
    return r.rows.map((row) => ({ workspaceId: row.workspace_id, segmentId: row.id }));
  });
}

/**
 * Tvrdé smazání projektů, kterým vypršela lhůta na obnovu.
 *
 * Jediný ZÁPIS, který tenhle modul dělá. Kaskáda z `workspaces` odstraní
 * všechna data projektu; kontrola cizích klíčů běží pod vlastníkem tabulek
 * a RLS na ni nedopadá, takže role nepotřebuje DELETE nikde jinde.
 *
 * Politika `maintenance_purge` pustí jen řádky s vyplněným `deleted_at`. Lhůtu
 * kontroluje tenhle dotaz, ne politika, protože se smí měnit; politika drží
 * invariant, který se nemění, totiž že živý projekt tahle role nesmaže.
 */
export async function purgeDeletedWorkspaces(restoreWindowDays: number): Promise<number> {
  return withMaintenance(async (tx: Tx) => {
    const r = await tx.execute<{ id: string }>(
      rawSql(
        `DELETE FROM workspaces
          WHERE deleted_at IS NOT NULL
            AND deleted_at < now() - ($1 || ' days')::interval
        RETURNING id`,
        [String(restoreWindowDays)],
      ),
    );
    return r.rows.length;
  });
}
