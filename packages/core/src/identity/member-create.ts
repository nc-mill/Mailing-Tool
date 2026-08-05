import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { assertPasswordPolicy, hashPassword, PASSWORD_MIN_LENGTH } from './password';
import { IdentityAuditActions } from './audit';
import { listMembers, type MemberRow } from './membership-service';
import type { Role, WorkspaceContext } from './types';

/**
 * Založení člena rovnou, bez pozvánky e-mailem.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Do projektu se dalo přidat člověka JEDINOU cestou:
 * pozvánkou, která odchází systémovým e-mailem. Jenže systémovou poštu odsud umí
 * odeslat pouze účet typu SMTP (`platform/system-mailer.ts`), takže instalace
 * s jediným účtem typu SES nemá jak pozvánku doručit. Správce vyplnil adresu,
 * pozvánka se zapsala do tabulky, a pozvaný člověk nedostal nikdy nic. U samo-
 * hostovaného produktu, kde správce sedí u serveru, je nastavení hesla rukou
 * legitimní cesta, ne obcházení bezpečnosti.
 *
 * CO SE TU NEDĚLÁ: heslo se NIKDY nemění existujícímu účtu. Kdyby to šlo, správce
 * jednoho projektu by si nastavením hesla převzal účet člověka z projektu cizího.
 * Když adresa v instalaci účet má, přidá se jen členství a heslo zůstává, jaké je.
 */

let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * Délka generovaného hesla ve znacích. 18 náhodných bajtů dá v base64url 24 znaků,
 * tedy 144 bitů entropie. Je to víc, než kdokoli udrží v hlavě, a to je záměr:
 * heslo se ukáže jednou, zkopíruje se a člen si ho po přihlášení změní.
 */
const GENERATED_PASSWORD_BYTES = 18;

/**
 * Vygenerované heslo musí projít TOUTÉŽ politikou jako heslo napsané rukou.
 *
 * Náhodný řetězec ji poruší jen jedním způsobem: může v sobě náhodou nést část
 * adresy před zavináčem. Je to nepravděpodobné, ne nemožné, a heslo, které projde
 * do odpovědi a pak ho `assertPasswordPolicy` odmítne až při přihlášení, by byl
 * účet, do kterého se nikdo nedostane. Proto se generuje, dokud politika neprojde.
 */
export function generateMemberPassword(email: string): string {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = randomBytes(GENERATED_PASSWORD_BYTES).toString('base64url');
    try {
      assertPasswordPolicy(candidate, email);
      return candidate;
    } catch {
      continue;
    }
  }
  /* c8 ignore next 3 -- deset po sobě jdoucích kolizí s adresou je fyzikálně
     nedosažitelné; větev existuje, aby funkce nemohla vrátit heslo bez kontroly. */
  throw new Error(
    `Nepodařilo se vygenerovat heslo delší než ${PASSWORD_MIN_LENGTH} znaků, které by neneslo část adresy ${email}.`,
  );
}

export type CreateMemberInput = {
  email: string;
  role: Role;
  /** `null` znamená „vygeneruj a vrať mi ho". Neprázdné heslo projde politikou. */
  password: string | null;
};

export type CreateMemberResult = {
  member: MemberRow;
  /**
   * Heslo se vrací POUZE tehdy, když ho vygeneroval server, a právě jednou.
   * Nikde se neukládá, nikam se neloguje a odpověď téhle trasy se schválně
   * neukládá do idempotenční tabulky (viz `members.routes.ts`).
   */
  generated_password: string | null;
  /**
   * `false` znamená, že účet s touhle adresou v instalaci už byl a přidalo se
   * jen členství. Heslo takového účtu se nemění.
   */
  password_set: boolean;
};

/**
 * Založí uživatele s heslem a rovnou mu dá členství v projektu.
 *
 * Běží v transakci volajícího, tedy pod kontextem projektu. `users` je na
 * whitelistu tabulek bez row level security (P03), takže se do ní dá zapsat
 * i odsud; `memberships` má `ws_isolation` s WITH CHECK proti kontextu, který
 * transakce nese.
 */
