import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '../tx';
import { loadConfig, type MlainConfig } from '../config';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { assertPasswordPolicy, hashPassword } from './password';
import { IdentityAuditActions } from './audit';
import { toPublicUser, type PublicUser } from './login';
import { createSession } from './session';
import { tokenHash } from './token';
import type { Role } from './types';

/**
 * ZALOŽENÍ ÚČTU Z POZVÁNKY.
 *
 * PROČ TENHLE SOUBOR VZNIKL, A JE TO SLEPÁ ULIČKA, NE VYLEPŠENÍ. Do téhle
 * chvíle uměla instalace založit účet PRÁVĚ DVĚMA způsoby: průvodcem prvního
 * spuštění (`setup.ts`, jednou za život instalace) a rukou správcem
 * (`member-create.ts`, který heslo vygeneruje a ukáže na obrazovce). Žádná
 * cesta veřejné registrace v repozitáři NEEXISTUJE, ověřeno výčtem tras
 * `/api/v1/*` a tím, že do `users` zapisují jen ty dva soubory.
 *
 * Pozvánka e-mailem přitom existuje, odchází a odkaz v ní vede na obrazovku
 * přijetí. Jenže `acceptInvitation` chce `userId`, tedy přihlášeného člověka.
 * Pozvaný, který účet nemá, se na obrazovce dočetl „Přihlaste se nebo si
 * založte účet a pozvánku pak přijmete" a založit účet neměl kde. Celá funkce
 * pozvánek tak fungovala výhradně pro lidi, kteří v instalaci účet UŽ MĚLI,
 * tedy pro ty, kdo ji nepotřebují.
 *
 * PROČ TO NENÍ OTEVŘENÍ REGISTRACE. Účet tu nevznikne bez 32bajtového tokenu,
 * který vydá jen stávající člen projektu s právem zvát a který odejde jedině
 * e-mailem na adresu, kterou tenhle člen napsal. Adresa nového účtu se bere
 * Z POZVÁNKY, ne od návštěvníka, takže si nikdo nemůže založit účet na cizí
 * ani smyšlenou adresu. Instalace se tím veřejně neotevírá o nic víc, než
 * když správce založí člena rukou.
 *
 * `SIGNUP_MODE` řídí, jestli je tahle cesta zapnutá:
 *   `closed`  účty zakládá výhradně správce rukou; pozvánka pro člověka bez
 *             účtu skončí srozumitelnou hláškou místo mlčení,
 *   `invite`  účet smí vzniknout jen s platným tokenem pozvánky (výchozí).
 *
 * Třetí hodnota `open` z enumu 7. 8. 2026 zmizela. Veřejnou registraci
 * neimplementovala a chovala se jako `invite`; důvody u `SIGNUP_MODE`
 * v `config/schema-platform.ts`.
 */

let cachedConfig: MlainConfig | null = null;
function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/** Jen pro testy, které si mezi případy přepínají `SIGNUP_MODE`. */
export function resetSignupConfigCache(): void {
  cachedConfig = null;
}

