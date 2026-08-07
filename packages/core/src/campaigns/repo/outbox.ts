import {
  prepareRenderData,
  type PreparedDataSchema,
} from '@mlain/contracts/liquid/prepare-render-data';
import { withWorkspace, type Tx, type WorkspaceContext } from '../../tx';
import { buildRenderData, renderDataColumns, renderDataSelectItem } from '../audience/render-data';
// ODCHYLKA OD PLÁNU: plán importoval `CANCEL_CLEANUP_BATCH_SIZE` z `@mlain/core/campaigns`,
// tedy z vlastního barrelu balíčku. To je cyklus přes `index.ts`, který tenhle soubor
// sám reexportuje. Konstanta se bere přímo z modulu, kde je definovaná.
import { CANCEL_CLEANUP_BATCH_SIZE } from '../constants';
import { SAMPLE_SOURCE_REF_PATTERN } from '../audience/sample-guard';
import { canSendInTrial, type ResolvedTrialSettings } from '../../providers/trial-mode';
import { rawSql } from './raw-sql';

/**
 * Vsechno, co je potreba k slozeni render_data. Bere se z `campaigns.compile_meta`,
 * tedy z vystupu kompilace, NIKDY se nedopocitava podruhe.
 */
export type RenderPlan = {
  /** `CompileMeta.usedPaths`: ktere cesty sablona doopravdy pouziva. */
  usedPaths: readonly string[];
  /** Zuzene `CompileMeta.renderSchema` pres `toPreparedSchema`. Plni mapu `_present`. */
  preparedSchema: PreparedDataSchema;
};

export type MaterializeBatchInput = {
  campaignId: string;
  /** Invariant I1: jedina hodnota created_at pro cely materializacni beh. */
  audienceBuiltAt: string;
  cursor: string;
  batchSize: number;
  /** Vyraz do WHERE, ktery slozil buildAudienceSql z kompilatoru casti 2. */
  where: { sql: string; params: unknown[] };
  renderPlan: RenderPlan;
  /**
   * Identifikatory ukazkovych kontaktu z manifestu P16. Nacita je smycka jednou pred
   * behem, ne kazda davka. Prazdne pole je bezny stav (projekt bez ukazkovych dat).
   */
  sampleContactIds: readonly string[];
  /** Undo okno. Kdyz je null, zpravy jsou k odeslani okamzite. */
  releaseAt: string | null;
  /**
   * Zkusebni rezim projektu s UZ ROZHODNUTYM prepinacem (`resolveTrialSettings`).
   *
   * POLE JE POVINNE A JE TO ZAMER. Bylo napsane, otestovane a NIKDO ho nevolal:
   * zapnuty zkusebni rezim kampan nezastavil a rozeslal ji vsem, zatimco obrazovka
   * slibovala „z 12 480 prijemcu se odesle jen 2 overenym adresam". Nepovinne pole
   * s vychozi hodnotou by tutez diru otevrelo pri prvnim dalsim volajicim, ktery
   * ho zapomene predat. Takhle se to bez nej NEZKOMPILUJE.
   */
  trial: ResolvedTrialSettings;
  statementTimeoutMs?: number;
};

export type MaterializeBatchResult = {
  scanned: number;
  inserted: number;
  /** Radky, ktere prekrocily strop render_data a vznikly rovnou jako skipped. */
  skippedOversize: number;
  /** Radky, ktere zastavil zkusebni rezim. Cislo pro pruh na obrazovce publika. */
  skippedTrial: number;
  nextCursor: string | null;
};

/**
 * `id` a `email` jsou v kazdem radku, zbytek zavisi na sablone, takze se sloupce
 * NEVYPISUJI do typu. Vypsany tvar by tvrdil, ze `first_name` je vzdy k dispozici,
 * i kdyz ho sablona nepouziva a dotaz ho tim padem nevybral.
 */
type ContactRow = {
  id: string;
  email: string;
} & Record<string, unknown>;

