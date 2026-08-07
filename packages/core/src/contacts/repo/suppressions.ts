import { sql } from 'drizzle-orm';
import { keyringFromEnv } from '@mlain/contracts/keyring';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { emitWebhookEvent } from '../../platform/webhooks/emit';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { revokePendingMessages } from '../campaigns-port';
import { normalizeEmail } from '../email';
import { computeAllFingerprintsBatch, computeCurrentFingerprint } from '../fingerprint';
import { isStricter, rankCaseSql, rankOf, type SuppressionReason } from '../suppression/rank';
import { REMOVABLE_BY_DEFAULT } from '../suppression/removal';
import { recordConsent } from './consents';
import { byteaArrayLiteral } from './bytea';

export type SuppressionHit = {
  reason: SuppressionReason;
  createdAt: Date;
  removable: boolean;
};

/**
 * Kontrola, jestli je adresa na suppression listu. JEDINÉ povolené místo, kde se
 * tenhle dotaz píše. Volající nikdy nepočítá ani nepředává otisky; funkce si keyring
 * zjistí sama, aby nemohly vzniknout dvě implementace, které se časem rozejdou.
 *
 * Běží u každého importovaného řádku, každého přihlášení a při materializaci publika,
 * takže musí být rychlá. Je to jeden indexovaný dotaz s krátkým polem, ne dotaz
 * na pokolení klíče.
 *
 * TŘI POVINNÉ PODMÍNKY, žádná z nich není optimalizace a vynechání kterékoliv
 * je chyba, ne zrychlení:
 *
 * 1. removed_at IS NULL. Bez ní by adresa legitimně odblokovaná po třiceti dnech
 *    zůstala vyloučená navždy, protože měkce odebraný řádek v tabulce zůstává.
 *    Odblokování by bylo tiše bez efektu a nikdo by nepoznal proč.
 *
 * 2. Větev přes fingerprint. Bez ní by šlo znovu naimportovat člověka, který uplatnil
 *    právo na výmaz, protože jeho plaintextovou adresu už neznáme.
 *
 * 3. VŠECHNA pokolení klíče v poli otisků, ne jen aktuální. Otisk v suppression řádku
 *    nejde nikdy přepočítat, protože plaintext je po výmazu pryč. Kdyby se hledalo jen
 *    otiskem pod aktuálním klíčem, první rotace SECRET_KEY by starší záznamy odřízla
 *    a vymazaný člověk by se vrátil prvním dalším importem, ANIŽ BY COKOLIV SELHALO
 *    NEBO SE ZALOGOVALO. Je to nejtišší možná porucha a je to důvod, proč strop
 *    na počet pokolení neexistuje.
 */
export async function checkSuppression(
  ctx: WorkspaceContext,
  emails: readonly string[],
): Promise<Map<string, SuppressionHit>> {
  const result = new Map<string, SuppressionHit>();
  if (emails.length === 0) return result;

  // Normalizace stejnou funkcí jako všude jinde, jinak by se "JAN@X.CZ" a "jan@x.cz"
  // chovaly různě podle toho, odkud kontrola přišla.
  const normalized = new Map<string, string>();
  for (const raw of emails) {
    const parsed = normalizeEmail(raw);
    if (parsed.ok) normalized.set(parsed.email, raw);
  }
  if (normalized.size === 0) return result;

  const keys = [...normalized.keys()];
  const keyring = keyringFromEnv();
  // Zploštělé pole: počet adres krát počet pokolení. Pro dávku 1 000 adres a tři
  // pokolení má 3 000 položek. Jsou to tytéž hodnoty, které se ukládají do
  // contacts.email_fingerprints, takže se nepočítají dvakrát.
  const fingerprints = computeAllFingerprintsBatch(keyring, keys);

  const rows = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      email: string;
      fingerprint: Buffer;
      reason: SuppressionReason;
      removable: boolean;
      created_at: string | Date;
    }>(sql`
      SELECT s.email::text AS email, s.fingerprint, s.reason, s.removable, s.created_at
        FROM suppressions s
       WHERE s.workspace_id = ${ctx.workspaceId}::uuid
         AND s.removed_at IS NULL
         AND (s.email = ANY(${sql.param(keys)}::citext[])
              OR s.fingerprint = ANY(${byteaArrayLiteral(fingerprints)}::bytea[]))
    `);
    return rows;
  });

  // Otisky se mapují zpět na adresy: řádek nalezený přes otisk nese placeholder
  // v email, takže se podle něj adresa dohledat nedá.
  const byFingerprint = new Map<string, string>();
  const perAddress = keyring.size;
  keys.forEach((email, index) => {
    for (let generation = 0; generation < perAddress; generation += 1) {
      const fingerprint = fingerprints[index * perAddress + generation];
      if (fingerprint !== undefined) byFingerprint.set(fingerprint.toString('hex'), email);
    }
  });

  for (const row of rows) {
    const lowered = row.email.toLowerCase();
    const direct = normalized.has(lowered) ? lowered : undefined;
    const viaFingerprint = byFingerprint.get(Buffer.from(row.fingerprint).toString('hex'));
    const matched = direct ?? viaFingerprint;
    if (matched === undefined) continue;

    const original = normalized.get(matched) ?? matched;
    result.set(original, {
      reason: row.reason,
      removable: row.removable,
      // Ovladač vydává timestamptz ze syrového SQL jako TEXT. Bez převodu by volající
      // dostal řetězec přetypovaný na Date a `.getTime()` by spadlo až za běhu.
      createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    });
  }

  return result;
}

