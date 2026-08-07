import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../tx';
import { consentTextEvidence, type ConsentEvidence } from '../consents/evidence';
import { transition, type SubscriptionStatus } from '../lists/state-machine';
import { recordConsent } from '../repo/consents';
import { upsertContacts, type UpsertResult } from '../repo/contacts';
import { optInByIdsIn } from '../repo/lists';
import { readSubscriptionStatusesIn, writeSubscriptionsIn } from '../repo/subscriptions';
import {
  addTagsToContactsIn,
  countTagsPerContactIn,
  ensureTagsIn,
  existingTagIdsIn,
  TAG_LIMIT_PER_CONTACT,
} from '../repo/tags';
import type { UpsertMode } from '../types';
import type { WorkspaceContext } from '../../identity/types';
import { inWorkspaceTx } from './db';
import { importLogger } from './logging';
import { defaultOptions, type ImportOptions } from './options';
import type { ProcessedOkRow } from './row-pipeline';

export type ErrRow = {
  rowNumber: number;
  errorCode: string;
  severity: 'error' | 'warning';
  column?: string | undefined;
  detail?: string | undefined;
  raw: string;
};

export type BatchInput = {
  importId: string;
  mode: UpsertMode;
  /**
   * Uložené volby importu. Bez nich dávka neví, do kterých seznamů přihlásit, jaké
   * štítky přidat ani jaký souhlas zapsat, a přesně tím se doteď celá druhá polovina
   * obrazovky Volby ztrácela: uživatel vybral seznam, import ohlásil úspěch a seznam
   * zůstal prázdný. Volitelné jsou kvůli volajícím, kteří zapisují jen kontakty
   * (testy dávkování), ne kvůli tomu, že by je běh importu směl vynechat.
   */
  options?: ImportOptions;
  rows: ProcessedOkRow[];
  /** Chybné i varovné řádky v jednom seznamu, rozlišené polem severity. */
  errors: ErrRow[];
  /**
   * Kolik ŘÁDKŮ SOUBORU tahle dávka spotřebovala. Nedá se dopočítat z `rows`
   * a `errors`: jeden řádek může být v obou (zapsaný kontakt s varováním) a řádek
   * na potlačené adrese není ani v jednom. Viz zdůvodnění u `processed_rows`.
   */
  inputRows: number;
  checkpointRow: number;
  checkpointByte: number;
  suppressedCount: number;
  maxStoredErrors: number;
};

export type BatchResult = { created: number; updated: number };

/**
 * Zápis kontaktů, chybných řádků I CHECKPOINTU v JEDNÉ transakci. Tohle je jádro
 * obnovitelnosti: pád workera kdykoliv uprostřed znamená rollback celé dávky
 * a po restartu se čte od `checkpoint_row + 1`, ne od začátku a ne podruhé.
 *
 * Zápis `updated_at` v checkpointu není kosmetika: je to jediný signál živosti
 * importu a stojí na něm obnova po pádu. Bez něj by zabitý worker nechal import
 * navždy ve stavu `importing` a `confirmImport` by pak v projektu odmítl každý
 * další import s `import_already_running`. (Kdyby měla fronta klíč projektu, což
 * registr kdysi sliboval, byl by ten zámek navíc i ve frontě a nešla by ani
 * obnova; proto je klíčem ID importu.)
 */