export type InvitationSignupInput = {
  token: string;
  password: string;
  name?: string | undefined;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

export type InvitationSignupResult = {
  user: PublicUser;
  workspace: { id: string; name: string; slug: string };
  role: Role;
  /** Relační token. Kdo si právě nastavil heslo, nemá se čím přihlašovat znovu. */
  token: string;
};

/**
 * Založí účet na adresu z pozvánky, přijme pozvánku a rovnou přihlásí.
 *
 * VŠECHNO V JEDNÉ TRANSAKCI. Kdyby se to rozpadlo na „založ účet" a „přijmi
 * pozvánku", vznikl by při pádu mezi nimi účet bez jediného členství, tedy
 * přesně ten stav, kvůli kterému obrazovka „nemáte přístup k žádnému projektu"
 * existuje. Uživatel by měl heslo, přihlásil by se a neviděl by nic.
 *
 * POŘADÍ NASTAVOVÁNÍ KONTEXTU JE VYNUCENÉ POLITIKAMI, ne libovolné:
 *   1. Pozvánka se čte JAKO PRVNÍ, dokud je `mlain.workspace_id` prázdné.
 *      Politika `invitation_token_lookup` z migrace 0004 pouští řádek jedině
 *      tehdy, a se sadou `mlain.workspace_id` by dotaz vrátil nula řádků.
 *   2. `mlain.user_id` se nastaví po vložení uživatele.
 *   3. `mlain.workspace_id` se nastaví až nakonec, protože bez něj neprojde
 *      ani čtení projektu (`ws_isolation_self`), ani vložení členství
 *      (`ws_isolation` má WITH CHECK proti kontextu).
 * Je to týž postup, jaký v `setup.ts` popisuje komentář u `runSetup`.
 */
export async function signupFromInvitation(
  input: InvitationSignupInput,
): Promise<InvitationSignupResult> {
  if (cfg().SIGNUP_MODE === 'closed') {
    throw new ApiError('signup_closed');
  }

  const hash = tokenHash(input.token);
  const userId = uuidv7();

  return withoutContext(async (tx) => {
    const { rows: invitations } = await tx.execute<Record<string, unknown>>(sql`
      SELECT id::text AS id, workspace_id::text AS workspace_id, role, email::text AS email
        FROM invitations
       WHERE token_hash = ${hash}
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       LIMIT 1
    `);
    const invitation = invitations[0];
    // Neplatný, prošlý, odvolaný i použitý token vrací shodně 404, stejně jako
    // `acceptInvitation`. Z reakce nesmí jít zjistit, jestli pozvánka existuje.
    if (!invitation) throw new ApiError('not_found');

    const email = (invitation.email as string).trim().toLowerCase();
    const workspaceId = invitation.workspace_id as string;
    const role = invitation.role as Role;

    // Účet na tuhle adresu už existuje. NEPŘEBÍRÁ se a heslo se mu NEMĚNÍ:
    // jinak by kdokoli s pozvánkou na cizí adresu přepsal heslo cizímu účtu.
    // Správná cesta je přihlásit se a pozvánku přijmout, což obrazovka nabízí.
    const { rows: existing } = await tx.execute(sql`
      SELECT 1 FROM users WHERE email = ${email} AND deleted_at IS NULL LIMIT 1
    `);
    if (existing.length > 0) {
      throw new ApiError('conflict', { params: { reason: 'account_exists' } });
    }

    // Heslo prochází TOUTÉŽ politikou jako u průvodce i u obnovy hesla.
    assertPasswordPolicy(input.password, email);
    const passwordHash = await hashPassword(input.password);

    // Jazyk a časové pásmo dědí PROJEKT, ne instalace. Nový člen bude pracovat
    // v něm, a `member-create.ts` i pozvánkový e-mail to dělají stejně.
    // Čte se to bez workspace kontextu, tedy pod politikou, která projekt
    // ještě nevidí; proto přes `ws_insert_bootstrap`-neutrální cestu níž.
    const { rows: settings } = await tx.execute<{ locale: string; timezone: string }>(sql`
      SELECT locale, timezone FROM workspaces WHERE id = ${workspaceId}::uuid LIMIT 1
    `);

    const [user] = await tx
      .insert(schema.users)
      .values({
        id: userId,
        email,
        passwordHash,
        name: input.name ?? '',
        locale: settings[0]?.locale ?? cfg().DEFAULT_LOCALE,
        timezone: settings[0]?.timezone ?? cfg().DEFAULT_TIMEZONE,
        // Adresa je ověřená TÍM, že se člověk dostal k tokenu z e-mailu na ni
        // poslaného. Druhé ověřování by po něm chtělo potvrdit adresu, kterou
        // právě potvrdil, a instalace bez systémové pošty by ho zablokovala
        // úplně, přestože pozvánka odešla.
        emailVerifiedAt: new Date(),
      })
      .returning();

    await tx.execute(sql`SELECT set_config('mlain.user_id', ${userId}, true)`);
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const { rows: workspaces } = await tx.execute<{ name: string; slug: string }>(sql`
      SELECT name, slug FROM workspaces
       WHERE id = ${workspaceId}::uuid AND deleted_at IS NULL
       LIMIT 1
    `);
    const workspace = workspaces[0];
    // Smazaný projekt se pozná až tady, protože teprve teď je řádek viditelný.
    // Transakce se zruší celá, takže po pokusu nezůstane osiřelý účet.
    if (!workspace) throw new ApiError('not_found');

    const { rows: accepted } = await tx.execute(sql`
      UPDATE invitations SET accepted_at = now(), accepted_by = ${userId}::uuid
       WHERE id = ${invitation.id as string}::uuid
         AND accepted_at IS NULL AND revoked_at IS NULL
      RETURNING id
    `);
    // Souběžné druhé přijetí skončí na nule řádků a transakce se rollbackne.
    if (accepted.length !== 1) throw new ApiError('not_found');

    await tx.insert(schema.memberships).values({ workspaceId, userId, role });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['member.joined'],
      workspaceId,
      actor: { actorType: 'user', actorId: userId, actorLabel: email },
      targetType: 'invitation',
      targetId: invitation.id as string,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { invited_email: email, accepted_email: email, role, source: 'signup' },
    });

    const session = await createSession(tx, {
      userId,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return {
      user: toPublicUser(user!),
      workspace: { id: workspaceId, name: workspace.name, slug: workspace.slug },
      role,
      token: session.token,
    };
  });
}
