import { sql } from 'drizzle-orm';
import { withAdminTx } from '../db';
import { knownKeyIds, loadOpsKeyring, missingGenerations } from '../keyring';
import { cannotRun, type DoctorCheck, type DoctorContext, type DoctorFinding } from './types';

const CANNOT_RECOMPUTE =
  'Otisky smazaných adres nejdou přepočítat, protože původní adresa je po výmazu podle GDPR pryč. ' +
  'Bez starého klíče se otisk přestane shodovat, smazaný člověk se vrátí prvním dalším importem, ' +
  'import proběhne úspěšně a nezaloguje se nic.';

/**
 * Pokolení, která jsou opravdu v datech.
 *
 * Zdroje jsou ve schématu **právě dva** a oba tu musí být:
 *   - `suppressions.fingerprint_key_id` (NOT NULL, má vlastní index),
 *   - `gdpr_requests.subject_email_fingerprint_key_id` (nullable, bez indexu).
 *
 * Druhý se snadno vynechá, protože je vzácnější. Instalace, která ztratila
 * klíč použitý výhradně u výmazů podle GDPR, by pak prošla jako zdravá.
 * `gdpr_requests` je malá tabulka, takže sekvenční průchod jednou za běh
 * diagnostiky je v pořádku a index se po P03 nechce.
 *
 * Šifrové obálky (`config_encrypted` a spol.) tu SCHVÁLNĚ nejsou. Jejich
 * pokolení se dá přešifrovat, tedy vada je opravitelná, a hlídá si je
 * `mlain rotate-credentials` sám. Tady jde jen o to, co přepočítat NELZE.
 */
async function generationsInData(adminUrl: string): Promise<number[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ key_id: number }>(
      sql`SELECT DISTINCT fingerprint_key_id AS key_id
            FROM suppressions
           WHERE fingerprint_key_id IS NOT NULL
           UNION
          SELECT DISTINCT subject_email_fingerprint_key_id AS key_id
            FROM gdpr_requests
           WHERE subject_email_fingerprint_key_id IS NOT NULL`,
    );
    return rows.map((r) => Number(r.key_id));
  });
}