/**
 * Krok 2 materializace. Bezi po davkach kurzorem pres contacts.id a nikdy v jedne
 * transakci pres cele publikum: transakce nad milionem radku drzi zamky, blokuje
 * VACUUM a pri padu se cela vraci zpet.
 *
 * Davka ma DVE faze a je to zamerne. Puvodni podoba skladala render_data primo v SQL
 * pres `jsonb_build_object`, aby se radky nemusely vozit do Node. Bylo to rychlejsi
 * a bylo to SPATNE: kontraktni `prepareRenderData` plni koren `_present`, ze ktereho
 * se vyhodnocuji vsechny podminene bloky, a SQL ho nenaplnilo. Dusledek overeny
 * spustenim: kazda podminka se vyhodnoti jako nepravda a podmineny blok se v odeslanem
 * mailu TISE SKRYJE. Nespadne pritom nic, kompilace projde, odeslani projde a testy
 * obou stran projdou. Je to pozadavek R11 planu P08.
 *
 * Druhotne se tim opravilo, ze se v SQL vubec nekontroloval strop render_data, ze se
 * cisla nad 2^53 neprevadela na retezec a ze se pole neorezavala na strop iteraci.
 *
 * Cena je jeden roundtrip navic NA DAVKU, ne na radek.
 *
 * Pozor na ctyri veci, ktere vypadaji jako detail a nejsou:
 *  - created_at se zapisuje EXPLICITNE hodnotou audience_built_at, nikdy DEFAULT now().
 *  - ON CONFLICT musi uvest VSECHNY TRI sloupce indexu A JEHO PREDIKAT. Od migrace
 *    0010 je `uq_messages__campaign_contact` castecny (`WHERE kind = 'campaign'`),
 *    protoze testovaci odeslani ma jeden dohledany contact_id na vsechny adresy
 *    a plny index by druhou adresu shodil na 23505. Castecny index se ale neda
 *    odvodit bez uvedeni tehoz predikatu v ON CONFLICT: bez nej skonci prikaz
 *    chybou 42P10 „there is no unique or exclusion constraint matching the
 *    ON CONFLICT specification" a materializace neprobehne vubec. Overeno
 *    spustenim, chytil to test trial-gate.db.test.ts.
 *    Uvedeni jen dvou sloupcu neni ticha chyba, ale rovnez tvrdy ERROR.
 *  - id se v seznamu sloupcu nevyskytuje schvalne, doplni ho DEFAULT uuidv7().
 *  - obe faze bezi v JEDNE transakci, takze kandidat vybrany fazi 1 nemuze mezitim zmizet.
 */
