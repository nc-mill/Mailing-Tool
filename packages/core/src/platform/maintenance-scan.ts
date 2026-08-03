import { withMaintenance, type Tx } from '../tx';
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
 *  2. GRANTY. Role má práva na tři tabulky: SELECT na `workspaces`,
 *     `campaigns` a `sender_domains` a DELETE na `workspaces`. Dotaz na cokoli
 *     jiného skončí na `permission denied`, ne prázdnem.
 *  3. POLITIKY. Migrace 0009 dává těmhle tabulkám `maintenance_*` s
 *     `USING (true)` pro čtení a mazání omezuje na už měkce smazané projekty.
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