async function countErasureFingerprints(adminUrl: string): Promise<number> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT (SELECT count(*) FROM suppressions)
                 + (SELECT count(*) FROM gdpr_requests
                     WHERE subject_email_fingerprint_key_id IS NOT NULL) AS n`,
    );
    return Number(rows[0]!.n);
  });
}

/**
 * Společná brána všech kontrol, které sahají do dat.
 *
 * Bez migrátora se data napříč projekty přečíst nedají a výsledek by byl
 * prázdný, ne správný. `withAdminTx` sice roli ověřuje taky, ale hodí výjimku;
 * diagnostika nesmí spadnout kvůli jedné kontrole, takže ji tady převádíme
 * na nález `check_failed`.
 */
async function withData<T>(
  ctx: DoctorContext,
  what: string,
  fn: (adminUrl: string) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; finding: DoctorFinding }> {
  if (ctx.adminUrl === null) {
    return { ok: false, finding: cannotRun(what, 'Chybí DATABASE_URL_MIGRATOR.') };
  }
  try {
    return { ok: true, value: await fn(ctx.adminUrl) };
  } catch (error) {
    return {
      ok: false,
      finding: cannotRun(what, `Dotaz do databáze selhal: ${(error as Error).message}.`),
    };
  }
}

const checkMissingGenerations: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  const data = await withData(ctx, 'chybějící pokolení klíče', generationsInData);
  if (!data.ok) return [data.finding];

  const missing = missingGenerations(keyring, data.value);
  if (missing.length === 0) return [];
  return [
    {
      id: 'missing_key_generations',
      severity: 'critical',
      title: `Instalace nezná pokolení klíče ${missing.join(', ')}`,
      detail:
        `V suppression listu a v žádostech podle GDPR jsou otisky zapsané pod pokoleními ` +
        `${missing.join(', ')}, ale instalace zná jen ${knownKeyIds(keyring).join(', ')}. ` +
        CANNOT_RECOMPUTE,
      action:
        'Doplňte chybějící klíče do SECRET_KEY_PREVIOUS ve tvaru <key_id>:<klíč>, oddělené čárkou, ' +
        'a restartujte všechny procesy. Klíče najdete v recovery bundle, který musí nést celý keyring.',
    },
  ];
};

const checkPreviousNotEmptied: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  if (keyring.currentKeyId === 1 || ctx.secretKeyPrevious.trim() !== '') return [];
  const data = await withData(ctx, 'prázdné SECRET_KEY_PREVIOUS', countErasureFingerprints);
  if (!data.ok) return [data.finding];
  if (data.value === 0) return [];
  return [
    {
      id: 'secret_key_previous_empty',
      severity: 'critical',
      title: 'SECRET_KEY_PREVIOUS je prázdné, přestože suppression list není',
      detail:
        `Aktuální pokolení je ${keyring.currentKeyId}, takže rotace už proběhla, ale žádné starší pokolení ` +
        `není k dispozici. ${CANNOT_RECOMPUTE} Totéž platí pro trackovací tokeny ve starých e-mailech, ` +
        'které navíc z databáze vůbec nejdou vyjmenovat, protože leží v cizích schránkách.',
      action:
        'SECRET_KEY_PREVIOUS se nikdy nevyprazdňuje, ani po mlain rotate-credentials. ' +
        'Vraťte do něj všechna předchozí pokolení.',
    },
  ];
};

const checkFingerprintMatches: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  // system_settings je na whitelistu tabulek BEZ RLS, takže by tenhle dotaz
  // prošel i pod aplikační rolí. Jde přesto přes migrátora, aby diagnostika
  // měla jedinou cestu k datům a nevznikla druhá, u které si za rok nikdo
  // nevzpomene, proč je jiná.
  const data = await withData(ctx, 'otisk SECRET_KEY', (adminUrl) =>
    withAdminTx(adminUrl, async (tx) => {
      const { rows } = await tx.execute<{ secret_key_fingerprint: string | null }>(
        sql`SELECT secret_key_fingerprint FROM system_settings WHERE id = true`,
      );
      return rows[0]?.secret_key_fingerprint ?? '';
    }),
  );
  if (!data.ok) return [data.finding];
  const stored = data.value;
  const known = [...keyring.fingerprints.values()];
  if (stored === '' || known.includes(stored)) return [];
  return [
    {
      id: 'secret_key_fingerprint_mismatch',
      severity: 'critical',
      title: 'Otisk SECRET_KEY nesedí s otiskem uloženým v instalaci',
      detail:
        `V system_settings je otisk ${stored}, ale instalace zná jen ${known.join(', ')}. ` +
        'Uložené přístupy k odesílání, AI klíče a tajemství webhooků nepůjde dešifrovat.',
      action:
        'Vraťte původní SECRET_KEY, nebo ho doplňte do SECRET_KEY_PREVIOUS. Když je klíč nenávratně ztracený, ' +
        'zadejte znovu přístupy k providerům a AI klíče; jiná oprava neexistuje.',
    },
  ];
};

const checkKeyIdCeiling: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  if (keyring.currentKeyId < 200) return [];
  return [
    {
      id: 'key_id_ceiling_near',
      severity: 'warning',
      title: `Pokolení klíče je ${keyring.currentKeyId}, strop formátu je 255`,
      detail:
        'Jednobajtové key_id v tokenech i v šifrové obálce má strop 255. Vyčerpání řeší budoucí verze ' +
        'formátu (prefix t2 u tokenů a version 0x02 u obálky), ne validace.',
      action: 'Naplánujte přechod na druhou verzi formátu dřív, než pokolení dosáhne 255.',
    },
  ];
};

export const keyringChecks: readonly DoctorCheck[] = [
  checkMissingGenerations,
  checkPreviousNotEmptied,
  checkFingerprintMatches,
  checkKeyIdCeiling,
];

export type { DoctorFinding };