export async function writeBatch(ctx: WorkspaceContext, input: BatchInput): Promise<BatchResult> {
  const options = input.options ?? defaultOptions();
  // ŽÁDNÝ POTVRZOVACÍ E-MAIL Z IMPORTU. Odesílací port (`registerSubscriptionEmails`)
  // dnes nikdo v provozu neregistruje, šablona potvrzovacího e-mailu v produktu není,
  // a hlavně: e-mail smí odejít jedině na výslovnou volbu v importu, nikdy sám od sebe.
  // Dokud volba nemá čím poslat, zůstává v logu stopa, ať se na to nepřijde až podle
  // toho, že nikomu nic nedošlo.
  if (options.send_confirmation_emails) {
    importLogger().warn(
      { importId: input.importId },
      'send_confirmation_emails is on, but no subscription e-mail port is registered; nothing was sent',
    );
  }
  return inWorkspaceTx(ctx, async (tx) => {
    let created = 0;
    let updated = 0;
    let extraWarnings: ErrRow[] = [];

    // 1. Kontakty. Zápis NEDĚLÁ tenhle plán, dělá ho upsertContacts z P07.
    //    Je to jediné místo v produktu, kde kontakt hromadně vzniká, a jde přes
    //    něj všechny čtyři kanály (API, formulář, webhook, import). Vlastní INSERT
    //    by znamenal druhou implementaci upsertu, která se s tou první rozejde,
    //    a hlavně by zapomněl na sloupce, o kterých import neví: bez
    //    `first_name_key` a `last_name_key` by fronta ke kontrole oslovení
    //    zůstala po importu prázdná, protože stojí právě na těch klíčích.
    if (input.rows.length > 0) {
      const written = await upsertContacts(
        ctx,
        {
          mode: input.mode,
          rows: input.rows.map((r) => ({
            ...r.contact,
            attributes: r.attributes,
            source: 'import',
            sourceRef: input.importId,
          })),
        },
        tx,
      );
      created = written.filter((r) => r.inserted).length;
      updated = written.length - created;

      // 1b. Štítky, přihlášení do seznamů a souhlas. VE STEJNÉ TRANSAKCI jako kontakty
      //     a checkpoint, tak jak to předepisuje 4.6.8: kdyby to byla druhá transakce,
      //     pád mezi nimi by nechal kontakty zapsané, ale bez seznamu a bez souhlasu,
      //     a po restartu by se od checkpointu už nikdy nedopočítaly.
      extraWarnings = await applyRowExtras(tx, ctx, input, options, written);
    }

    // Varování, která vzniknou až při zápisu (dnes jediné: nevešly se všechny štítky),
    // jdou do TÝCHŽ počítadel jako varování z řádkové roury. Kdyby se počítala zvlášť,
    // uživatel by je na výsledkové obrazovce nenašel.
    const errors = extraWarnings.length === 0 ? input.errors : [...input.errors, ...extraWarnings];

    // 2. Chybné a varovné řádky. Nad limit se jen inkrementují čítače.
    //    severity se bere z řádku, NENÍ natvrdo 'error': varovné řádky se počítají
    //    do warning_rows i do error_summary, takže kdyby se ukládaly jako 'error',
    //    uživatel by u varování viděl počet, ale nedohledal by ani jeden řádek,
    //    který ho způsobil, a stažení chybných řádků by mu vrátilo i varování.
    const stored = errors.slice(0, Math.max(0, input.maxStoredErrors));
    if (stored.length > 0) {
      await tx.execute(sql`
        INSERT INTO import_errors (id, import_id, workspace_id, row_number, severity,
                                   column_name, error_code, error_detail, raw_line)
        SELECT uuidv7(), ${input.importId}::uuid, ${ctx.workspaceId}::uuid,
               u.row_number, u.severity, u.column_name, u.error_code, u.error_detail, u.raw_line
          FROM unnest(
            ${sql.param(stored.map((e) => e.rowNumber))}::bigint[],
            ${sql.param(stored.map((e) => e.severity))}::text[],
            ${sql.param(stored.map((e) => e.column ?? null))}::text[],
            ${sql.param(stored.map((e) => e.errorCode))}::text[],
            ${sql.param(stored.map((e) => e.detail ?? null))}::text[],
            ${sql.param(stored.map((e) => e.raw))}::text[]
          ) AS u(row_number, severity, column_name, error_code, error_detail, raw_line)`);
    }

    const errorRows = errors.filter((e) => e.severity === 'error').length;
    const warningRows = errors.length - errorRows;

    const summary: Record<string, number> = {};
    for (const e of errors) summary[e.errorCode] = (summary[e.errorCode] ?? 0) + 1;

    /*
     * 3. Checkpoint. Ve STEJNÉ transakci jako body 1 a 2.
     *
     * POČET ZPRACOVANÝCH ŘÁDKŮ SE BERE ZE VSTUPU DÁVKY, ne jako součet zapsaných
     * a chybných. Do 7. 8. 2026 tu stálo `rows.length + errors.length` a počítalo
     * tytéž řádky vícekrát: `errors` nese i VAROVÁNÍ patřící k řádkům, které jsou
     * zároveň mezi zapsanými, takže kontakt s jedním varováním se započítal dvakrát
     * a se dvěma třikrát. Naměřeno na třech dokončených importech: 25 z 20, 4 ze 3
     * a 2 z 1, pokaždé s NULOU chyb. Uživatel viděl „25 z 20", což je nesmysl na
     * první pohled, a rozdíl nebyl konstantní, takže to nevypadalo na obvyklou
     * záměnu hlavičky za datový řádek.
     *
     * Řádek na potlačené adrese se naopak nezapočítal VŮBEC: není ani mezi zapsanými,
     * ani mezi chybnými. U souboru s potlačenými adresami se proto průběh zasekl
     * pod sto procenty.
     *
     * Komentář na tomhle místě před tou vadou přesně varoval a kód dělal to, před
     * čím varoval. Jediné spolehlivé číslo je počet řádků, které dávka přečetla ze
     * souboru, a ten zná jen volající.
     */
    await tx.execute(sql`
      UPDATE imports SET
        checkpoint_row = ${input.checkpointRow},
        checkpoint_byte = ${input.checkpointByte},
        processed_rows  = processed_rows + ${input.inputRows},
        created_rows    = created_rows + ${created},
        updated_rows    = updated_rows + ${updated},
        error_rows      = error_rows + ${errorRows},
        warning_rows    = warning_rows + ${warningRows},
        suppressed_rows = suppressed_rows + ${input.suppressedCount},
        stored_error_count = stored_error_count + ${stored.length},
        error_summary   = ${mergeSummarySql(summary)},
        updated_at      = now()
      WHERE id = ${input.importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);

    return { created, updated };
  });
}

/** Řádek dávky spárovaný s id kontaktu, který z něj v databázi doopravdy vznikl. */
type WrittenRow = { row: ProcessedOkRow; contactId: string };

/**
 * Štítky, přihlášení a souhlas pro řádky, které se opravdu zapsaly.
 *
 * Párování jde přes ADRESU, ne přes pořadí. `upsertContacts` vrací jen skutečně zapsané
 * řádky: adresa se stížností nebo po výmazu se do dávky vůbec nedostane (pravidlo 4)
 * a měkce smazaný kontakt vypadne na podmínce `deleted_at IS NULL` v ON CONFLICT.
 * Kdyby se spoléhalo na index, jediný vynechaný řádek by posunul celý zbytek dávky
 * a štítky i souhlasy by se rozvěsily na cizí kontakty.
 */
async function applyRowExtras(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BatchInput,
  options: ImportOptions,
  written: UpsertResult[],
): Promise<ErrRow[]> {
  const idByEmail = new Map(written.map((row) => [row.email.toLowerCase(), row.id]));
  const rows: WrittenRow[] = [];
  for (const row of input.rows) {
    const contactId = idByEmail.get(row.email.toLowerCase());
    if (contactId !== undefined) rows.push({ row, contactId });
  }
  if (rows.length === 0) return [];

  const warnings = await applyTags(tx, ctx, options, rows);
  await applySubscriptions(tx, ctx, input.importId, options, rows);
  await applyConsents(ctx, tx, input.importId, rows);
  return warnings;
}

/**
 * Štítky z voleb (id) i ze sloupce souboru (jména) v jednom zápisu.
 *
 * Jména se zakládají přes `ensureTagsIn`, tedy touž cestou, jakou zakládá štítky zápis
 * kontaktu přes API, formulář a webhook. Vlastní INSERT do `tags` by byl druhá
 * implementace, která se s tou první rozejde v tom, jak řeší velikost písmen.
 *
 * STROP `TAG_LIMIT_PER_CONTACT` se drží i tady, jen se kvůli němu nedotazuje na každý
 * kontakt zvlášť (to dělá `addTagsToContact` u ručního zápisu a v dávce o tisíci řádcích
 * by to byl tisíc dotazů). Stačí JEDEN dotaz na dosavadní počty a přebytek se ořízne.
 * Import se kvůli limitu NEZASTAVÍ: shodit dávku na 501. štítku by po restartu shodilo
 * tutéž dávku znovu a import s `retryLimit = 0` by se zasekl. Místo toho se u dotčeného
 * řádku zapíše varování, takže uživatel na výsledkové obrazovce vidí, u kolika kontaktů
 * se část štítků nepřidala, a proč.
 */
async function applyTags(
  tx: Tx,
  ctx: WorkspaceContext,
  options: ImportOptions,
  rows: readonly WrittenRow[],
): Promise<ErrRow[]> {
  const names = [...new Set(rows.flatMap((entry) => entry.row.tags))];
  const optionTagIds = await existingTagIdsIn(tx, ctx, options.tag_ids);
  if (names.length === 0 && optionTagIds.length === 0) return [];

  const idByName = await ensureTagsIn(tx, ctx, names);
  const already = await countTagsPerContactIn(
    tx,
    ctx,
    rows.map((entry) => entry.contactId),
  );

  const pairs: { contactId: string; tagId: string }[] = [];
  const warnings: ErrRow[] = [];
  for (const entry of rows) {
    const wanted = new Set<string>(optionTagIds);
    for (const name of entry.row.tags) {
      const tagId = idByName.get(name.trim().toLowerCase());
      if (tagId !== undefined) wanted.add(tagId);
    }
    // Kolik jich ještě smí přibýt. Počet už přiřazených je z doby PŘED touhle dávkou,
    // takže odhad je konzervativní: opakovaný štítek se sice nezapíše dvakrát, ale
    // do stropu se počítá, což je bezpečnější než ho o pár kusů překročit.
    const room = Math.max(TAG_LIMIT_PER_CONTACT - (already.get(entry.contactId) ?? 0), 0);
    const fitting = [...wanted].slice(0, room);
    for (const tagId of fitting) pairs.push({ contactId: entry.contactId, tagId });
    if (fitting.length < wanted.size) {
      warnings.push({
        rowNumber: entry.row.rowNumber,
        errorCode: 'contact_tag_limit_reached',
        severity: 'warning',
        detail: String(TAG_LIMIT_PER_CONTACT),
        raw: '',
      });
    }
  }
  await addTagsToContactsIn(tx, ctx, pairs);
  return warnings;
}

/**
 * Přihlášení do seznamů z voleb importu.
 *
 * O výsledném stavu rozhoduje `transition()` ze `lists/state-machine.ts`, ne volba
 * uživatele. Je to jediné místo v produktu, kde se o přechodu rozhoduje, a drží dvě
 * pravidla, která by import jinak obešel: odhlášený se vrací VŽDY přes `pending`,
 * i s prohlášením, a člověk po stížnosti se nepřihlásí vůbec. Bez automatu by stačilo
 * znovu nahrát starý soubor a odhlášení lidé by byli zpátky v rozesílce.
 *
 * `suppression: null` je bezpečné: řádek se ŽIVOU blokací má `subscribe === false`
 * (viz `row-pipeline.ts`) a filtrem níž sem vůbec nedojde.
 *
 * CO TENHLE KROK NEDĚLÁ: neposílá potvrzovací e-maily. Volba `send_confirmation_emails`
 * je zatím vždy `false`, protože průvodce ji nenabízí a odesílací port registruje až
 * P08/P13; kdyby ji někdo přes API zapnul, přihlášení vznikne, ale e-mail neodejde.
 */
async function applySubscriptions(
  tx: Tx,
  ctx: WorkspaceContext,
  importId: string,
  options: ImportOptions,
  rows: readonly WrittenRow[],
): Promise<void> {
  const subscribable = rows.filter((entry) => entry.row.subscribe);
  if (subscribable.length === 0) return;

  // Seznamy z voleb platí pro celý soubor, seznamy z mapování jen pro řádky, kde má
  // sloupec hodnotu ano. Sjednocují se, protože obojí je pokyn téhož uživatele.
  const listsOf = (entry: WrittenRow): string[] => [
    ...new Set([...options.list_ids, ...entry.row.listIds]),
  ];
  const allListIds = [...new Set(subscribable.flatMap(listsOf))];
  if (allListIds.length === 0) return;

  const optIn = await optInByIdsIn(tx, ctx, allListIds);
  if (optIn.size === 0) return;
  const current = await readSubscriptionStatusesIn(
    tx,
    ctx,
    subscribable.map((entry) => entry.contactId),
    [...optIn.keys()],
  );

  const now = new Date();
  const writes = [];
  for (const entry of subscribable) {
    for (const listId of listsOf(entry)) {
      const mode = optIn.get(listId);
      // Seznam, který v projektu není nebo je archivovaný. Řádek se tím nekazí:
      // kontakt je zapsaný, jen se nemá kam přihlásit.
      if (mode === undefined) continue;
      const from: SubscriptionStatus | 'none' =
        current.get(`${entry.contactId}:${listId}`) ?? 'none';
      const result = transition(from, {
        kind: 'subscribe',
        optIn: mode,
        source: 'import',
        suppression: null,
        // Potvrzení se smí přeskočit jen s prohlášením o doloženém souhlasu; obojí
        // vyhodnocuje automat, tady se jen předává, co uživatel zvolil.
        skipConfirmation: options.subscription_status === 'confirmed',
        declaration: options.consent?.declaration === true,
        now,
      });
      if (!result.allowed || result.next === 'deleted') continue;
      writes.push({
        contactId: entry.contactId,
        listId,
        status: result.next,
        source: 'import' as const,
        sourceRef: importId,
        // Datum potvrzení se zapisuje jen při skutečném přechodu do `confirmed`.
        // U kontaktu, který už potvrzený byl, by přepsání zahodilo doklad o tom,
        // kdy se přihlásil doopravdy.
        confirmedAt: from !== 'confirmed' && result.next === 'confirmed' ? now : null,
      });
    }
  }
  await writeSubscriptionsIn(tx, ctx, writes);
}

/**
 * Zápis souhlasu za každý řádek, který ho nese.
 *
 * Bere se `row.consent`, ne volba přímo: řádek s měkkou blokací (odraz, dřívější
 * odhlášení) ho má `null`, protože takový kontakt se sice zapíše, ale nesmí dostat
 * ani přihlášení, ani udělený souhlas (pravidlo 4 ze 4.1.2).
 *
 * Sloupec `consents.source` je číselník KANÁLŮ (`ck_consents__source`), takže tam patří
 * `import`, ne volný text z voleb. Uživatelovo tvrzení o původu souhlasu („veletrh
 * Brno") jde do evidence, kde je doložitelné a nic neshodí.
 */
async function applyConsents(
  ctx: WorkspaceContext,
  tx: Tx,
  importId: string,
  rows: readonly WrittenRow[],
): Promise<void> {
  for (const entry of rows) {
    const consent = entry.row.consent;
    if (consent === null) continue;
    const evidence: ConsentEvidence = {
      import_id: importId,
      declaration: consent.declaration,
      declared_source: consent.source,
      ...consentTextEvidence(consent.consent_text),
    };
    await recordConsent(ctx, {
      contactId: entry.contactId,
      purpose: consent.purpose,
      status: 'granted',
      legalBasis: consent.legal_basis,
      // Souhlas z importu platí pro celý projekt, ne pro jeden seznam: uživatel
      // prohlašuje, že smí psát těmto lidem, ne že smí psát do téhle rubriky.
      scopeListId: null,
      source: 'import',
      sourceRef: importId,
      ...(consent.consent_text === undefined ? {} : { consentText: consent.consent_text }),
      // Historické datum ze sloupce souboru. Bez něj by import starého seznamu tvrdil,
      // že všichni souhlasili dnes, což je nepravda přímo v dokladu.
      ...(entry.row.consentOccurredAt === null
        ? {}
        : { occurredAt: new Date(entry.row.consentOccurredAt) }),
      evidence,
      tx,
    });
  }
}

/**
 * Sečte dosavadní error_summary s přírůstkem téhle dávky.
 *
 * Operátor `||` nad jsonb klíče na první úrovni NAHRAZUJE, nesčítá:
 * `'{"email_invalid":3}' || '{"email_invalid":5}'` je `5`, ne `8`. U importu
 * s víc než jednou dávkou by tedy `error_summary` na konci obsahovala počty
 * z POSLEDNÍ dávky, ne za celý soubor, a výsledková obrazovka by u souboru
 * s deseti tisíci chybami klidně napsala „3 neplatné adresy". Test na jednu
 * dávku to nikdy neodhalí, protože při jedné dávce je nahrazení a součet totéž.
 */
function mergeSummarySql(increment: Record<string, number>): SQL {
  return sql`(
    SELECT coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb)
      FROM (SELECT key AS k, sum(value::bigint) AS v
              FROM (SELECT key, value FROM jsonb_each_text(imports.error_summary)
                    UNION ALL
                    SELECT key, value FROM jsonb_each_text(${JSON.stringify(increment)}::jsonb)) merged
             GROUP BY key) summed)`;
}