/** Kontrola jedné adresy. Tenká obálka, aby volající nemusel stavět pole. */
export async function checkSingleSuppression(
  ctx: WorkspaceContext,
  email: string,
): Promise<SuppressionHit | null> {
  return (await checkSuppression(ctx, [email])).get(email) ?? null;
}

export type AddSuppressionInput = {
  email: string;
  reason: SuppressionReason;
  source: string;
  sourceRef?: string | null;
  detail?: string | null;
  metadata?: Record<string, unknown>;
  /** Výchozí je teď. Část 4 dodá čas události od providera. */
  occurredAt?: Date;
  /** Volitelná existující transakce, když volající už jednu otevřel. */
  tx?: Tx;
};

export type AddSuppressionResult = {
  suppressionId: string;
  created: boolean;
  contactId: string | null;
};

/** Doménové efekty podle matice v kroku 5 kapitoly 4.10.4. */
const DOMAIN_EFFECTS: Record<
  SuppressionReason,
  {
    subscriptions: 'all_complained' | 'active_bounced' | 'all_unsubscribed' | 'delete' | 'none';
    contactStatus: 'complained' | 'bounced' | 'unsubscribed' | 'deleted' | null;
    withdrawConsent: boolean;
    consentSource?: string;
  }
> = {
  complaint: {
    subscriptions: 'all_complained',
    contactStatus: 'complained',
    withdrawConsent: true,
    consentSource: 'complaint',
  },
  hard_bounce: {
    subscriptions: 'active_bounced',
    contactStatus: 'bounced',
    withdrawConsent: false,
  },
  ses_suppressed: {
    subscriptions: 'active_bounced',
    contactStatus: 'bounced',
    withdrawConsent: false,
  },
  soft_bounce_threshold: {
    subscriptions: 'none',
    contactStatus: 'bounced',
    withdrawConsent: false,
  },
  global_unsubscribe: {
    subscriptions: 'all_unsubscribed',
    contactStatus: 'unsubscribed',
    withdrawConsent: true,
    consentSource: 'preference_center',
  },
  one_click_unsubscribe: {
    subscriptions: 'all_unsubscribed',
    contactStatus: 'unsubscribed',
    withdrawConsent: true,
    consentSource: 'one_click',
  },
  gdpr_erasure: { subscriptions: 'delete', contactStatus: 'deleted', withdrawConsent: false },
  invalid: { subscriptions: 'none', contactStatus: 'bounced', withdrawConsent: false },
  manual: { subscriptions: 'none', contactStatus: null, withdrawConsent: false },
  import: { subscriptions: 'none', contactStatus: null, withdrawConsent: false },
};

/**
 * Jediná cesta, jak něco zablokovat. Přímý INSERT do suppressions je zakázaný,
 * protože kolem něj visí pět dalších efektů, na které se jinak zapomene.
 *
 * Volají ji: část 4 při odrazu, stížnosti a blokaci na úrovni účtu providera;
 * tahle část při globálním odhlášení, one-click odhlášení, ručním přidání,
 * importu blokovaných adres a výmazu podle článku 17.
 *
 * Idempotentní: opakované volání se stejnými vstupy nic nezmění a vrátí created false.
 * Je to nutnost, protože SNS doručuje události nejméně jednou a tentýž odraz může
 * dorazit třikrát.
 */
