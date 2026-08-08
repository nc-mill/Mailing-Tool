import { sql } from 'drizzle-orm';
import type { Tx } from '../tx';
import { withoutContext } from '../tx';
import { ApiError } from '../errors/api-error';
import { writeAuditLog } from '../audit/write';
import { IdentityAuditActions } from './audit';
import { revokeUserSessions } from './session';
import { listWorkspaces, ownsAnyWorkspace } from './workspace-service';
import type { WorkspaceContext } from './types';

/**
 * Smazání uživatelského účtu z instalace.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Rozhraní umělo účet jedině ZALOŽIT a ODEBRAT
 * z projektu. Odebrání ruší členství, ne účet, takže po něm zůstal uživatel,
 * který se pořád přihlásí, skončí na `/no-workspace`, a v rozhraní ho nikdo
 * neuvidí: obrazovka Tým vypisuje členy projektu a on v žádném není. Vznikl
 * tak neviditelný účet, který nešlo ani najít, ani smazat, a jediná cesta ven
 * vedla přes ruční SQL.
 *
 * MAŽE SE MĚKCE, tedy `users.deleted_at`, a nejsou to úspory na práci:
 *
 * 1. Cizí klíče na `users` jsou `ON DELETE SET NULL` (kampaně, šablony, klíče
 *    k API, projekty, pozvánky). Tvrdé smazání by tedy prošlo, ale u všeho, co
 *    ten člověk vytvořil, by zmizelo „kdo to udělal". Měkké smazání to nechá být.
 * 2. Jednoznačný index `uq_users__email` je částečný přes `deleted_at IS NULL`,
 *    takže adresa je hned po smazání volná a účet se dá založit znovu. Schéma
 *    s tímhle způsobem mazání počítá od začátku.
 * 3. Projekt i kontakty se v tomhle produktu mažou taky měkce. Účet by byl
 *    jediná výjimka.
 * 4. `sessions.revoked_reason` má hodnotu `user_deleted` už od P04.
 *
 * AUDITNÍ ZÁZNAMY SE NEMAŽOU. `audit_log.actor_id` je obyčejný `uuid` BEZ cizího
 * klíče (`schema/partitioned.ts`), právě aby doklad o tom, kdo co udělal, přežil
 * zánik aktéra. Ověřeno v definici tabulky, ne odhadem.
 */

/**
 * Kolik účtů výpis osiřelých projde.
 *
 * Strop existuje kvůli tomu, JAK se osiřelost zjišťuje: pro každý účet zvlášť,
 * protože `memberships` i `workspaces` mají row level security a napříč projekty
 * je z kontextu jednoho projektu přečíst nejde. Sáhnout na ně bez izolace by
 * znamenalo migrátorské spojení, které instalace nemusí mít, nebo obejití
 * izolace, což je horší než pomalejší výpis. Samohostovaná instalace má členů
 * jednotky až desítky, takže strop nikdo nepotká.
 */
export const ORPHAN_SCAN_LIMIT = 500;

/**
 * Závora pro operace nad ÚČTY CELÉ INSTALACE (nález N6).
 *
 * Výpis osiřelých účtů i mazání účtu byly hlídané oprávněním `members:remove`.
 * To je ale role v PROJEKTU, kdežto obojí sahá napříč instalací: výpis vrací
 * e-maily, jména a časy posledního přihlášení VŠECH účtů, i těch, které
 * s projektem volajícího nemají nic společného. Admin jednoho projektu tak
 * viděl adresář celé instalace a uměl z něj mazat.
 *
 * ROLE INSTALACE V PRODUKTU NEEXISTUJE. `users` sloupec s rolí nemá a
 * `ROLE_ORDER` v `permissions.ts` je `viewer, editor, admin, owner`, tedy samé
 * role uvnitř projektu. Nejjednodušší poctivé řešení proto NEZAVÁDÍ nový pojem,
 * ale bere ten, který produkt už používá pro rozhodnutí téhož druhu: vlastnictví
 * aspoň jednoho živého projektu. Přesně tak se ptá `assertMayCreateWorkspace`
 * u zakládání projektů (rozhodnutí zadavatele ze 7. 8. 2026: „projekty smí
 * zakládat pouze nejvyšší role"), takže „správce instalace" znamená v obou
 * místech totéž a nevzniká druhý zdroj pravdy.
 *
 * Nový sloupec ani tabulka by byly poctivější jen zdánlivě: musely by se plnit
 * při instalaci, migrovat u běžících instalací a nikdo by je neuměl spravovat,
 * protože obrazovka pro správu instalace neexistuje. Až taková obrazovka
 * vznikne, je tohle jediné místo, které se změní.
 *
 * AKTÉR TYPU KLÍČ NEPROJDE NIKDY. Klíč patří jednomu projektu a jeho scopy jsou
 * projektové; kdyby stačil scope `members:remove`, byl by klíč vydaný pro jeden
 * projekt tou nejtišší cestou k účtům celé instalace. Systémový aktér projde,
 * stejně jako v `assertPermission`: to jsou úlohy na pozadí, ne request.
 */
