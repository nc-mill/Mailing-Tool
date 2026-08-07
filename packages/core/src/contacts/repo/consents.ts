import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import type { ConsentEvidence } from '../consents/evidence';

export type ConsentPurpose =
  'email_marketing' | 'analytics' | 'personalization' | 'profiling' | 'third_party';

/**
 * ÚČEL, POD KTERÝM SE VEDE SOUHLAS S MĚŘENÍM CHOVÁNÍ.
 *
 * Měření se NEVEDE jako vlastní sloupec na `contacts` a ani se nemá. Účel
 * `analytics` v téhle struktuře existuje od migrace 0001 (`ck_consents__purpose`),
 * bere ho `POST /contacts/{id}/consents`, umí ho podmínka segmentu i obrazovka
 * historie souhlasů. Druhý zápisník s vlastním pravidlem by znamenal dvě
 * evidence téhož souhlasu, které se dřív nebo později rozejdou, a u souhlasu
 * je rozpor právní vada, ne kosmetická.
 *
 * Sem se tedy nic nepřidává, jen se pojmenovává to, co už tu je, aby měření
 * nesahalo na holý řetězec.
 */
export const MEASUREMENT_PURPOSE = 'analytics' satisfies ConsentPurpose;

/**
 * Stav souhlasu s měřením u JEDNOHO kontaktu.
 *
 * Tři hodnoty, ne dvě. `not_recorded` není totéž co `withdrawn` a ani totéž co
 * `granted`: znamená, že o měření tenhle člověk nikdy nic neřekl. Kdyby se
 * schovalo do jedné ze zbylých dvou, obrazovka by buď tvrdila souhlas, který
 * nikdo nedal, nebo odvolání, které nikdo neprovedl.
 */
export type MeasurementConsent = 'granted' | 'withdrawn' | 'not_recorded';

/**
 * SMÍ SE CHOVÁNÍ TOHOHLE KONTAKTU MĚŘIT ADRESNĚ? Jediné místo, kde se na to
 * odpovídá. Ptá se na něj příjem webových událostí, vazba anonymního ID,
 * slučování historie i zápis otevření a prokliků do časové osy.
 *
 * VÝCHOZÍ HODNOTA JE „MĚŘIT SE SMÍ" A JE TO VĚDOMÉ ROZHODNUTÍ. Zdůvodnění:
 *
 *  - Souhlas s měřením se u návštěvníka VYBÍRÁ UŽ DNES, jen jinde: SDK má
 *    `ConsentGate` (`packages/sdk-web/src/consent.ts`) a dokud zákazníkova
 *    lišta nezavolá `Mlain.consent({ analytics: true })`, prohlížeč neuloží
 *    ani `anonymous_id` a neodešle jedinou událost. Nad tím stojí ještě
 *    projektový přepínač `tracking.web_tracking_enabled`. Adresné měření
 *    tedy NENÍ bez souhlasu ani dnes, jen ten souhlas dosud nešlo vést u osoby.
 *  - Kdyby chybějící záznam znamenal zákaz, přestalo by měření po nasazení
 *    naráz VŠEM kontaktům v každé instalaci: `contact_consent_state` nemá pro
 *    účel `analytics` dnes ani jeden řádek. Časové osy by se zastavily,
 *    segmenty podle chování by přestaly nikoho nacházet a nikde by nebylo
 *    vidět proč. To není opatrnost, to je tichá regrese.
 *  - Odvodit to od souhlasu se zasíláním by bylo horší než obojí: souhlas
 *    s newsletterem není souhlasem se sledováním chování a odhlášení z pošty
 *    by lidem navíc mazalo měření, o kterém odhlášení nebylo.
 *
 * Záznam s `withdrawn` je proto VETO: platí okamžitě, všude a beze změny
 * ostatních vrstev. Absence záznamu se nevydává za souhlas, obrazovka ji
 * ukazuje jako `not_recorded`, tedy „nikdo se nevyjádřil".
 */
export function allowsMeasurement(state: MeasurementConsent): boolean {
  return state !== 'withdrawn';
}

