import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace } from '../../tx';
import type { ContactResponse } from '../api/schemas';
import { writeAudit } from '../audit';
import type { ConsentEvidence } from '../consents/evidence';
import { subscribeToList } from '../lists/subscribe-service';
import { recordConsent, type ConsentPurpose } from './consents';
import { writeContact } from './contacts';
import { getContactById } from './contacts-query';
import { optInByIdsIn } from './lists';
import { writeSubscriptionIn } from './subscriptions';
import { addTagsToContact, ensureTags } from './tags';

/**
 * Zápis kontaktu tak, jak ho posílá REST API: kontakt, štítky, seznamy a souhlasy
 * v jednom volání.
 *
 * Vlastní pravidla zápisu tady NEJSOU. Kontakt vzniká výhradně přes `writeContact`,
 * které drží všech šest pravidel z 4.1.3 části 2 a dopočítává oslovení; tenhle soubor
 * jen rozbaluje tvar požadavku na volání, která už existují. Kdyby si pravidla psal
 * handler, musely by je znovu napsat i formulář a příchozí webhook.
 */

export type ContactUpsertBody = {
  email: string;
  first_name?: string | null | undefined;
  last_name?: string | null | undefined;
  full_name?: string | null | undefined;
  title_prefix?: string | null | undefined;
  title_suffix?: string | null | undefined;
  gender?: 'female' | 'male' | 'unknown' | undefined;
  /** Jen `active` a `unconfirmed`, zdůvodnění výčtu je u `ContactUpsertRequestSchema`. */
  status?: 'active' | 'unconfirmed' | undefined;
  locale?: string | undefined;
  external_id?: string | null | undefined;
  attributes?: Record<string, unknown> | undefined;
  tags?: string[] | undefined;
  lists?: { list_id: string; status?: 'pending' | 'confirmed' | undefined }[] | undefined;
  consent?:
    | {
        purpose: ConsentPurpose;
        status: 'granted' | 'withdrawn';
        legal_basis: 'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in';
        consent_text?: string | undefined;
        occurred_at?: string | undefined;
        evidence?: Record<string, unknown> | undefined;
      }[]
    | undefined;
  on_conflict?: 'create' | 'skip' | 'update' | 'overwrite' | undefined;
  source?: string | undefined;
};

/** Zdroje povolené omezením `ck_contacts__source`. Cizí hodnota by shodila zápis na 23514. */
const ALLOWED_SOURCES = new Set([
  'manual',
  'import',
  'api',
  'form',
  'webhook',
  'double_opt_in',
  'migration',
]);

function sourceOf(raw: string | undefined): string {
  return raw !== undefined && ALLOWED_SOURCES.has(raw) ? raw : 'api';
}

/**
 * Zdroj SOUHLASU, ne kontaktu. Jsou to dva různé číselníky: `ck_consents__source`
 * z migrace 0001 zná `admin`, ale NEZNÁ `manual`, takže hodnotu ze zdroje kontaktu
 * nejde použít přímo, spadla by na 23514.
 *
 * Ruční zadání správcem se zapisuje jako `admin`, ne jako `api`. Souhlas je doklad:
 * „přes API" a „správce to odklikal v rozhraní" jsou dvě různá tvrzení o tom, kdo
 * za souhlas ručí, a historie souhlasů obojí zvlášť pojmenovává
 * (`consents.source.admin` versus `consents.source.api`).
 */
function consentSourceOf(contactSource: string): string {
  return contactSource === 'manual' ? 'admin' : 'api';
}

/**
 * Varování v odpovědi. Slovník je společný s importem (`import/row-pipeline.ts`), aby
 * klient nemusel rozlišovat, kterým kanálem řádek přišel.
 */
export type ContactWriteWarning = 'suppressed_skipped';

export type UpsertFromApiResult = {
  contact: ContactResponse;
  created: boolean;
  warnings: ContactWriteWarning[];
};

