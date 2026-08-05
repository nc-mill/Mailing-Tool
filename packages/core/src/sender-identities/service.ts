/**
 * Aplikační vrstva předvoleb odesílatele.
 *
 * Drží dvě věci, které nemá kde jinde být: kontroly, které se ptají víc než
 * jedné tabulky, a překlad řádku do tvaru odpovědi.
 */
import { ApiError } from '../errors/api-error';
import { pgErrorCode, type WorkspaceContext } from '../tx';
import {
  createSenderIdentity,
  domainOwnership,
  getSenderIdentity,
  updateSenderIdentity,
  type SenderIdentityView,
  type SenderIdentityWriteInput,
} from './repo';
import { checkSenderIdentity } from './validation';

/** Tvar, ve kterém předvolba odchází z API. snake_case, jako všude v API. */
export type SenderIdentityPayload = {
  id: string;
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  provider_name: string;
  provider_status: string;
  sender_domain_id: string;
  domain: string;
  /**
   * Verdikt Amazonu, ne naše kontrola DNS (viz `saveIdentity` v doméně
   * providerů). Obrazovka z něj kreslí odznak u předvolby, aby bylo poznat,
   * která z nich je použitelná hned a která čeká na propagaci DNS.
   */
  domain_verified: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

export function presentSenderIdentity(row: SenderIdentityView): SenderIdentityPayload {
  return {
    id: row.id,
    name: row.name,
    from_name: row.from_name,
    from_email: row.from_email,
    reply_to: row.reply_to,
    provider_id: row.provider_id,
    provider_name: row.provider_name,
    provider_status: row.provider_status,
    sender_domain_id: row.sender_domain_id,
    domain: row.domain,
    domain_verified: row.domain_verified,
    is_default: row.is_default,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export type SenderIdentityInput = {
  name: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  provider_id: string;
  sender_domain_id: string;
  is_default: boolean;
};

/**
 * Dvě kontroly, které zadání žádá mít jako SKUTEČNOU kontrolu, ne jako větu
 * v nápovědě u pole.
 *
 * 1. Vybraná doména musí patřit vybranému účtu. Poslední slovo má složený cizí
 *    klíč `fk_sender_identities__domain`, protože jen ten platí i při souběhu.
 *    Tady se to kontroluje proto, aby uživatel dostal 422 s vysvětlením, které
 *    z těch dvou polí má opravit, ne 500 z chyby 23503.
 * 2. Adresa odesílatele musí patřit do té domény. Tuhle kontrolu databáze
 *    udělat NEMŮŽE: porovnává obsah dvou tabulek, což `CHECK` neumí, a trigger
 *    kvůli tomu zavádět nebudeme.
 *
 * OVĚŘENOST DOMÉNY SE TU ZÁMĚRNĚ NEVYNUCUJE. Nabízelo by se odmítnout
 * předvolbu na doméně, kterou Amazon ještě neuznal, jenže tím by se zakázala
 * úplně běžná posloupnost: přidám doménu, vyplním DNS a než se to propíše,
 * chci si připravit odesílatele. Propagace DNS trvá hodiny. Neověřená doména
 * proto předvolbu nezakazuje, jen ji obrazovka označí a `preflight` kampaně
 * odeslání stejně zastaví (`domain_dkim_missing`), takže se nic neprošvihne.
 */
async function assertConsistent(ctx: WorkspaceContext, input: SenderIdentityInput): Promise<void> {
  const ownership = await domainOwnership(ctx, input.sender_domain_id);
  if (ownership === null) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'sender_domain_id',
          code: 'not_found',
          message: 'Vybraná odesílací doména v projektu neexistuje.',
        },
      ],
    });
  }
  if (ownership.provider_id !== input.provider_id) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: 'sender_domain_id',
          code: 'domain_provider_mismatch',
          message: 'Vybraná doména patří k jinému odesílacímu účtu.',
        },
      ],
    });
  }

  const failure = checkSenderIdentity({
    fromEmail: input.from_email,
    domain: ownership.domain,
  });
  if (failure !== null) {
    throw new ApiError('validation_failed', {
      errors: [
        {
          path: failure.path,
          code: failure.code,
          message: `Adresa odesílatele musí být na doméně ${ownership.domain}, jinak zprávy skončí ve spamu.`,
        },
      ],
    });
  }
}

function toWriteInput(input: SenderIdentityInput): SenderIdentityWriteInput {
  return {
    name: input.name.trim(),
    fromName: input.from_name.trim(),
    fromEmail: input.from_email.trim().toLowerCase(),
    replyTo: input.reply_to === null ? null : input.reply_to.trim().toLowerCase(),
    providerId: input.provider_id,
    senderDomainId: input.sender_domain_id,
    isDefault: input.is_default,
  };
}

/**
 * Duplicitní jméno chytá unikátní index, ne dotaz před zápisem. Dotaz by měl
 * mezi sebou a zápisem okno, ve kterém stihne vzniknout druhá předvolba téhož
 * jména; index okno nemá.
 */
function rethrowDuplicateName(error: unknown): never {
  if (pgErrorCode(error) === '23505') {
    throw new ApiError('validation_failed', {
      errors: [
        { path: 'name', code: 'duplicate', message: 'Předvolba s tímhle názvem už existuje.' },
      ],
    });
  }
  throw error;
}

export async function createSenderIdentityFromApi(
  ctx: WorkspaceContext,
  input: SenderIdentityInput,
): Promise<SenderIdentityPayload> {
  await assertConsistent(ctx, input);
  const createdBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
  let id: string;
  try {
    id = await createSenderIdentity(ctx, toWriteInput(input), createdBy);
  } catch (error) {
    rethrowDuplicateName(error);
  }
  const row = await getSenderIdentity(ctx, id);
  // Řádek jsme právě zapsali, takže `null` by znamenal, že ho odnesla cizí
  // transakce mezi zápisem a čtením. Tichý fallback by z toho udělal 500 bez
  // stopy, proto raději hlasitě.
  if (row === null) throw new ApiError('not_found');
  return presentSenderIdentity(row);
}

export async function updateSenderIdentityFromApi(
  ctx: WorkspaceContext,
  id: string,
  input: SenderIdentityInput,
): Promise<SenderIdentityPayload> {
  if ((await getSenderIdentity(ctx, id)) === null) throw new ApiError('not_found');
  await assertConsistent(ctx, input);
  let updated: boolean;
  try {
    updated = await updateSenderIdentity(ctx, id, toWriteInput(input));
  } catch (error) {
    rethrowDuplicateName(error);
  }
  if (!updated) throw new ApiError('not_found');
  const row = await getSenderIdentity(ctx, id);
  if (row === null) throw new ApiError('not_found');
  return presentSenderIdentity(row);
}
