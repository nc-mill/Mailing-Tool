import 'server-only';
import { redirect } from 'next/navigation';
import type { Result } from '@/lib/api-client/result';
import { getCurrentUser, type CurrentUser } from './current-user';

/**
 * Autentizační brána žije v obrazovce, ne v `proxy.ts`, protože ten soubor
 * vlastní P05 (rozhodnutí R9). Na 401 přesměruje s parametrem `next`, jak
 * žádá tabulka navigačních pravidel 4.4 části 6. Jiné chyby vrací volajícímu,
 * aby je uměl vykreslit jako stav S9 s request_id.
 */
export async function requireUser(nextPath: string): Promise<Result<CurrentUser>> {
  const result = await getCurrentUser();
  if (!result.ok && result.problem.status === 401) {
    redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  }
  return result;
}