export async function assertInstallationAdmin(ctx: WorkspaceContext): Promise<void> {
  const actor = ctx.actor;
  if (actor.type === 'system') return;
  if (actor.type === 'user' && (await ownsAnyWorkspace(actor.userId))) return;
  throw new ApiError('forbidden', {
    params: {
      reason: 'installation_admin_only',
      requiredRole: 'owner',
      currentRole: actor.type === 'user' ? actor.role : null,
    },
  });
}

export type OrphanedAccount = {
  user_id: string;
  email: string;
  name: string;
  created_at: string;
  last_login_at: string | null;
};

type UserRow = {
  id: string;
  email: string;
  name: string;
  created_at: Date;
  last_login_at: Date | null;
};

/**
 * Účty bez jediného projektu.
 *
 * ČLENSTVÍ VE SMAZANÉM PROJEKTU SE NEPOČÍTÁ, a je to podstatné. Projekt se maže
 * měkce, takže po jeho smazání zůstane řádek v `memberships`, který ukazuje na
 * projekt, jenž se nikde nezobrazuje. Účet, kterému zbyla jen taková členství,
 * je z pohledu uživatele bez projektu a musí být vidět tady; kdyby se počítala
 * všechna členství, zůstal by neviditelný napořád. `listWorkspaces` smazané
 * projekty odfiltrovává, takže se tou funkcí zjišťuje totéž, co uvidí sám
 * uživatel po přihlášení.
 *
 * `users` je na whitelistu tabulek bez row level security (P03), takže seznam
 * kandidátů jde přečíst bez kontextu. Členství se pak čtou POD TÍM UŽIVATELEM
 * cestou `withUser`, kterou politika `user_own_memberships` k tomu účelu
 * vystavuje. Pod kontextem projektu by dotaz viděl jen členství v tomhle jednom
 * projektu a účet z cizího projektu by vypadal jako osiřelý, což by byla nejen
 * chyba, ale rovnou cesta ke smazání cizího člena.
 */
export async function listOrphanedAccounts(): Promise<OrphanedAccount[]> {
  const candidates = await withoutContext(async (tx) => {
    const { rows } = await tx.execute<UserRow>(sql`
      SELECT id::text AS id, email::text AS email, name, created_at, last_login_at
        FROM users
       WHERE deleted_at IS NULL
       ORDER BY created_at
       LIMIT ${ORPHAN_SCAN_LIMIT}
    `);
    return rows;
  });

  const orphaned: OrphanedAccount[] = [];
  for (const user of candidates) {
    const workspaces = await listWorkspaces(user.id);
    if (workspaces.length > 0) continue;
    orphaned.push({
      user_id: user.id,
      email: user.email,
      name: user.name,
      created_at: new Date(user.created_at).toISOString(),
      last_login_at: user.last_login_at ? new Date(user.last_login_at).toISOString() : null,
    });
  }
  return orphaned;
}

export type DeleteUserResult = { email: string; revoked_sessions: number };

/**
 * Smaže účet, který nepatří do žádného projektu.
 *
 * SMAZAT JDE JEN ÚČET BEZ PROJEKTU, a je to bezpečnostní rozhodnutí, ne
 * omezení z pohodlí. Role jsou v tomhle produktu vlastnost projektu, ne
 * instalace: `members:remove` má správce projektu. Kdyby se tou pravomocí dal
 * smazat účet napříč instalací, správce projektu B by smazal člena projektu A,
 * do kterého nevidí a nemá tam co pohledávat. Účet bez projektu nepatří nikomu,
 * takže tenhle spor nevzniká.
 *
 * Praktický důsledek: člena se smaže ve dvou krocích. Nejdřív „Odebrat
 * z projektu", což má vlastní dialog s následky, pak se objeví mezi účty bez
 * projektu a teprve tam se maže. Krok navíc je tu záměrně: nevratná operace
 * napříč instalací se nemá schovávat vedle vratné operace v projektu.
 */