/**
 * Převod stavu z databáze na `MeasurementConsent`. Bere `null` (řádek chybí)
 * i neznámou hodnotu, protože `contact_consent_state.status` je textový sloupec
 * a přepisovat neznámý stav na `granted` by byl přesně ten tichý souhlas,
 * kterému se celá tahle část vyhýbá.
 */
export function toMeasurementConsent(status: string | null | undefined): MeasurementConsent {
  if (status === 'withdrawn') return 'withdrawn';
  if (status === 'granted') return 'granted';
  return 'not_recorded';
}

/**
 * Řádek souhlasu tak, jak ho čte doména. Časy jsou `Date`, i když je ovladač vydává
 * jako řetězec.
 *
 * POZOR NA TVAR VÝSLEDKU. `tx.execute()` vrací hodnoty tak, jak je vydá ovladač, a
 * drizzle nad `node-postgres` má u `timestamptz` nastavený parser, který vrací TEXT.
 * Přes dotazovací builder (`tx.select()`) se typ převádí, přes syrové SQL ne. Kdo si
 * výsledek přetypuje na `Date` a zavolá `.getTime()`, dostane za běhu `TypeError`
 * a typová kontrola ho neochrání. Převod se proto dělá tady, na jednom místě.
 */
export type ConsentRow = {
  id: string;
  workspace_id: string;
  contact_id: string;
  purpose: ConsentPurpose;
  scope_list_id: string | null;
  status: 'granted' | 'withdrawn';
  legal_basis: string;
  source: string;
  source_ref: string | null;
  consent_text: string | null;
  consent_text_hash: Buffer | null;
  evidence: Record<string, unknown>;
  recorded_by: string;
  occurred_at: Date;
  created_at: Date;
};

/** Časy z ovladače, tedy před převodem. */
type RawConsentRow = Omit<ConsentRow, 'occurred_at' | 'created_at'> & {
  occurred_at: string | Date;
  created_at: string | Date;
};

export function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

export type RecordConsentInput = {
  contactId: string;
  purpose: ConsentPurpose;
  status: 'granted' | 'withdrawn';
  legalBasis: 'consent' | 'legitimate_interest' | 'contract' | 'soft_opt_in';
  /** null znamená celý projekt, jinak konkrétní seznam. */
  scopeListId: string | null;
  source: string;
  sourceRef?: string;
  consentText?: string;
  evidence?: ConsentEvidence;
  /** Import může nést historické datum. */
  occurredAt?: Date;
  tx?: Tx;
};

/**
 * Zápis souhlasu. Tabulka consents je APPEND ONLY: každý zápis je nový řádek a žádný
 * endpoint existující řádek nemění ani nemaže.
 *
 * Vynucuje se odebráním práv aplikační roli (REVOKE UPDATE, DELETE), ne databázovým
 * pravidlem. Pravidlo DO INSTEAD NOTHING na DELETE by totiž tiše zablokovalo i kaskádu
 * z contacts: smazání kontaktu by proběhlo bez chyby, ale jeho souhlasy by zůstaly
 * jako osiřelé řádky s osobními údaji v evidence. Odebrání práv se chová stejně
 * u UPDATE i DELETE, dá se otestovat jedním dotazem, a kaskáda funguje dál,
 * protože ji provádí systém, ne role.
 *
 * Aktuální stav v contact_consent_state se aktualizuje ve STEJNÉ transakci, protože
 * segmentace nesmí procházet append-only log.
 */