export async function materializeBatch(
  ctx: WorkspaceContext,
  input: MaterializeBatchInput,
): Promise<MaterializeBatchResult> {
  // Sloupce kontaktu urcuje SABLONA, ne pevny vycet.
  //
  // Drive tu stalo sedm natvrdo napsanych sloupcu (first_name, last_name,
  // first_name_vocative, greeting, attributes plus id a email). Paletka personalizace
  // v editoru pritom nabizi cely katalog poli, takze `{{ contact.middle_name }}`,
  // `{{ contact.title_prefix }}`, `{{ contact.title_suffix }}`, `{{ contact.gender }}`,
  // `{{ contact.last_name_vocative }}`, `{{ contact.locale }}` a `{{ contact.created_at }}`
  // sla vlozit, dotaz je nedodal, `buildRenderData` z chybejiciho klice udelal null
  // a v odeslane zprave bylo PRAZDNO. Tise: render nema prisnou kontrolu promennych,
  // takze nespadlo nic. Navic vysly nepravdive i podminene bloky nad temi poli,
  // protoze `_present` cte tutez hodnotu.
  //
  // `renderDataColumns` uz to umela spocitat a NIKDO ji nevolal (mela jen vlastni
  // jednotkovy test). Zdroj pravdy je od teto zmeny ona, tedy `usedPaths` z kompilace.
  // Nazvy sloupcu se do dotazu skladaji jako TEXT, protoze sloupec se parametrem
  // predat neda; proti cizimu identifikatoru stoji vycet SNAPSHOTTABLE_CONTACT_COLUMNS
  // uvnitr `renderDataColumns`, ktery vse ostatni zahazuje.
  //
  // `email` se vybira VZDY, i kdyz se do render_data nikdy nedostane: je z nej
  // obalkova adresa a rozhoduje o brane zkusebniho rezimu.
  //
  // `renderDataSelectItem` neni obalka pro nic za nic: casova razitka musi ze SELECT
  // vyjit uz jako RFC 3339, jinak je filtr `date` v senderu odmitne a znacka
  // vyrenderuje prazdno. Duvod je u `ISO_DATE_CONTACT_COLUMNS`.
  const contactColumns = renderDataColumns(input.renderPlan.usedPaths);
  const extraColumns = contactColumns.map((col) => `, ${renderDataSelectItem(col, 'c')}`).join('');

  // $1..$5 jsou pevne, poddotaz publika zacina od $6.
  //
  // Ukazkove kontakty vypadavaji DVEMA nezavislymi podminkami a obe jsou nutne:
  // manifest ($4) je autoritativni pro rozsah sady a prezije to, ze uzivatel kontakt
  // upravi, znacka ($3) chyti kontakty mimo manifest (starsi pokoleni, obnova ze zalohy).
  const SELECT_SQL = `
    SELECT c.id, c.email${extraColumns}
      FROM contacts c
     WHERE c.workspace_id = $1
       AND c.id > $2
       AND c.status = 'active'
       AND c.deleted_at IS NULL
       AND c.email IS NOT NULL AND c.email::text <> ''
       AND coalesce(c.source_ref, '') NOT LIKE $3
       AND NOT (c.id = ANY($4::uuid[]))
       AND (${input.where.sql})
     ORDER BY c.id
     LIMIT $5`;

  // `error_code` je v seznamu sloupcu ZAMERNE, i kdyz u vetsiny radku vychazi NULL.
  // Bez nej vznikaly radky se stavem skipped a PRAZDNYM duvodem, takze z outboxu
  // neslo poznat, jestli zpravu zastavil strop render_data, nebo zkusebni rezim.
  // Prazdny retezec se prevadi na NULL, aby v pending radcich nezustal zadny kod.
  const INSERT_SQL = `
    INSERT INTO messages (
      workspace_id, campaign_id, contact_id, kind, email,
      render_data, status, error_code, next_attempt_at, created_at
    )
    SELECT $1, $2, x.contact_id, 'campaign', x.email,
           x.render_data, x.status, nullif(x.error_code, ''),
           COALESCE($4::timestamptz, $3::timestamptz),
           $3::timestamptz
      FROM unnest($5::uuid[], $6::text[], $7::jsonb[], $8::text[], $9::text[])
        AS x(contact_id, email, render_data, status, error_code)
    ON CONFLICT (campaign_id, contact_id, created_at) WHERE kind = 'campaign' DO NOTHING
    RETURNING contact_id`;

  return withWorkspace(ctx, async (tx) => {
    if (input.statementTimeoutMs) {
      await tx.execute(
        rawSql(`SET LOCAL statement_timeout = ${Number(input.statementTimeoutMs)}`, []),
      );
    }

    // Faze 1: kandidati.
    const candidates = await tx.execute<ContactRow>(
      rawSql(SELECT_SQL, [
        ctx.workspaceId, // $1
        input.cursor, // $2
        SAMPLE_SOURCE_REF_PATTERN, // $3
        [...input.sampleContactIds], // $4, jedno POLE, ne rozlozene hodnoty
        input.batchSize, // $5
        ...input.where.params, // $6 a dal
      ]),
    );
    const rows = candidates.rows;
    if (rows.length === 0) {
      return { scanned: 0, inserted: 0, skippedOversize: 0, skippedTrial: 0, nextCursor: null };
    }

    // Faze 2: priprava dat pro render. TOHLE je misto, kde vznika koren `_present`.
    const contactIds: string[] = [];
    const emails: string[] = [];
    const renderData: string[] = [];
    const statuses: string[] = [];
    const errorCodes: string[] = [];
    let skippedOversize = 0;
    let skippedTrial = 0;

    for (const row of rows) {
      const email = row.email.toLowerCase();

      /**
       * BRANA ZKUSEBNIHO REZIMU.
       *
       * Stoji PRED skladanim render_data ze dvou duvodu. Za prve je to totez misto,
       * kde uz vypadava suppression (ta o kus vyse v obalce publika): zkusebni rezim
       * je taz trida kontroly, tedy „tahle adresa nesmi dostat postu", a patri k ni.
       * Za druhe se do outboxu neulozi ani snapshot osobnich udaju cloveka, kteremu
       * se stejne nic neposle.
       *
       * Radek se ZAKLADA, nezahazuje se. Zahozeny radek by z rozpadu zmizel a
       * uzivatel by nezjistil, koho zkusebni rezim zastavil; takhle je v outboxu
       * skipped s duvodem a sender ho nikdy neclaimne, protoze claim bere pending.
       */
      if (!canSendInTrial(email, input.trial)) {
        skippedTrial += 1;
        contactIds.push(row.id);
        emails.push(email);
        renderData.push('{}');
        statuses.push('skipped');
        errorCodes.push('trial_not_verified');
        continue;
      }

      // Krok 1: snapshot hodnot kontaktu podle `usedPaths` a strop 8 kB.
      const snapshot = buildRenderData(row, input.renderPlan.usedPaths);
      if (snapshot.tooLarge) {
        // Prilis velka data se NEUKLADAJI: radek vznika rovnou jako skipped s prazdnymi
        // daty, aby jedna patologicka hodnota atributu nenafoukla cely outbox.
        skippedOversize += 1;
        contactIds.push(row.id);
        emails.push(email);
        renderData.push('{}');
        statuses.push('skipped');
        // Duvod se zapisuje az ted. Drive vznikal radek se stavem skipped a PRAZDNYM
        // error_code, takze v outboxu nesel odlisit od zpravy zastavene necim jinym.
        errorCodes.push('render_data_too_large');
        continue;
      }

      // Krok 2: kontraktni priprava. Doplni `_context` a hlavne mapu `_present`,
      // normalizuje cisla nad 2^53 na retezec a oreze pole na strop iteraci.
      // Bez tohohle volani se KAZDY podmineny blok v odeslanem mailu tise skryje.
      const prepared = prepareRenderData(snapshot.data, input.renderPlan.preparedSchema);

      contactIds.push(row.id);
      emails.push(email);
      renderData.push(JSON.stringify(prepared));
      statuses.push('pending');
      errorCodes.push('');
    }

    const inserted = await tx.execute<{ contact_id: string }>(
      rawSql(INSERT_SQL, [
        ctx.workspaceId, // $1
        input.campaignId, // $2
        input.audienceBuiltAt, // $3
        input.releaseAt, // $4
        contactIds, // $5
        emails, // $6
        renderData, // $7
        statuses, // $8
        errorCodes, // $9
      ]),
    );

    return {
      scanned: rows.length,
      inserted: inserted.rows.length,
      skippedOversize,
      skippedTrial,
      nextCursor: rows[rows.length - 1]!.id,
    };
  });
}