export async function createMember(
  tx: Tx,
  ctx: WorkspaceContext,
  input: CreateMemberInput,
  actorLabel: string,
): Promise<CreateMemberResult> {
  const email = input.email.trim().toLowerCase();

  const { rows: existing } = await tx.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM users WHERE email = ${email} AND deleted_at IS NULL LIMIT 1
  `);
  const existingUserId = existing[0]?.id ?? null;

  if (existingUserId !== null) {
    const { rows: member } = await tx.execute(sql`
      SELECT 1 FROM memberships
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND user_id = ${existingUserId}::uuid
       LIMIT 1
    `);
    if (member.length > 0) throw new ApiError('conflict', { params: { reason: 'already_member' } });
  }

  let generatedPassword: string | null = null;
  let userId = existingUserId;

  if (userId === null) {
    // Politika hesla je stejná jako při instalaci. Žádné měkčí pravidlo pro účty
    // zakládané správcem: heslo, které si člen nezmění, chrání celý projekt.
    const password = input.password ?? generateMemberPassword(email);
    if (input.password === null) generatedPassword = password;
    assertPasswordPolicy(password, email);
    const passwordHash = await hashPassword(password);

    // Locale a timezone se dědí z projektu, do kterého člen vstupuje, ne
    // z konfigurace instalace: kdo pracuje v německém projektu, chce německé
    // rozhraní. DEFAULT v DDL je jen pojistka, aplikace vyplňuje vždy (2.3).
    const { rows: workspaces } = await tx.execute<{ locale: string; timezone: string }>(sql`
      SELECT locale, timezone FROM workspaces WHERE id = ${ctx.workspaceId}::uuid LIMIT 1
    `);
    const locale = workspaces[0]?.locale ?? cfg().DEFAULT_LOCALE;
    const timezone = workspaces[0]?.timezone ?? cfg().DEFAULT_TIMEZONE;

    const [created] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash,
        name: '',
        locale,
        timezone,
        // Adresu ověřil správce tím, že účet zakládá rukou. Nechat ji neověřenou
        // by znamenalo čekat na potvrzovací e-mail, tedy přesně na to, co v téhle
        // instalaci nefunguje a kvůli čemu tahle cesta existuje.
        emailVerifiedAt: new Date(),
      })
      .returning({ id: schema.users.id });
    userId = created!.id;
  }

  await tx.execute(sql`
    INSERT INTO memberships (workspace_id, user_id, role)
    VALUES (${ctx.workspaceId}::uuid, ${userId}::uuid, ${input.role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
  `);

  // Čekající pozvánka na tutéž adresu už nemá co plnit a její token by zůstal
  // platných sedm dní. Ruší se tady, ne úlohou: člen do projektu právě vstoupil.
  await tx.execute(sql`
    UPDATE invitations SET revoked_at = now()
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}
       AND accepted_at IS NULL AND revoked_at IS NULL
  `);

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.created'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: userId,
    /**
     * Heslo samo se do auditu NEPÍŠE, jen jestli ho zadal správce, nebo vzniklo.
     *
     * Pole se schválně nejmenuje `password_*`. Redakce auditu (`audit/redact.ts`)
     * zakrývá KAŽDÝ klíč, jehož jméno slovo `password` obsahuje, takže by
     * v záznamu stálo `[redacted]` místo užitečné informace. Ověřeno spuštěním.
     */
    metadata: {
      email,
      role: input.role,
      credential_origin:
        existingUserId !== null ? 'unchanged' : generatedPassword ? 'generated' : 'set',
      existing_user: existingUserId !== null,
    },
  });

  const members = await listMembers(tx, ctx);
  const member = members.find((m) => m.user_id === userId);
  /* c8 ignore next -- členství vzniklo o tři řádky výš, v téže transakci. */
  if (!member) throw new ApiError('not_found');

  return {
    member,
    generated_password: generatedPassword,
    password_set: existingUserId === null,
  };
}
