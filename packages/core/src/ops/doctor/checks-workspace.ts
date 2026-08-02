import { sql } from 'drizzle-orm';
import { withAdminTx } from '../db';
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

export const workspaceChecks: readonly DoctorCheck[] = [checkTrialMode, checkDemoData];
