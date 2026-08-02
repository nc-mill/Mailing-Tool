import { keyringChecks } from './checks-keyring';
import { runtimeChecks } from './checks-runtime';
import { storageChecks } from './checks-storage';
import { workspaceChecks } from './checks-workspace';
import { sortFindings } from './format';
import type { DoctorContext, DoctorFinding } from './types';

const ALL_CHECKS = [...keyringChecks, ...storageChecks, ...runtimeChecks, ...workspaceChecks];

export type DoctorReport = { findings: DoctorFinding[] };

/**
 * Každá kontrola běží zvlášť a její pád je vlastní nález. Kdyby jedna selhaná
 * kontrola shodila celý příkaz, provozovatel by se nedozvěděl nic o zbylých,
 * a mezi nimi jsou ty, které hlásí už nastalou ztrátu ochrany.
 */
export async function runDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const results = await Promise.all(
    ALL_CHECKS.map(async (check) => {
      try {
        return await check(ctx);
      } catch (err) {
        return [
          {
            id: 'check_failed',
            severity: 'warning' as const,
            title: 'Kontrolu se nepodařilo dokončit',
            detail: err instanceof Error ? err.message : String(err),
            action: 'Ověřte připojení k databázi a přístupová práva a spusťte mlain doctor znovu.',
          },
        ];
      }
    }),
  );
  return { findings: sortFindings(results.flat()) };
}
