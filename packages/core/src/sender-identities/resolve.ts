import { and, desc, eq, isNotNull, isNull, ne, notInArray } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

/** Odesílatel skryté kampaně, kterou zakládá systémový e-mail. */
export type ResolvedSenderIdentity = {
  providerId: string;
  senderDomainId: string | null;
  fromName: string;
  fromEmail: string;
  replyTo: string | null;
  /**
   * Odkud se odesílatel vzal.
   *
   * Nese to informaci, kterou jinak nejde zpětně poznat: adresa v hlavičce
   * skryté kampaně vypadá stejně, ať přišla z předvolby projektu, ze staré
   * kampaně, nebo z ověřené adresy zkušebního režimu.
   */
  source: 'identity' | 'campaign' | 'verified_address';
};

/**
 * Odesílatel pro e-maily, které nemá kdo vyplnit ručně: potvrzení přihlášení,
 * uvítání, rozloučení, e-mail z formuláře, zkušební odeslání a transakční API.
 *
 * PROČ JEDNA FUNKCE MÍSTO ČTYŘ KOPIÍ: do 7. 8. 2026 si tohle řešila každá trasa
 * sama a čtyři kopie se rozešly. `test-send.ts` se `sender_identities` ani
 * neptal, `delivery-email.ts` taky ne. Rozdíl přitom nikdo nezamýšlel.
 *
 * POŘADÍ:
 *
 *  1. předvolba odesílatele projektu (`sender_identities`, výchozí první),
 *  2. poslední kampaň, která má odesílatele vyplněného,
 *  3. připojený odesílací účet a OVĚŘENÁ ADRESA zkušebního režimu.
 *
 * TŘETÍ KROK JE NOVÝ a bez něj čerstvý projekt neodeslal NIC. Naměřeno 7. 8.
 * na čisté instalaci: `sending_providers` mělo řádek (výchozí SMTP účet),
 * `sender_identities` nula řádků a `campaigns` nula řádků, takže potvrzovací
 * e-mail dvojího potvrzení se neodeslal vůbec (v auditu zůstalo
 * `sending_not_configured`) a „Poslat test" skončilo na
 * `test_sending_not_configured`. Návštěvník veřejného formuláře přitom
 * přečetl „Poslali jsme vám e-mail s odkazem" a nedostal nic; to není chyba,
 * to je nesplněný slib.
 *
 * Předvolbu odesílatele přitom nešlo založit: stojí na OVĚŘENÉ DOMÉNĚ, kterou
 * projekt ve zkušebním režimu z definice nemá. Panel prvních kroků navíc nabízí
 * zkušební e-mail jako krok 4 a první kampaň až jako krok 5, takže v pořadí,
 * které produkt sám doporučuje, ten krok udělat nešel.
 *
 * PROČ PRÁVĚ OVĚŘENÁ ADRESA ZKUŠEBNÍHO REŽIMU: je to jediná adresa, o které
 * instalace VÍ, že ji vlastník opravdu ovládá (potvrdil ji kliknutím na odkaz,
 * viz `trial-token.ts`). Vymyslet lokální část (`no-reply@…`) by znamenalo
 * poslat e-mail z adresy, kterou nikdo nezaložil, a ve zkušebním režimu se
 * navíc doručuje výhradně na ověřené adresy, takže žádná jiná nedává smysl.
 *
 * Vrací `null`, když projekt nemá ani jedno. „Ještě není nastavené odesílání"
 * je stav, ne porucha; jak se ohlásí, rozhoduje volající.
 */