/**
 * Okamzita cesta zkusebniho rezimu.
 *
 * Materializace bere zkusebni rezim, jaky platil na zacatku behu. Kdyz ho uzivatel
 * zapne AZ POTOM, uz vlozene pending radky by odesly, protoze o prepnuti nikdo nevi.
 * Je to presne ta situace, kterou u suppression resi `revokePending`: zablokovana
 * adresa taky vznikne az po materializaci a cekajici zpravy se pro ni rusi hned.
 *
 * `status = 'pending'` je zasadni ze stejneho duvodu jako tam: claimnuta zprava se
 * NERUSI, protoze ji sender muze mit prave v ruce. Zbytek dobehne sender sam.
 *
 * Prazdny seznam potvrzenych adres je BEZNY stav, ne chyba: zapnout zkusebni rezim
 * a nemit jeste zadnou potvrzenou adresu znamena zrusit vsechny cekajici zpravy,
 * a presne to je ta ochrana.
 */
export async function revokePendingOutsideTrial(
  ctx: WorkspaceContext,
  verifiedEmails: readonly string[],
): Promise<{ revoked: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = 'trial_not_verified',
                error_detail = 'revoked by trial mode',
                updated_at = now()
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND NOT (lower(m.email) = ANY($2::text[]))`,
        [ctx.workspaceId, verifiedEmails.map((e) => e.toLowerCase())],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  });
}

export type RevokeReason =
  | 'unsubscribed'
  | 'suppressed'
  | 'contact_deleted'
  | 'contact_anonymized'
  | 'processing_restricted'
  | 'contact_status_changed';

/**
 * Podminka status = 'pending' je zasadni: zprava ve stavu claimed se NERUSI, protoze
 * ji sender muze mit prave v ruce a mohla by odejit. Ruseni claimnute zpravy by
 * vytvorilo stav, kdy je v databazi skipped, ale u prijemce ve schrance.
 *
 * ZADNE casove omezeni na created_at. Puvodne tu bylo okno sedmi dnu kvuli partition
 * pruningu a byla to chyba: kampan muze byt pozastavena mesice a jeji pending zpravy
 * lezi ve stare partition. Diky castecnemu indexu idx_messages__ws_email_pending je
 * to levne, protoze v uzavrenych kampanich zadne pending nezbyva.
 */
export async function revokePending(
  ctx: WorkspaceContext,
  input: {
    contactIds?: string[] | undefined;
    emails?: string[] | undefined;
    listId: string | null;
    reason: RevokeReason;
    /**
     * Transakce volajiciho. Kdyz ji volajici preda, bezi zruseni V NI, ne ve vlastni.
     *
     * Neni to optimalizace. Domena kontaktu rusi cekajici zpravy uprostred sve
     * transakce: odhlaseni zapise `consents`, zmeni `list_members` a AZ POTOM rusi
     * postu. Kdyby si zruseni otevrelo vlastni spojeni, vzniknou dva nezavisle
     * commity a s nimi stav, kdy se vnejsi transakce rollbackne, ale zpravy uz
     * jsou zrusene, nebo naopak clovek je odhlaseny a posta mu presto odejde.
     * Se sdilenou transakci to bud plati oboji, nebo nic.
     *
     * Druhy duvod je pool: bez tohohle drzi jeden pozadavek dve spojeni naraz
     * a pri soubehu se pool vycerpa sam sebou.
     */
    tx?: Tx | undefined;
  },
): Promise<{ revoked: number }> {
  const byEmail = !input.contactIds?.length && !!input.emails?.length;
  const match = byEmail ? `lower(m.email) = ANY($3::text[])` : `m.contact_id = ANY($3::uuid[])`;
  const key = byEmail ? (input.emails ?? []).map((e) => e.toLowerCase()) : (input.contactIds ?? []);

  const run = async (tx: Tx): Promise<{ revoked: number }> => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = $2,
                error_detail = 'revoked by application',
                updated_at = now()
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND ${match}
            AND ($4::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM campaigns c
                   WHERE c.id = m.campaign_id AND c.unsubscribe_list_id = $4))`,
        [ctx.workspaceId, input.reason, key, input.listId],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  };

  return input.tx ? run(input.tx) : withWorkspace(ctx, run);
}