export async function upsertContactFromApi(
  ctx: WorkspaceContext,
  body: ContactUpsertBody,
): Promise<UpsertFromApiResult> {
  const contactSource = sourceOf(body.source);
  const result = await writeContact(ctx, {
    email: body.email,
    fullName: body.full_name ?? null,
    firstName: body.first_name ?? null,
    lastName: body.last_name ?? null,
    titlePrefix: body.title_prefix ?? null,
    titleSuffix: body.title_suffix ?? null,
    ...(body.gender === undefined ? {} : { gender: body.gender }),
    // Stav se předává dál, ne dosazuje: `applyWriteRules` z něj udělá výsledný stav
    // podle pravidla 3, takže zamknutý stav (odhlášen, odraz, stížnost) přežije i tenhle zápis.
    ...(body.status === undefined ? {} : { status: body.status }),
    ...(body.locale === undefined ? {} : { locale: body.locale }),
    externalId: body.external_id ?? null,
    attributes: body.attributes ?? {},
    source: contactSource,
    mode: body.on_conflict ?? 'update',
  });

  // Pravidlo 4: adresa po stížnosti nebo po výmazu se nesmí vrátit ani přes API.
  // Kód `contact_suppressed` není kořenový kód registru P01, takže jde do params.detail
  // stejně jako u ostatních doménových odmítnutí v téhle doméně.
  if (result.rejected === 'suppressed') {
    throw new ApiError('conflict', { params: { detail: 'contact_suppressed' } });
  }

  const contactId = result.id;

  if (body.tags !== undefined && body.tags.length > 0) {
    await addTagsToContact(ctx, contactId, await ensureTags(ctx, body.tags));
  }

  // DRUHÁ POLOVINA PRAVIDLA 4, a ta zrádnější. Kontakt na suppression listu z mírnějšího
  // důvodu (odraz, odhlášení, ruční blokace) se zapíše, ale NESMÍ dostat přihlášení
  // do seznamu ani udělený souhlas. Odhlášený člověk by se jinak vrátil do rozesílky
  // jedním voláním API a nic by o tom nevědělo.
  //
  // Požadavek se NEODMÍTÁ: spec 4.1.2 pravidlo 4 říká „kontakt se zapíše, ale nevznikne
  // přihlášení ani souhlas", ne „zápis skončí chybou". Odmítnutí by navíc rozbilo běžnou
  // synchronizaci z CRM, kde je jeden blokovaný člověk mezi tisícem v pořádku.
  // Přeskok proto NENÍ tichý: nese se varováním v odpovědi a zápisem do auditu.
  const skippedLists = result.allowSubscriptions ? [] : (body.lists ?? []).map((l) => l.list_id);
  let skippedConsents = 0;

  if (result.allowSubscriptions && body.lists !== undefined && body.lists.length > 0) {
    /*
     * NEPOTVRZENÉ PŘIHLÁŠENÍ NA SEZNAM S DVOJÍM POTVRZENÍM JDE PŘES `subscribeToList`.
     *
     * Do téhle chvíle se všechna přihlášení zapisovala napřímo přes
     * `writeSubscriptionIn`, tedy bez stavového automatu, a sloupec `lists.opt_in`
     * se tu VŮBEC NEČETL. Následek: správce zvolil „nepotvrzený", vznikl řádek
     * `pending`, ale žádný token se nevydal (`issueConfirmation` se nezavolala)
     * a žádný potvrzovací e-mail neodešel. Člověk čekal na e-mail, který se ani
     * neplánoval, a přihlášení viselo napořád.
     *
     * Deleguje se jen tenhle jeden případ, ne celý zápis:
     *
     * - `confirmed` zůstává přímým zápisem. Je to VÝSLOVNÉ ROZHODNUTÍ SPRÁVCE
     *   („souhlas mám doložený", rozhodnutí zadavatele z 5. 8. 2026) a `subscribe()`
     *   by ho bez `skipConfirmation` a prohlášení překlopilo zpátky na `pending`.
     * - Seznam s jedním krokem se taky zapisuje přímo: potvrzovat není co, a kdyby
     *   se tam poslal `pending`, automat by z něj stejně udělal `confirmed`, tedy
     *   něco jiného, než správce zvolil.
     *
     * `subscribeToList` si kontakt zapíše ještě jednou (`writeContact` v režimu
     * `update`), a je to neškodné: nese jen adresu a zdroj, jméno vynechává
     * a atributy se slučují přes `jsonb_strip_nulls(… || excluded.attributes)`,
     * takže prázdná mapa nic nepřepíše.
     */
    // Vlastní vazba: zúžení `body.lists` se uvnitř uzávěru ztrácí, protože pole
    // je volitelné a překladač si nemůže být jistý, že se mezitím nezměnilo.
    const requested = body.lists;
    const optIn = await withWorkspace(ctx, async (tx) =>
      optInByIdsIn(
        tx,
        ctx,
        requested.map((item) => item.list_id),
      ),
    );

    const needsConfirmation = requested.filter(
      (item) => (item.status ?? 'pending') === 'pending' && optIn.get(item.list_id) === 'double',
    );
    const direct = requested.filter((item) => !needsConfirmation.includes(item));

    await withWorkspace(ctx, async (tx) => {
      for (const item of direct) {
        await writeSubscriptionIn(tx, ctx, {
          contactId,
          listId: item.list_id,
          status: item.status ?? 'pending',
          source: 'api',
          confirmedAt: item.status === 'confirmed' ? new Date() : null,
        });
      }
    });

    for (const item of needsConfirmation) {
      // Zdroj se překládá stejně jako u kontaktu: `manual` je „udělal to správce",
      // což je jiné tvrzení než „přišlo to přes API", a `consentSourceFor`
      // v `subscribe.ts` z něj udělá `admin`.
      await subscribeToList(ctx, {
        listId: item.list_id,
        email: body.email,
        source: contactSource === 'manual' ? 'manual' : 'api',
      });
    }
  }

  for (const consent of body.consent ?? []) {
    // Blokuje se jen UDĚLENÍ souhlasu. Odvolání míří stejným směrem jako suppression
    // a zahodit ho by znamenalo zahodit projev vůle, který chceme mít doložený.
    if (!result.allowConsents && consent.status === 'granted') {
      skippedConsents += 1;
      continue;
    }
    await recordConsent(ctx, {
      contactId,
      purpose: consent.purpose,
      status: consent.status,
      legalBasis: consent.legal_basis,
      scopeListId: null,
      source: consentSourceOf(contactSource),
      ...(consent.consent_text === undefined ? {} : { consentText: consent.consent_text }),
      ...(consent.occurred_at === undefined ? {} : { occurredAt: new Date(consent.occurred_at) }),
      // NÁLEZ: `evidence` se sem dřív nepředávala vůbec. `ConsentInput` ji přitom
      // přijímá a historie souhlasů z ní čte (`declaration`, `import_id`, `page_url`),
      // takže doklad, který klient poslal, se zahodil a nic nespadlo: v odpovědi
      // byl souhlas zapsaný, jen prázdný. Přetypování je stejné jako
      // v `subscribe-service.ts`: `evidence` je v databázi otevřený jsonb, kdežto
      // `ConsentEvidence` je jen výčet polí, kterým rozumí obrazovka.
      ...(consent.evidence === undefined ? {} : { evidence: consent.evidence as ConsentEvidence }),
    });
  }

  const warnings: ContactWriteWarning[] = [];
  if (skippedLists.length > 0 || skippedConsents > 0) {
    warnings.push('suppressed_skipped');
    await withWorkspace(ctx, async (tx) => {
      await writeAudit(tx, ctx, {
        action: 'contact.suppressed_write_skipped',
        targetType: 'contact',
        targetId: contactId,
        metadata: {
          channel: 'api',
          reason: result.suppressionReason,
          lists_skipped: skippedLists.length,
          consents_skipped: skippedConsents,
        },
      });
    });
  }

  const contact = await getContactById(ctx, contactId);
  if (contact === null) throw new ApiError('not_found');
  return { contact, created: result.inserted, warnings };
}