export async function addSuppression(
  ctx: WorkspaceContext,
  input: AddSuppressionInput,
): Promise<AddSuppressionResult> {
  const parsed = normalizeEmail(input.email);
  if (!parsed.ok) throw new ApiError('validation_failed', { params: { detail: parsed.code } });
  const email = parsed.email;

  // Otisk si funkce počítá SAMA, pod aktuálním klíčem. Volající ho nikdy nepočítá
  // ani nepředává, jinak by se dvě implementace rozešly a rozdíl by se projevil až tím,
  // že vymazaný člověk dostane mail.
  const keyring = keyringFromEnv();
  const { fingerprint, keyId } = computeCurrentFingerprint(keyring, email);
  const removable = REMOVABLE_BY_DEFAULT[input.reason];

  const incomingRank = rankOf(input.reason);
  const existingRank = rankCaseSql('suppressions.reason');
  const createdBy = ctx.actor.type === 'user' ? ctx.actor.userId : 'system';

  const run = async (tx: Tx): Promise<AddSuppressionResult> => {
    const existing = await tx.execute<{ id: string; reason: SuppressionReason }>(sql`
      SELECT id, reason FROM suppressions
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
         AND removed_at IS NULL
       FOR UPDATE
    `);
    const previousReason = existing.rows[0]?.reason ?? null;

    const upserted = await tx.execute<{
      id: string;
      created: boolean;
      reason: SuppressionReason;
      removable: boolean;
    }>(sql`
      INSERT INTO suppressions (workspace_id, email, fingerprint, fingerprint_key_id, reason,
                                source, source_ref, detail, metadata, removable,
                                created_at, created_by)
      VALUES (${ctx.workspaceId}::uuid, ${email}::citext, ${fingerprint}, ${keyId},
              ${input.reason}, ${input.source}, ${input.sourceRef ?? null},
              ${input.detail ?? null}, ${JSON.stringify(input.metadata ?? {})}::jsonb,
              ${removable}, ${input.occurredAt ?? new Date()},
              ${createdBy})
      -- Inference částečného indexu uq_suppressions__workspace_email. Bez klauzule
      -- WHERE removed_at IS NULL skončí příkaz chybou 42P10. Je to tatáž past
      -- jako u upsertu kontaktů.
      ON CONFLICT (workspace_id, email) WHERE removed_at IS NULL
      DO UPDATE SET
        -- Povýšení je JEDNOSMĚRNÉ: vyhrává přísnější z obou důvodů. Opakované volání
        -- s mírnějším důvodem tedy nic nezhorší.
        --
        -- Dřív se při konfliktu měnily jen metadata a detail, což rozbíjelo invariant
        -- "stížnost je nevratná": adresa ručně zablokovaná jako manual je odebratelná,
        -- a když na ni později přišla stížnost, zůstala odebratelná. Editor by ji
        -- odblokoval jedním kliknutím, aniž by poznal, že odblokovává stížnost.
        -- Pořadí příchozího důvodu je spočítané v JavaScriptu; pořadí důvodu, který
        -- je právě v tabulce, spočítat nejde, protože ta hodnota vznikne až uvnitř
        -- příkazu, proto je tu výraz vygenerovaný z téže konstanty.
        reason = CASE WHEN ${incomingRank} < ${existingRank}
                      THEN excluded.reason ELSE suppressions.reason END,
        removable = CASE WHEN ${incomingRank} < ${existingRank}
                         THEN excluded.removable ELSE suppressions.removable END,
        source = CASE WHEN ${incomingRank} < ${existingRank}
                      THEN excluded.source ELSE suppressions.source END,
        metadata = suppressions.metadata || excluded.metadata,
        detail = coalesce(excluded.detail, suppressions.detail)
      RETURNING id, (xmax = 0) AS created, reason, removable
    `);

    const row = upserted.rows[0]!;
    const promoted = previousReason !== null && isStricter(row.reason, previousReason);

    const contact = await tx.execute<{ id: string }>(sql`
      SELECT id FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}::citext
         AND deleted_at IS NULL
    `);
    const contactId = contact.rows[0]?.id ?? null;

    // Doménové efekty se provádějí při vzniku i při POVÝŠENÍ. Bez toho by contacts.status
    // zůstal na hodnotě odpovídající mírnějšímu důvodu a odporoval by tvrzení ze 4.1.6,
    // že status je odvozený údaj udržovaný v téže transakci.
    if (contactId !== null && (row.created || promoted)) {
      await applyDomainEffects(tx, ctx, contactId, row.reason);
      await revokePendingMessages({
        workspaceId: ctx.workspaceId,
        contactIds: [contactId],
        listId: null,
        reason: 'suppressed',
        tx,
      });
    }

    if (promoted) {
      await writeAudit(tx, ctx, {
        action: 'suppression.reason_promoted',
        targetType: 'suppression',
        targetId: row.id,
        metadata: { from: previousReason, to: row.reason },
      });
    }
    if (row.created) {
      await writeAudit(tx, ctx, {
        action: 'suppression.added',
        targetType: 'suppression',
        targetId: row.id,
        metadata: { reason: row.reason, source: input.source },
      });
      await emitWebhookEvent(tx, {
        workspaceId: ctx.workspaceId,
        type: 'contact.suppressed',
        occurredAt: new Date(),
        data: { email, reason: row.reason, source: input.source },
      });
    }

    return { suppressionId: row.id, created: row.created, contactId };
  };

  return input.tx !== undefined ? run(input.tx) : withWorkspace(ctx, run);
}