/**
 * Zruseni cekajici posty jen podle BLOKOVANYCH ADRES.
 *
 * UZ TO NENI OBSLUHA `outbox.reconcile`. Ta bezi na `reconcilePending` niz, ktera
 * krome suppression resi i odhlaseni, vymaz, smazani, omezene zpracovani a zmenu
 * stavu kontaktu. Tahle uzsi varianta zustava jako samostatny nastroj nad jednim
 * duvodem a drzi ji vlastni testy vcetne `suppressions.query-shape.test.ts`.
 *
 * Tvar je DVA NEZAVISLE EXISTS, ne jeden join, a to ze dvou duvodu. Drivejsi zneni
 * melo `UPDATE messages m ... FROM suppressions s LEFT JOIN contacts c ON c.id = m.contact_id`,
 * tedy odkaz na cilovou tabulku UPDATE uvnitr ON ve FROM. PostgreSQL to odmita chybou
 * "invalid reference to FROM-clause entry for table m", protoze cilova tabulka je do
 * dotazu pridana mimo strom spojeni. Druhy duvod je planovac: obe vetve se takhle
 * daji naplanovat kazda pres svuj index, coz u jedne disjunkce s LEFT JOIN neslo.
 */
export async function reconcileSuppressed(ctx: WorkspaceContext): Promise<{ revoked: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = 'suppressed',
                updated_at = now()
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND (
              EXISTS (
                SELECT 1 FROM suppressions s
                 WHERE s.workspace_id = m.workspace_id
                   AND s.removed_at IS NULL
                   AND lower(s.email::text) = lower(m.email)
              )
              OR EXISTS (
                SELECT 1
                  FROM contacts c
                  JOIN suppressions s
                    ON s.workspace_id = c.workspace_id
                   AND s.fingerprint = ANY(c.email_fingerprints)
                 WHERE c.id = m.contact_id
                   AND s.removed_at IS NULL
              )
            )`,
        [ctx.workspaceId],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  });
}

/**
 * Duvod, proc uz cekajici zprava odejit nesmi, vyhodnoceny K TEDU.
 *
 * PREDIKAT SE NEVYMYSLI, JE TO PREVRACENA OBALKA PUBLIKA. Kdo smi dostat postu,
 * urcuje `segments/compile/envelope.ts` (`deleted_at`, `anonymized_at`,
 * `status <> 'deleted'`, `processing_restricted`, suppression) spolu s branami
 * v `segments/audience.ts` a podminkou `status = 'active'` z materializace.
 * Tenhle CASE je jejich rub. Kdyby si zachytna cesta stanovila vlastni pravidla,
 * rusila by jinou mnozinu, nez jakou materializace zaklada, a rozdil by se
 * projevil jako ztracena posta, ne jako chyba.
 *
 * SLOZENO K TEDU, NE K OKAMZIKU VZNIKU ZPRAVY. Zadna podminka neporovnava nic
 * s `m.created_at`: cte se soucasny stav kontaktu. Presne o to jde, cekajici
 * zprava vznikla, kdyz clovek jeste postu dostavat smel.
 *
 * PORADI JE VYZNAMOVE, ne abecedni, a prvni shoda vyhrava. Clovek splnuje klidne
 * ctyri podminky naraz (odhlaseny, zablokovany, s omezenym zpracovanim, vymazany)
 * a report kampane potrebuje ten duvod, ktery je pravne nejsilnejsi. Poradi
 * `suppressed` pred `unsubscribed` navic odpovida okamzite ceste: pri globalnim
 * odhlaseni tam `addSuppression` rusi drive nez samotne odhlaseni.
 *
 * `m.kind <> 'campaign' THEN NULL` DELI CASE NA DVE POLOVINY a je to oprava
 * ztracene posty, ne optimalizace. Nad tim radkem jsou TVRDE prekazky (vymazany,
 * anonymizovany, s omezenym zpracovanim, na blokovanych adresach); ty plati pro
 * kazdou postu vcetne transakcni. Pod nim jsou prekazky odvozene ze SOUHLASU
 * S MARKETINGEM, a ty davaji smysl jen u kampane, protoze obalka publika, jejimz
 * rubem tenhle CASE je, popisuje vyhradne kampanovou postu.
 *
 * Bez toho radku uloha rusila POTVRZOVACI E-MAIL DVOJIHO SOUHLASU. Ten jde
 * z definice na kontakt ve stavu `unconfirmed`, takze podminka `c.status <> 'active'`
 * na nej sedla vzdycky a zprava skoncila jako `skipped` s duvodem
 * `contact_status_changed` driv, nez si ji sender stihl vzit. Prihlaseni pres
 * formular tedy nedoslo NIKDY a nevypadalo to jako chyba: radek v `messages`
 * existoval a mel verohodny duvod. Zmereno 7. 8. 2026 na dvou skutecnych
 * prihlasenich, 15:46 a 15:48, obe zrusena do jedne minuty po vzniku.
 *
 * Je to tataz zamena, kterou tenhle soubor uz jednou udelal u `cancelPendingBatch`,
 * kde chybejici `kind = 'campaign'` rusil testovaci maily spolu s kampani.
 */
const REVOKE_REASON_CASE = `CASE
  WHEN c.id IS NULL THEN
    CASE WHEN EXISTS (
      SELECT 1 FROM suppressions s
       WHERE s.workspace_id = m.workspace_id
         AND s.removed_at IS NULL
         AND lower(s.email::text) = lower(m.email)
    ) THEN 'suppressed' END
  WHEN c.anonymized_at IS NOT NULL THEN 'contact_anonymized'
  WHEN c.deleted_at IS NOT NULL OR c.status = 'deleted' THEN 'contact_deleted'
  WHEN c.processing_restricted THEN 'processing_restricted'
  WHEN EXISTS (
    SELECT 1 FROM suppressions s
     WHERE s.workspace_id = c.workspace_id
       AND s.removed_at IS NULL
       AND (s.email = c.email OR s.fingerprint = ANY(c.email_fingerprints))
  ) THEN 'suppressed'
  WHEN m.kind <> 'campaign' THEN NULL
  WHEN c.status = 'unsubscribed' THEN 'unsubscribed'
  WHEN ca.unsubscribe_list_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM list_subscriptions ls
     WHERE ls.workspace_id = c.workspace_id
       AND ls.contact_id = c.id
       AND ls.list_id = ca.unsubscribe_list_id
       AND ls.status = 'unsubscribed'
  ) THEN 'unsubscribed'
  WHEN c.status <> 'active' THEN 'contact_status_changed'
