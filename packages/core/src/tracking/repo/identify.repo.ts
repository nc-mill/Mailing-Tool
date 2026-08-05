import { sql } from 'drizzle-orm';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { TtlLru } from '../click/lru';

/**
 * Čtení pro `identify` z web SDK, viz plán P10 Task 28.
 *
 * ROZSAH SE PŘEDÁVÁ KONTEXTEM, ne řetězcem, stejně jako v `settings-service.ts`.
 * Funkce si samy otevírají transakci, takže dokud braly `workspaceId: string`,
 * rozhodovaly o izolaci podle hodnoty, které nikdo neručí: kdo je zavolal
 * s cizím identifikátorem, dostal cizí kontakty a cizí podepisovací klíče.
 * `WorkspaceContext` je branded typ z jediné továrny, takže je rozsah vidět
 * z podpisu a podstrčit ho nejde. Hlídá to `identity/scope.test.ts` a není to
 * formalita: týž tvar vady už jednou způsobil, že se cache povolených domén
 * plnila dotazem bez kontextu, vracela vždy prázdno, a identifikační token
 * se proto nikdy nepřipojil k prokliku.
 *
 * Podmínka `workspace_id = ...` v dotazech proto NENÍ, a je to záměr, ne
 * opomenutí: izolaci vynucuje RLS podle `mlain.workspace_id`, které nastaví
 * `withWorkspace`. Ruční filtr vedle politiky by byl druhá pravda o tomtéž.
 */

export type IdentifiedContact = { id: string; email: string };

/**
 * Kontakt podle identifikátoru zákazníka.
 *
 * Opírá se o částečný unikátní index `uq_contacts__ws_external_id` (rozhodnutí
 * R6 v P03). Vrací `null`, ne výjimku: neznámý identifikátor je běžný stav,
 * u nepodepsaného `identify` dokonce ten nejčastější.
 */
export async function findContactByExternalId(
  ctx: WorkspaceContext,
  externalId: string,
): Promise<IdentifiedContact | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<IdentifiedContact>(sql`
      SELECT id, email::text AS email
        FROM contacts
       WHERE external_id = ${externalId}
         AND deleted_at IS NULL
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
}

/**
 * Bajty, proti kterým se ověřuje podpis `identify`.
 *
 * ODCHYLKA OD SPECIFIKACE 3.6.3, VYNUCENÁ SCHÉMATEM, A JE ZÁSADNÍ.
 * TOHLE JE DRUHÉ ZE TŘÍ MÍST, KDE JE POPSANÁ. Zbylá dvě jsou komentář
 * u `verifyIdentifySignature` a report k plánu P10.
 *
 * Specifikace předepisuje „bajty privátního API klíče workspace, ne jeho
 * textová podoba a ne odvozený klíč". Jenže `api_keys` drží podle
 * `packages/db/src/schema/identity.ts` jen SHA-256 OTISK sekretu; surová
 * hodnota se po vytvoření klíče nikam neukládá a v produktu neexistuje. Podpis
 * počítaný ze surového sekretu proto server ověřit NEMŮŽE, ať se napíše
 * jakkoli, a doslovná implementace by odmítla každý podpis.
 *
 * Podepisuje se tedy otiskem, tedy `SHA-256(sekretová část klíče)`. Zákazník
 * si ho ve svém jazyce spočítá jedním řádkem navíc, bezpečnost se nemění
 * (otisk je odvozený klíč plné délky a zná ho jen server a držitel klíče)
 * a alternativy jsou horší: ukládat sekret v otevřené podobě, nebo měnit
 * schéma kvůli jedné funkci.
 *
 * NEVRACEJ TO ZPÁTKY „PODLE SPECIFIKACE". Vypadá to jako oprava a je to
 * rozbití všech zákaznických integrací naráz: od té chvíle se neověří ani
 * jeden podpis a nikde se neukáže proč.
 *
 * Vrací i dožívající otisk z rotace, dokud běží odklad. Bez toho by rotace
 * klíče tiše rozbila podepisování na dobu, kterou zákazník na výměnu má.
 */
export async function selectIdentifySigningSecrets(ctx: WorkspaceContext): Promise<Buffer[]> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      secret_hash: Buffer | null;
      previous_secret_hash: Buffer | null;
      previous_expires_at: Date | null;
    }>(sql`
      SELECT secret_hash, previous_secret_hash, previous_expires_at
        FROM api_keys
       WHERE kind = 'secret'
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > now())
    `);

    const out: Buffer[] = [];
    for (const row of rows) {
      if (row.secret_hash !== null) out.push(Buffer.from(row.secret_hash));
      if (
        row.previous_secret_hash !== null &&
        row.previous_expires_at !== null &&
        new Date(row.previous_expires_at).getTime() > Date.now()
      ) {
        out.push(Buffer.from(row.previous_secret_hash));
      }
    }
    return out;
  });
}

/**
 * Minutová cache klíčů. Bez ní by každé `identify` znamenalo dotaz do databáze;
 * s ní se nový klíč projeví do minuty, což je u podepisování dost.
 *
 * Klíčem cache je `ctx.workspaceId`, ne parametr funkce, a na tom rozdílu
 * záleží: hodnota pochází z ověřeného kontextu, takže se do cache nedá vložit
 * ani z ní vytáhnout cizí projekt.
 */
const SECRETS_CACHE = { capacity: 1_000, ttlMs: 60_000 } as const;
let secretsCache = new TtlLru<string, Buffer[]>(SECRETS_CACHE);

export function resetIdentifySecretsCache(): void {
  secretsCache = new TtlLru<string, Buffer[]>(SECRETS_CACHE);
}

export async function readIdentifySigningSecrets(ctx: WorkspaceContext): Promise<Buffer[]> {
  return secretsCache.getOrLoad(ctx.workspaceId, () => selectIdentifySigningSecrets(ctx));
}