/** Efekty na přihlášení, stav kontaktu a souhlasy podle matice ze 4.10.4. */
async function applyDomainEffects(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
  reason: SuppressionReason,
): Promise<void> {
  const effects = DOMAIN_EFFECTS[reason];

  if (effects.subscriptions === 'all_complained') {
    await tx.execute(sql`
      UPDATE list_subscriptions SET status = 'complained', updated_at = now()
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  } else if (effects.subscriptions === 'active_bounced') {
    await tx.execute(sql`
      UPDATE list_subscriptions SET status = 'bounced', updated_at = now()
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status IN ('confirmed', 'pending')
    `);
  } else if (effects.subscriptions === 'all_unsubscribed') {
    await tx.execute(sql`
      UPDATE list_subscriptions
         SET status = 'unsubscribed', unsubscribed_at = now(), updated_at = now()
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status <> 'unsubscribed'
    `);
  } else if (effects.subscriptions === 'delete') {
    await tx.execute(sql`
      DELETE FROM list_subscriptions
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  }

  if (effects.contactStatus !== null) {
    await tx.execute(sql`
      UPDATE contacts SET status = ${effects.contactStatus}, updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
  }

  if (effects.withdrawConsent) {
    await recordConsent(ctx, {
      contactId,
      purpose: 'email_marketing',
      status: 'withdrawn',
      legalBasis: 'consent',
      scopeListId: null,
      source: effects.consentSource ?? 'admin',
      tx,
    });
  }
}

/**
 * Odebrání je MĚKKÉ. Řádek zůstává jako důkaz, že adresa byla zablokovaná v době,
 * kdy jsme na ni neposílali, a aby šlo zjistit, kdo blokaci sundal.
 */
export async function removeSuppression(
  ctx: WorkspaceContext,
  suppressionId: string,
  input: { note: string },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      UPDATE suppressions
         SET removed_at = now(),
             removed_by = ${ctx.actor.type === 'user' ? ctx.actor.userId : null}::uuid,
             removal_note = ${input.note}
       WHERE id = ${suppressionId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND removed_at IS NULL
    `);
    await writeAudit(tx, ctx, {
      action: 'suppression.removed',
      targetType: 'suppression',
      targetId: suppressionId,
      metadata: { note: input.note },
    });
  });
}

/**
 * KRITÉRIUM 63: potvrzené přihlášení sundá blokaci z DŘÍVĚJŠÍHO ODHLÁŠENÍ.
 *
 * Sundávají se JEN důvody, které vznikly rozhodnutím téhož člověka, tedy odhlášení.
 * Stížnost, tvrdý odraz ani výmaz podle článku 17 se nesundají nikdy: návrat po
 * stížnosti není rozhodnutí příjemce vůči nám, ale rozhodnutí, které už udělal
 * jeho poštovní provider.
 *
 * PROČ TENHLE DOTAZ LEŽÍ TADY. `UPDATE suppressions` smí být podle
 * `test/repo/suppressions.query-shape.test.ts` jedině v tomhle souboru. Kdyby si ho
 * napsala potvrzovací cesta sama, vznikla by druhá brána do suppression listu a nikdo
 * by ji nehlídal. Volá to `lists/confirm-service.ts` a nic jiného.
 *
 * Otisk se počítá přes VŠECHNA pokolení klíče: blokace mohla vzniknout před rotací
 * a její řádek se nedá přepočítat.
 */