END`;

/**
 * ZACHYTNA CESTA nad rusenim cekajici posty, cela.
 *
 * Okamzita cesta (port `revokePendingMessages`) rusi postu ve stejne transakci,
 * ve ktere se clovek odhlasi nebo se zapise na blokovane adresy. Tahle uloha je
 * pojistka pro pripady, kam okamzita cesta nedosahne:
 *
 *  - pad procesu mezi materializaci a odhlasenim,
 *  - primy zapis do databaze, import, obnova ze zalohy,
 *  - kontakt, ktery ma adresu vedenou jako OTISK pod jinym hlavnim e-mailem;
 *    okamzita cesta u suppression hleda kontakt porovnanim `contacts.email`,
 *  - cekajici zprava adresy, ke ktere uz radek kontaktu neexistuje.
 *
 * IDEMPOTENCE stoji na `status = 'pending'`. Uloha jen prepina pending na skipped,
 * takze druhy beh nad tymz stavem uz zadny pending radek nenajde a zrusi nula.
 * Neni to uvaha, hlida to test dvema behy za sebou.
 *
 * `status = 'pending'` je zaroven jedina ochrana claimnute zpravy: tu si sender
 * uz vzal a muze ji mit prave v ruce, takze jeji zruseni by vyrobilo radek, ktery
 * je v databazi skipped a u prijemce ve schrance.
 *
 * ROZSAH ODHLASENI DRZI. Odhlaseni z jednoho seznamu rusi jen postu kampani,
 * ktere maji ten seznam jako `unsubscribe_list_id`. Bez te podminky by clovek,
 * ktery se odhlasil z jednoho newsletteru, prisel o vsechny ostatni, na ktere
 * zustal prihlaseny, a nikdo by si toho nevsiml: zpravy by skoncily jako skipped
 * s verohodnym duvodem. Je to totez kriterium 79, ktere hlida okamzitou cestu.
 *
 * Vnitrni SELECT a vnejsi UPDATE jsou schvalne dva kroky. `UPDATE ... FROM` s
 * odkazem na cilovou tabulku uvnitr `ON` PostgreSQL odmita chybou "invalid
 * reference to FROM-clause entry for table m"; podrobne u `reconcileSuppressed`.
 * Takhle se duvod spocita jednou a vnejsi prikaz uz jen priradi vysledek.
 */
export async function reconcilePending(ctx: WorkspaceContext): Promise<{ revoked: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = x.reason,
                error_detail = 'revoked by reconcile',
                updated_at = now()
           FROM (
             SELECT m.id, m.created_at, ${REVOKE_REASON_CASE} AS reason
               FROM messages m
               LEFT JOIN contacts c
                 ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
               LEFT JOIN campaigns ca
                 ON ca.id = m.campaign_id AND ca.workspace_id = m.workspace_id
              WHERE m.workspace_id = $1
                AND m.status = 'pending'
           ) x
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND m.id = x.id
            AND m.created_at = x.created_at
            AND x.reason IS NOT NULL`,
        [ctx.workspaceId],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  });
}