export async function recordConsent(
  ctx: WorkspaceContext,
  input: RecordConsentInput,
): Promise<{ id: string }> {
  const run = async (tx: Tx): Promise<{ id: string }> => {
    const textHash =
      input.consentText === undefined
        ? null
        : createHash('sha256').update(input.consentText, 'utf8').digest();
    const occurredAt = input.occurredAt ?? new Date();
    const recordedBy = ctx.actor.type === 'user' ? ctx.actor.userId : 'system';

    const inserted = await tx.execute<{ id: string }>(sql`
      INSERT INTO consents (workspace_id, contact_id, purpose, scope_list_id, status,
                            legal_basis, source, source_ref, consent_text, consent_text_hash,
                            evidence, recorded_by, occurred_at)
      VALUES (${ctx.workspaceId}::uuid, ${input.contactId}::uuid, ${input.purpose},
              ${input.scopeListId}::uuid, ${input.status}, ${input.legalBasis}, ${input.source},
              ${input.sourceRef ?? null}, ${input.consentText ?? null}, ${textHash},
              ${JSON.stringify(input.evidence ?? {})}::jsonb,
              ${recordedBy}, ${occurredAt})
      RETURNING id
    `);
    const id = inserted.rows[0]!.id;

    await tx.execute(sql`
      INSERT INTO contact_consent_state (contact_id, workspace_id, purpose, status,
                                         legal_basis, since, last_consent_id)
      VALUES (${input.contactId}::uuid, ${ctx.workspaceId}::uuid, ${input.purpose},
              ${input.status}, ${input.legalBasis}, ${occurredAt}, ${id}::uuid)
      ON CONFLICT (contact_id, purpose) DO UPDATE SET
        status = excluded.status,
        legal_basis = excluded.legal_basis,
        since = excluded.since,
        last_consent_id = excluded.last_consent_id,
        updated_at = now()
    `);

    return { id };
  };

  return input.tx !== undefined ? run(input.tx) : withWorkspace(ctx, run);
}

export async function listConsents(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ConsentRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<RawConsentRow>(sql`
      SELECT * FROM consents
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       ORDER BY occurred_at DESC, id DESC
    `);
    return result.rows.map((row) => ({
      ...row,
      occurred_at: toDate(row.occurred_at),
      created_at: toDate(row.created_at),
    }));
  });
}

/**
 * Doklad o souhlasu, o který se smí opřít potvrzení přihlášení. `null` znamená
 * „souhlas nemáme" a volající pokračuje běžnou cestou přes potvrzovací e-mail.
 */
export type EffectiveConsent = {
  /** Id řádku v append-only logu. Jde do auditu, aby šlo dohledat, o co se to opřelo. */
  consentId: string;
  /** null = souhlas platí pro celý projekt, jinak pro jeden konkrétní seznam. */
  scopeListId: string | null;
  legalBasis: string;
  source: string;
  occurredAt: Date;
};

/**
 * Nejmenší tvar řádku, ze kterého jde o platnosti souhlasu rozhodnout.
 *
 * Je schválně širší než `ConsentRow`, aby na něj sedla i odpověď API
 * (`GET /contacts/{id}/consents`). Rozhraní se tak může zeptat TÉHOŽ pravidla
 * jako server, místo aby si ho opsalo.
 */
export type ConsentPrecedenceRow = {
  scope_list_id: string | null;
  status: 'granted' | 'withdrawn';
  purpose: string;
};

/**
 * PRAVIDLO PŘEDNOSTI SOUHLASŮ. Jediné místo, kde se na otázku „máme doložený
 * souhlas pro tenhle seznam?" odpovídá.
 *
 * Čistá funkce nad řádky SEŘAZENÝMI OD NEJNOVĚJŠÍHO. Je oddělená od dotazu
 * schválně: rozhoduje o ní i rozhraní, které řádky dostává z API, a dvě kopie
 * tohohle pravidla by se rozešly na něčem, co se pozná až v doručené poště.
 *
 * PROČ TO NEČTE `contact_consent_state`. Odvozená tabulka má klíč (contact_id, purpose)
 * a rozsah souhlasu v ní NENÍ. Souhlas udělený pro jeden seznam by tedy vypadal stejně
 * jako souhlas pro celý projekt a přihlásil by člověka i tam, kam nechtěl. Rozsah nese
 * jen append-only log `consents`, takže se čte log.
 *
 * PRAVIDLO: vezme se NEJNOVĚJŠÍ řádek z těch, které na tenhle seznam vůbec dosáhnou,
 * tedy s rozsahem „celý projekt" (`scope_list_id IS NULL`) nebo přímo tenhle seznam.
 * Když je udělený, souhlas máme; když je to odvolání, nemáme. Jedno porovnání pokrývá
 * obě odvolání, která existují:
 *   - globální odvolání je novější řádek s `scope_list_id IS NULL` a stavem `withdrawn`,
 *     takže vyhraje nad starším projektovým souhlasem,
 *   - odvolání pro jeden seznam vyhraje nad starším projektovým souhlasem POUZE
 *     u toho seznamu, což je přesně jeho význam.
 * Souhlas pro CIZÍ seznam se do porovnání nedostane vůbec, ani jako doklad,
 * ani jako odvolání.
 *
 * POZOR: tohle NENÍ brána odesílání. Zablokovanou adresu, odhlášení a stav kontaktu
 * řeší `mailable.ts` a stavový automat. Odpovídá to na jedinou otázku:
 * „máme doložený souhlas, nebo si o něj musíme napsat?"
 */
