import { sql } from 'drizzle-orm';
import { withAdminTx } from '../db';
import {
  SYSTEM_MAIL_ACCOUNT_FILTER,
  SYSTEM_MAIL_ACCOUNT_ORDER,
  SYSTEM_MAIL_CAPABLE_TYPES,
} from '../../platform/system-mail-config';
import { cannotRun, type DoctorCheck, type DoctorFinding } from './types';

type WorkspaceRow = { id: string; name: string; settings: Record<string, unknown> };

/**
 * `workspaces` má politiku `ws_isolation_self` přes `id`, takže pod aplikační
 * rolí bez kontextu vrátí PRÁZDNO. Obě kontroly v tomhle souboru procházejí
 * všechny projekty, což je z definice cesta napříč izolací, a jde tedy jen
 * přes migrátora.
 */
async function loadWorkspaces(adminUrl: string): Promise<WorkspaceRow[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<WorkspaceRow>(
      sql`SELECT id, name, settings FROM workspaces
           WHERE deleted_at IS NULL ORDER BY created_at`,
    );
    return rows;
  });
}

const checkTrialMode: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('zkušební režim', 'Chybí DATABASE_URL_MIGRATOR.')];
  const findings: DoctorFinding[] = [];
  for (const ws of await loadWorkspaces(ctx.adminUrl)) {
    const trial = ws.settings['trialMode'] as { enabled?: boolean } | undefined;
    if (trial?.enabled !== true) continue;
    findings.push({
      id: 'trial_mode_enabled',
      severity: 'info',
      title: `Projekt ${ws.name} běží ve zkušebním režimu`,
      detail:
        'Odesílá se jen na ověřené adresy, nejvýš 10 adres a 50 e-mailů za 24 hodin. Kampaň na větší ' +
        'publikum odejde jen na ověřené adresy, i když to publikum ukazuje jinak.',
      action:
        'Až bude doména ověřená, zkušební režim vypněte jedním kliknutím v nastavení odesílání.',
    });
  }
  return findings;
};

const checkDemoData: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('ukázková data', 'Chybí DATABASE_URL_MIGRATOR.')];
  const findings: DoctorFinding[] = [];
  for (const ws of await loadWorkspaces(ctx.adminUrl)) {
    const demo = ws.settings['demoData'] as { contactIds?: string[] } | undefined;
    if (!demo || !Array.isArray(demo.contactIds) || demo.contactIds.length === 0) continue;
    findings.push({
      id: 'demo_data_present',
      severity: 'info',
      title: `V projektu ${ws.name} jsou ukázková data (${demo.contactIds.length} kontaktů)`,
      detail:
        'Adresy jsou na doméně example.com, takže se na ně nedá nic doručit. V tabulce kontaktů je ' +
        'najdete filtrem podle štítku Ukázková data.',
      action: 'Až je nebudete potřebovat, odstraňte je tlačítkem na Přehledu.',
    });
  }
  return findings;
};

/**
 * Umí projekt odeslat systémový e-mail?
 *
 * PROČ TAHLE KONTROLA EXISTUJE. Projekt bez použitelného odesílacího účtu
 * neodešle pozvánku, obnovu hesla ani ověření adresy ve zkušebním režimu, a dosud
 * se to dalo zjistit VÝHRADNĚ z řádku `system_mail_failed` v logu aplikace.
 * Provozovatel se to tak dozvěděl teprve tehdy, když někdo zapomněl heslo, což je
 * nejhorší možný okamžik: bez pošty se do instalace nedostane zpátky.
 *
 * ZÁVADNÝ STAV SE ZÚŽIL. Do doplnění větve pro SES sem spadal i projekt, který má
 * jen účet typu SES; ten dnes odešle. Zbývají dva stavy: projekt nemá žádný
 * použitelný účet, nebo mu zmizel ten, který si vybral v nastavení.
 *
 * Závažnost je `warning`, ne `critical`: instalace funguje dál, jen jí chybí cesta
 * pro poštu o účtech. Náprava je uvedená v `action`, včetně příkazu, kterým se dá
 * heslo obnovit i bez pošty.
 */
const checkSystemMail: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('systémová pošta', 'Chybí DATABASE_URL_MIGRATOR.')];

  const rows = await withAdminTx(ctx.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{
      id: string;
      name: string;
      selected: string | null;
      type: string | null;
    }>(sql`
      SELECT w.id, w.name,
             w.settings #>> '{systemMail,provider_id}' AS selected,
             (SELECT p.type FROM sending_providers p
               WHERE p.workspace_id = w.id
                 AND ${sql.raw(SYSTEM_MAIL_ACCOUNT_FILTER)}
                 AND (w.settings #>> '{systemMail,provider_id}' IS NULL
                      OR p.id::text = w.settings #>> '{systemMail,provider_id}')
               ORDER BY ${sql.raw(SYSTEM_MAIL_ACCOUNT_ORDER)}
               LIMIT 1) AS type
        FROM workspaces w
       WHERE w.deleted_at IS NULL
       ORDER BY w.created_at
    `);
    return rows;
  });

  const findings: DoctorFinding[] = [];
  for (const ws of rows) {
    if (ws.type !== null && SYSTEM_MAIL_CAPABLE_TYPES.includes(ws.type)) continue;
    const detail =
      ws.type === null && ws.selected !== null
        ? `Projekt ${ws.name} má pro systémovou poštu vybraný odesílací účet, který už neexistuje nebo je vypnutý.`
        : ws.type === null
          ? `Projekt ${ws.name} nemá ani jeden použitelný odesílací účet.`
          : `Projekt ${ws.name} má odesílací účet typu ${ws.type}, kterým systémová pošta odejít neumí.`;
    findings.push({
      id: 'system_mail_unavailable',
      severity: 'warning',
      title: `Projekt ${ws.name} neodešle systémový e-mail`,
      detail:
        `${detail} Neodejde tedy pozvánka do projektu, obnova zapomenutého hesla ani ověření ` +
        'adresy ve zkušebním režimu.',
      action:
        'Stav a nastavení najdete v Nastavení → Systémová pošta. Přidejte v Nastavení → Odesílání ' +
        'odesílací účet, typu SES nebo SMTP; systémová pošta odejde oběma. Než to uděláte, ' +
        'zakládejte členy v Nastavení → Tým rovnou s heslem a hesla obnovujte příkazem ' +
        'mlain reset-password <e-mail>.',
    });
  }
  return findings;
};

export const workspaceChecks: readonly DoctorCheck[] = [
  checkTrialMode,
  checkDemoData,
  checkSystemMail,
];