/**
 * Částečná úprava. Adresa se z těla NEBERE: změnu adresy má vlastní endpoint, protože
 * musí přepočítat otisky a ověřit kolizi s živým kontaktem.
 */
export async function patchContact(
  ctx: WorkspaceContext,
  contactId: string,
  body: Omit<ContactUpsertBody, 'email' | 'on_conflict'>,
): Promise<{ contact: ContactResponse; warnings: ContactWriteWarning[] } | null> {
  const current = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
  if (current === null) return null;

  const { contact, warnings } = await upsertContactFromApi(ctx, {
    ...body,
    email: current.email,
    on_conflict: 'update',
  });
  return { contact, warnings };
}

export type BatchItemResult = {
  index: number;
  status: 'created' | 'updated' | 'skipped' | 'error';
  id?: string;
  error?: { code: string };
  /** Položka prošla, ale něco se z ní kvůli suppression nezapsalo. */
  warnings?: ContactWriteWarning[];
};

/**
 * Dávkový zápis. Jedna vadná položka nesmí shodit celou dávku, proto se chyby chytají
 * po položkách a vracejí se s indexem: klient přesně ví, který řádek opravit.
 */
export async function batchUpsertFromApi(
  ctx: WorkspaceContext,
  items: readonly ContactUpsertBody[],
): Promise<{ results: BatchItemResult[] }> {
  const results: BatchItemResult[] = [];

  for (const [index, item] of items.entries()) {
    try {
      const { contact, created, warnings } = await upsertContactFromApi(ctx, item);
      results.push({
        index,
        status: created ? 'created' : 'updated',
        id: contact.id,
        ...(warnings.length > 0 ? { warnings } : {}),
      });
    } catch (error) {
      const code =
        error instanceof ApiError
          ? typeof error.params?.['detail'] === 'string'
            ? error.params['detail']
            : error.code
          : 'internal_error';
      results.push({ index, status: 'error', error: { code } });
    }
  }

  return { results };
}