export async function removeUnsubscribeSuppressionForContact(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    const email = rows[0]?.email;
    if (email === undefined) return;

    const fingerprints = computeAllFingerprintsBatch(keyringFromEnv(), [email]);
    if (fingerprints.length === 0) return;

    await tx.execute(sql`
      UPDATE suppressions
         SET removed_at = now(), removal_note = 'confirmed_opt_in'
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND removed_at IS NULL
         AND reason IN ('global_unsubscribe','one_click_unsubscribe')
         AND fingerprint = ANY(${byteaArrayLiteral(fingerprints)}::bytea[])
    `);
  });
}

/**
 * Důvody blokace, které smí sundat VÝSLOVNÉ ROZHODNUTÍ SPRÁVCE při ručním potvrzení
 * kontaktu. Je to táž úvaha jako u `removeUnsubscribeSuppressionForContact`, jen se
 * doklad neopírá o kliknutí v e-mailu, ale o prohlášení správce zapsané do souhlasu
 * a do auditu.
 *
 * VÝČET JE POVOLENÍ, NE ZÁKAZ, a to, co v něm NENÍ, je ta důležitější polovina:
 *  - `complaint` a `gdpr_erasure` nesundá nikdo a nikdy (4.10.2). Stížnost je nejsilnější
 *    negativní signál od příjemce a hromadné obcházení stížností je nejrychlejší cesta
 *    k pozastavení účtu u odesílacího providera,
 *  - `hard_bounce` a `ses_suppressed` nejsou projev vůle příjemce, ale tvrzení jeho
 *    poštovního serveru. Odblokovat je ručním potvrzením by znamenalo posílat na adresu,
 *    která prokazatelně neexistuje, a poškodit reputaci odesílatele. `hard_bounce` má
 *    navíc vlastní cestu s třicetidenní lhůtou v `canRemove`.
 *
 * Kontakt s takovou blokací se povýšit DÁ, ale adresa zůstává na seznamu zablokovaných
 * a `evaluateMailability` ho vyloučí bez ohledu na `contacts.status`. Volající tuhle
 * skutečnost dostane v návratové hodnotě a MUSÍ ji uživateli říct; zamlčet ji by
 * znamenalo ohlásit úspěch u kontaktu, kterému se dál neodešle.
 */
export const MANUAL_CONFIRM_CLEARABLE_REASONS: readonly SuppressionReason[] = [
  'global_unsubscribe',
  'one_click_unsubscribe',
  'soft_bounce_threshold',
  'invalid',
  'import',
  'manual',
];

export type ManualConfirmSuppressionResult = {
  /** Důvody, jejichž blokace se právě sundala. Prázdné pole je běžný stav. */
  removed: SuppressionReason[];
  /** Blokace, která na adrese zůstává i po povýšení, nebo null. */
  blocking: { reason: SuppressionReason } | null;
};

/**
 * Sundá blokace adresy, které smí sundat ruční potvrzení kontaktu, a řekne pravdu
 * o tom, co zůstalo.
 *
 * TENHLE DOTAZ LEŽÍ TADY ZE STEJNÉHO DŮVODU jako `removeUnsubscribeSuppressionForContact`:
 * `UPDATE suppressions` smí být podle `test/repo/suppressions.query-shape.test.ts` jedině
 * v tomhle souboru. Kdyby si ho potvrzovací cesta napsala sama, byla by to druhá brána
 * do suppression listu a nikdo by ji nehlídal.
 *
 * Otisk se počítá přes VŠECHNA pokolení klíče: blokace mohla vzniknout před rotací
 * `SECRET_KEY` a její řádek se nedá přepočítat, protože plaintext po výmazu neexistuje.
 */