export function pickEffectiveConsent<Row extends ConsentPrecedenceRow>(
  newestFirst: readonly Row[],
  input: { listId: string; purpose?: ConsentPurpose },
): Row | null {
  const purpose = input.purpose ?? 'email_marketing';
  const row = newestFirst.find(
    (candidate) =>
      candidate.purpose === purpose &&
      (candidate.scope_list_id === null || candidate.scope_list_id === input.listId),
  );
  if (row === undefined || row.status !== 'granted') return null;
  return row;
}

/**
 * PLATNÝ SOUHLAS PRO PŘIHLÁŠENÍ DO SEZNAMU, čtený z databáze.
 *
 * Sám nerozhoduje, jen dodá `pickEffectiveConsent` řádky ve správném pořadí.
 * Rozsah se ve WHERE ZÁMĚRNĚ NEFILTRUJE, přestože by to šlo: byla by to druhá
 * kopie téhož pravidla a stačilo by opravit jen jednu z nich. Řádků souhlasu má
 * kontakt jednotky, takže se tím nic neplatí.
 *
 * ŘAZENÍ MÁ DVĚ ÚROVNĚ. `occurred_at` může nést historické datum z importu a dva řádky
 * můžou mít tentýž čas; `id` je uuid v7 (rostoucí v čase), takže rozhoduje pořadí zápisu.
 * Bez druhé úrovně by se u shodného času vybral libovolný řádek a odvolání by se dalo
 * přehlédnout, což je přesně ta chyba, kterou si nikdo nevšimne.
 */
export async function findEffectiveConsent(
  ctx: WorkspaceContext,
  input: { contactId: string; listId: string; purpose?: ConsentPurpose },
  tx?: Tx,
): Promise<EffectiveConsent | null> {
  const purpose = input.purpose ?? 'email_marketing';
  const run = async (t: Tx): Promise<EffectiveConsent | null> => {
    const { rows } = await t.execute<{
      id: string;
      purpose: string;
      scope_list_id: string | null;
      status: 'granted' | 'withdrawn';
      legal_basis: string;
      source: string;
      occurred_at: string | Date;
    }>(sql`
      SELECT id, purpose, scope_list_id, status, legal_basis, source, occurred_at
        FROM consents
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND contact_id = ${input.contactId}::uuid
         AND purpose = ${purpose}
       ORDER BY occurred_at DESC, id DESC
    `);
    const row = pickEffectiveConsent(rows, { listId: input.listId, purpose });
    if (row === null) return null;
    return {
      consentId: row.id,
      scopeListId: row.scope_list_id,
      legalBasis: row.legal_basis,
      source: row.source,
      occurredAt: toDate(row.occurred_at),
    };
  };
  return tx !== undefined ? run(tx) : withWorkspace(ctx, run);
}

/** Aktuální stav souhlasu pro jeden účel. Čte se z odvozené tabulky, ne z logu. */
export async function currentConsentState(
  ctx: WorkspaceContext,
  contactId: string,
  purpose: ConsentPurpose,
): Promise<{ status: 'granted' | 'withdrawn'; legalBasis: string; since: Date } | null> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{
      status: 'granted' | 'withdrawn';
      legal_basis: string;
      since: string | Date;
    }>(sql`
      SELECT status, legal_basis, since FROM contact_consent_state
       WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND purpose = ${purpose}
    `);
    const row = rows[0];
    if (row === undefined) return null;
    return { status: row.status, legalBasis: row.legal_basis, since: toDate(row.since) };
  });
}