/**
 * Pri vymazu kontaktu podle GDPR se adresa ANONYMIZUJE, radky zustavaji, aby nezmizely
 * statistiky kampani. Tvar placeholderu je sjednoceny s casti 2. Domena .invalid je
 * rezervovana RFC 2606, takze na ni nikdy nic neodejde.
 *
 * POZOR: je to navrhove reseni podlehajici pravnimu posouzeni (otevrena otazka O11),
 * ne uzavrene pravidlo. Kdyby posouzeni dopadlo opacne, meni se nazev i chovani teto
 * funkce na deleteMessages a nic jineho na tom nestoji.
 */
export async function anonymizeMessages(ctx: WorkspaceContext, contactId: string): Promise<void> {
  const placeholder = `erased+${contactId}@erased.invalid`;
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE messages
            SET email = $3, render_data = '{}'::jsonb, updated_at = now()
          WHERE workspace_id = $1 AND contact_id = $2`,
        [ctx.workspaceId, contactId, placeholder],
      ),
    );
    await tx.execute(
      rawSql(
        `UPDATE message_events
            SET recipient = $3
          WHERE workspace_id = $1 AND contact_id = $2`,
        [ctx.workspaceId, contactId, placeholder],
      ),
    );
  });
}

/**
 * Jedna davka uklidu. Bezi po 10 000 radcich, aby transakce nebyla dlouha, a volajici
 * ji opakuje, dokud vraci nenulovy pocet. Podminka created_at = audience_built_at
 * je tam kvuli partition pruningu: cela kampan lezi v jedne partition.
 */
export async function cancelPendingBatch(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string },
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    // Filtr `kind = 'campaign'` je nutny, ne kosmeticky. Testovaci zpravy sdileji
    // s publikem `campaign_id` i `created_at`, takze bez nej by zruseni kampane
    // zrusilo i cekajici testovaci maily, ktere si uzivatel prave poslal.
    // `finishMaterialization` ten filtr uz spravne ma, slo tedy o nekonzistenci
    // uvnitr plánu.
    //
    // `ORDER BY id` v poddotazu je DOPLNEK PROTI PLÁNU a neni kosmeticky. Uklid volaji
    // DVE mista soubezne: smycka `cancelCampaign` a `cleanupCancelled` z materializacni
    // smycky. Bez urceneho poradi si kazde z nich zamyka radky v jinem poradi a ob par
    // behu vznikne uvazknuti. Neni to teorie, vypadlo to z opakovaneho testu zavodu
    // jako `40P01 deadlock detected ... while updating tuple in relation
    // messages_y2026m08`. Se spolecnym poradim jeden pockej a pak pokracuje.
    const r = await tx.execute(
      rawSql(
        `UPDATE messages
          SET status = 'skipped',
              error_code = 'campaign_cancelled',
              updated_at = now()
        WHERE campaign_id = $1
          AND created_at = $2::timestamptz
          AND status = 'pending'
          AND kind = 'campaign'
          AND id IN (
            SELECT id FROM messages
             WHERE campaign_id = $1 AND created_at = $2::timestamptz
               AND status = 'pending' AND kind = 'campaign'
             ORDER BY id
             LIMIT ${CANCEL_CLEANUP_BATCH_SIZE}
          )`,
        [input.campaignId, input.audienceBuiltAt],
      ),
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Nenulovy vysledek znamena, ze selhala obe casti ochrany proti zavodu zruseni
 * s materializaci. Je to PORUCHA, ne provozni stav: takove radky nikdo neclaimne,
 * nikdo je neuklidi a navecky brani odpojeni oddilu. Hlasi se jako error.
 */
export async function findOrphanedPending(
  ctx: WorkspaceContext,
): Promise<Array<{ campaign_id: string; orphaned_pending: number }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ campaign_id: string; orphaned_pending: number }>(
      rawSql(
        `SELECT m.campaign_id, count(*)::int AS orphaned_pending
         FROM messages m
         JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.workspace_id = $1
          AND m.status = 'pending'
          AND c.status IN ('cancelled','sent','partially_sent','failed')
        GROUP BY m.campaign_id`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}