export async function releaseSuppressionsForManualConfirm(
  ctx: WorkspaceContext,
  contactId: string,
  input: { note: string; tx?: Tx },
): Promise<ManualConfirmSuppressionResult> {
  const run = async (tx: Tx): Promise<ManualConfirmSuppressionResult> => {
    const contact = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
    `);
    const email = contact.rows[0]?.email;
    if (email === undefined) return { removed: [], blocking: null };

    const fingerprints = computeAllFingerprintsBatch(keyringFromEnv(), [email]);
    const fingerprintArray = byteaArrayLiteral(fingerprints);
    const clearable = [...MANUAL_CONFIRM_CLEARABLE_REASONS];

    const cleared = await tx.execute<{ id: string; reason: SuppressionReason }>(sql`
      UPDATE suppressions
         SET removed_at = now(),
             removed_by = ${ctx.actor.type === 'user' ? ctx.actor.userId : null}::uuid,
             removal_note = ${input.note}
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND removed_at IS NULL
         AND reason = ANY(${sql.param(clearable)}::text[])
         AND (email = ${email}::citext
              OR fingerprint = ANY(${fingerprintArray}::bytea[]))
      RETURNING id, reason
    `);

    for (const row of cleared.rows) {
      await writeAudit(tx, ctx, {
        action: 'suppression.removed',
        targetType: 'suppression',
        targetId: row.id,
        metadata: { note: input.note, reason: row.reason },
      });
    }

    // Zbytek se čte AŽ PO úklidu, ne před ním: jinak by se jako "zůstává blokovaná"
    // hlásila i blokace, kterou právě tenhle příkaz sundal.
    const remaining = await tx.execute<{ reason: SuppressionReason }>(sql`
      SELECT reason FROM suppressions
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND removed_at IS NULL
         AND (email = ${email}::citext
              OR fingerprint = ANY(${fingerprintArray}::bytea[]))
       ORDER BY ${rankCaseSql('suppressions.reason')}
       LIMIT 1
    `);

    const blocking = remaining.rows[0];
    return {
      removed: cleared.rows.map((row) => row.reason),
      blocking: blocking === undefined ? null : { reason: blocking.reason },
    };
  };

  return input.tx !== undefined ? run(input.tx) : withWorkspace(ctx, run);
}

/* ------------------------------------------------------------------------- *
 * Čtení pro REST API a obrazovku blokovaných adres (úkol 53).
 *
 * Plán volal `listSuppressions` a `getSuppression`, které v repozitáři nebyly:
 * existovala jen kontrola, zápis a odebrání. Adresa se ven vrací MASKOVANÁ,
 * maskuje ji až API vrstva funkcí `maskEmail`.
 * ------------------------------------------------------------------------- */

export type SuppressionRecord = {
  id: string;
  email: string;
  reason: SuppressionReason;
  source: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  removable: boolean;
  created_at: Date | string;
};

export type SuppressionPage = {
  rows: SuppressionRecord[];
  nextCursor: string | null;
  hasMore: boolean;
};

export async function listSuppressionsPage(
  ctx: WorkspaceContext,
  query: {
    limit: number;
    cursor?: string | undefined;
    reason?: string | undefined;
    q?: string | undefined;
  },
): Promise<SuppressionPage> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<SuppressionRecord>(sql`
      SELECT id, email::text AS email, reason, source, detail, metadata, removable, created_at
        FROM suppressions
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND removed_at IS NULL
         AND (${query.reason ?? null}::text IS NULL OR reason = ${query.reason ?? null})
         AND (${query.q ?? null}::text IS NULL OR email::text LIKE lower(${`%${query.q ?? ''}%`}))
         AND (${query.cursor ?? null}::text IS NULL
              OR id < ${query.cursor ?? '00000000-0000-0000-0000-000000000000'}::uuid)
       ORDER BY id DESC
       LIMIT ${query.limit + 1}
    `);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];
    return { rows: page, nextCursor: hasMore && last !== undefined ? last.id : null, hasMore };
  });
}

export async function getSuppression(
  ctx: WorkspaceContext,
  suppressionId: string,
): Promise<SuppressionRecord | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<SuppressionRecord>(sql`
      SELECT id, email::text AS email, reason, source, detail, metadata, removable, created_at
        FROM suppressions
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${suppressionId}::uuid
         AND removed_at IS NULL
    `);
    return rows[0] ?? null;
  });
}