export async function resolveSenderIdentity(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<ResolvedSenderIdentity | null> {
  const [preferred] = await tx
    .select({
      providerId: schema.senderIdentities.providerId,
      senderDomainId: schema.senderIdentities.senderDomainId,
      fromName: schema.senderIdentities.fromName,
      fromEmail: schema.senderIdentities.fromEmail,
      replyTo: schema.senderIdentities.replyTo,
    })
    .from(schema.senderIdentities)
    .where(wsEq(ctx, schema.senderIdentities))
    .orderBy(desc(schema.senderIdentities.isDefault), schema.senderIdentities.createdAt)
    .limit(1);
  if (preferred) return { ...preferred, source: 'identity' };

  const [fromCampaign] = await tx
    .select({
      providerId: schema.campaigns.providerId,
      senderDomainId: schema.campaigns.senderDomainId,
      fromName: schema.campaigns.fromName,
      fromEmail: schema.campaigns.fromEmail,
      replyTo: schema.campaigns.replyTo,
    })
    .from(schema.campaigns)
    .where(
      and(
        wsEq(ctx, schema.campaigns),
        isNull(schema.campaigns.deletedAt),
        eq(schema.campaigns.kind, 'campaign'),
        isNotNull(schema.campaigns.providerId),
        ne(schema.campaigns.fromEmail, ''),
      ),
    )
    .orderBy(desc(schema.campaigns.updatedAt))
    .limit(1);
  if (fromCampaign?.providerId) {
    return { ...fromCampaign, providerId: fromCampaign.providerId, source: 'campaign' };
  }

  return fromConnectedAccount(tx, ctx);
}

/**
 * Třetí krok: výchozí odesílací účet plus ověřená adresa zkušebního režimu.
 *
 * Zablokovaný a vypnutý účet se vynechává. Přes takový účet by zpráva stejně
 * neodešla a sender by ji vrátil s `provider_unavailable`; poslat ji tam by
 * znamenalo slíbit odeslání, o kterém se dopředu ví, že neproběhne.
 */
async function fromConnectedAccount(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<ResolvedSenderIdentity | null> {
  const [provider] = await tx
    .select({ id: schema.sendingProviders.id })
    .from(schema.sendingProviders)
    .where(
      and(
        wsEq(ctx, schema.sendingProviders),
        notInArray(schema.sendingProviders.status, ['blocked', 'disabled']),
      ),
    )
    .orderBy(desc(schema.sendingProviders.isDefault), schema.sendingProviders.createdAt)
    .limit(1);
  if (!provider) return null;

  const [workspace] = await tx
    .select({ name: schema.workspaces.name, settings: schema.workspaces.settings })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, ctx.workspaceId))
    .limit(1);
  if (!workspace) return null;

  const fromEmail = firstVerifiedTrialAddress(workspace.settings);
  if (fromEmail === null) return null;

  return {
    providerId: provider.id,
    // Ověřená adresa zkušebního režimu nestojí na záznamu v `sender_domains`,
    // takže tu žádný nepatří. Sloupec je nullable schválně.
    senderDomainId: null,
    // Jméno odesílatele je název PROJEKTU. Je to jediné jméno, které projekt
    // v tuhle chvíli má, a příjemce podle něj pozná, kdo mu píše.
    fromName: workspace.name,
    fromEmail,
    replyTo: null,
    source: 'verified_address',
  };
}

/**
 * První POTVRZENÁ adresa zkušebního režimu z `workspaces.settings.campaigns`.
 *
 * Adresa čeká na potvrzení, dokud má `verified_at = null`; taková se použít
 * nesmí, protože o ní instalace neví nic než to, že ji někdo napsal do pole.
 */
export function firstVerifiedTrialAddress(settings: unknown): string | null {
  if (settings === null || typeof settings !== 'object') return null;
  const campaigns = (settings as Record<string, unknown>)['campaigns'];
  if (campaigns === null || typeof campaigns !== 'object') return null;
  const list = (campaigns as Record<string, unknown>)['trial_verified'];
  if (!Array.isArray(list)) return null;
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    const { email, verified_at: verifiedAt } = entry as { email?: unknown; verified_at?: unknown };
    if (typeof email === 'string' && email !== '' && typeof verifiedAt === 'string') {
      return email.toLowerCase();
    }
  }
  return null;
}