export async function deleteUserAccount(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { userId: string; workspaceCount: number },
  actorLabel: string,
): Promise<DeleteUserResult> {
  // Sám sebe nesmaže nikdo. Aktér je členem projektu, ze kterého operaci volá,
  // takže mezi osiřelými účty být nemůže; kontrola je tu proto, že se na to
  // nesmí spoléhat: kdo si smaže vlastní účet, zamkne se z instalace ven.
  if (ctx.actor.type === 'user' && ctx.actor.userId === input.userId) {
    throw new ApiError('conflict', { params: { reason: 'cannot_delete_self' } });
  }

  // Účet mezitím do nějakého projektu vstoupil. Zjišťuje se to mimo tuhle
  // transakci (viz `listOrphanedAccounts`), takže se výsledek předává sem;
  // uvnitř transakce s kontextem projektu by se napříč projekty nepřečetl.
  if (input.workspaceCount > 0) {
    throw new ApiError('conflict', {
      params: { reason: 'still_member', workspaces: input.workspaceCount },
    });
  }

  const { rows: found } = await tx.execute<{ email: string }>(sql`
    SELECT email::text AS email FROM users
     WHERE id = ${input.userId}::uuid AND deleted_at IS NULL
     LIMIT 1
  `);
  const email = found[0]?.email;
  if (!email) throw new ApiError('not_found');

  /**
   * Poslední živý účet instalace zůstává, i kdyby do žádného projektu nepatřil.
   *
   * Instalace bez jediného účtu se nedá spravovat vůbec: průvodce prvním
   * spuštěním se už nespustí (`system_settings.setup_completed_at` je vyplněné
   * a `users` by musela být prázdná), takže by jedinou cestou dovnitř byl zásah
   * do databáze rukou.
   */
  const { rows: alive } = await tx.execute<{ c: string }>(sql`
    SELECT count(*) AS c FROM users WHERE deleted_at IS NULL
  `);
  if (Number(alive[0]!.c) <= 1) {
    throw new ApiError('conflict', { params: { reason: 'last_account' } });
  }

  const { rows: deleted } = await tx.execute<{ id: string }>(sql`
    UPDATE users SET deleted_at = now(), updated_at = now()
     WHERE id = ${input.userId}::uuid AND deleted_at IS NULL
     RETURNING id::text AS id
  `);
  // Souběžné druhé smazání skončí na nule řádků a transakce se rollbackne.
  if (deleted.length !== 1) throw new ApiError('not_found');

  /**
   * Relace se ruší v TÉŽE transakci. Bez toho by se smazaný člověk s otevřenou
   * kartou pohyboval po aplikaci dál: `verifySessionToken` kontroluje relaci,
   * ne stav uživatele, takže by cookie platila až do vypršení. Přihlásit se
   * znovu už nedokáže, `login` filtruje `deleted_at IS NULL`.
   */
  const revoked = await revokeUserSessions(tx, input.userId, 'user_deleted');

  // Nepoužité odkazy na obnovu hesla se zneplatní. Jinak by odkaz vydaný před
  // smazáním pořád mířil na existující řádek a lákal k pokusu, který stejně
  // skončí na `unauthenticated`.
  await tx.execute(sql`
    UPDATE password_reset_tokens SET used_at = now()
     WHERE user_id = ${input.userId}::uuid AND used_at IS NULL
  `);

  /**
   * Členství ve SMAZANÝCH projektech se nechávají být.
   *
   * Nedají se odsud smazat: `memberships` má politiku `ws_isolation` proti
   * kontextu projektu a tohle je kontext jiného projektu. Škodit nemůžou:
   * `listMembers` i počítání vlastníků smazané uživatele přeskakují, takže se
   * ani po obnově projektu neobjeví duch v seznamu členů. Kaskáda je odklidí,
   * až úklidová úloha smazaný projekt tvrdě smaže.
   */

  await writeAuditLog(tx, {
    action: IdentityAuditActions['user.deleted'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: input.userId,
    // Žádné pole se jménem obsahujícím `password`: redakce auditu by ho zakryla.
    metadata: { email, mode: 'soft', revoked_sessions: revoked },
  });

  return { email, revoked_sessions: revoked };
}
