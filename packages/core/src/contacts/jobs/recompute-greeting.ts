import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { GREETING_RECOMPUTE_BATCH_SIZE } from '../constants';
import { buildGreeting } from '../naming/greeting';
import type { Gender } from '../naming/types';
import { readContactsSettings } from '../settings';

export type RecomputeGreetingPayload = {
  workspaceId: string;
  /**
   * Kde navázat. Je to `contacts.id`, za které se má pokračovat, tedy táž
   * hodnota, jakou nese `payloadFields: ['workspace_id', 'cursor']` v registru
   * front. Vynechaný kurzor znamená "od začátku".
   *
   * Průchod si kurzor posouvá SÁM a job doběhne celý; kurzor v nákladu je pro
   * ruční navázání po přerušeném běhu, ne pro řetězení úloh. Řetězení by
   * u fronty se `singletonKey = <workspace_id>` narazilo na to, že zařazující
   * úloha je v tu chvíli ještě aktivní, takže by se pokračování nezaložilo.
   */
  cursor?: string;
};

/**
 * Přepočet oslovení všech kontaktů projektu po změně nastavení.
 *
 * KDY SE ZAŘAZUJE. Oslovení je odvozená hodnota: skládá se z jména, uloženého
 * vokativu a nastavení projektu (`workspaces.address_form`, `settings.contacts
 * .salutation_by`, `settings.contacts.vocative_policy`). Jméno i vokativ se
 * přepočítají při každém zápisu kontaktu, ale změna NASTAVENÍ se sama do žádného
 * kontaktu nepropíše. Bez tohohle jobu by projekt, který přepnul z vykání na
 * tykání, rozeslal příští kampaň se starým oslovením a nic by o tom neřeklo.
 * Producent je proto `updateWorkspace` v `identity/workspace-service.ts`, který
 * úlohu zařazuje v TÉŽE transakci jako změnu `address_form`.
 *
 * CO SE ZAPISUJE, A CO NIKDY. Job píše VÝHRADNĚ `greeting` a `greeting_neutral`.
 * Sloupců `first_name_vocative`, `last_name_vocative`, `vocative_confidence`
 * a `vocative_locked` se nedotkne ani u jednoho kontaktu, protože vokativ na
 * nastavení projektu nezávisí: závisí na jméně a rodu. Zámek `vocative_locked`
 * je tím respektovaný z konstrukce, ne kontrolou v podmínce, a ručně potvrzené
 * oslovení tenhle běh přepsat NEUMÍ. Zamčený kontakt se přesto do výběru bere
 * a bere se schválně: člověk potvrdil TVAR JMÉNA ("Jano"), ne celou větu,
 * takže po přepnutí projektu na tykání musí i jemu vzniknout "Ahoj Jano".
 * Kdyby se zamčené kontakty přeskočily, zůstaly by jediné s vykáním v celém
 * projektu.
 *
 * OCHRANA PROTI PŘEPSÁNÍ PRÁZDNOU HODNOTOU (nález I91). Vypočtené oslovení se
 * zahazuje, když je prázdné, a to na obou stranách: prázdné výsledky se do
 * dávky vůbec nedostanou a `UPDATE` má proti prázdné hodnotě ještě druhou
 * podmínku. Nález I91 vznikl přesně opačným pořadím úvahy, totiž že odvozený
 * sloupec ochranu nepotřebuje, když ji má sloupec zdrojový. Na produktu, jehož
 * jedinou odlišností je správné české oslovení, je tichý přepis prázdnem ta
 * nejdražší možná porucha.
 *
 * Idempotence: přepočet je čistá funkce vstupu, druhý běh zapíše tytéž hodnoty.
 * Přesně to tvrdí `CONTACTS_QUEUES['contacts.recompute_greeting']`.
 *
 * Kontext projektu se vyrábí z payloadu jedinou povolenou továrnou
 * `createSystemContext`, stejně jako u `strip-attribute` a `bulk-delete`. Handle
 * bez kontextu by pod RLS nevrátil ani řádek a job by ohlásil úspěch, přestože
 * by nepřepočítal nic.
 */
export async function recomputeGreeting(
  payload: RecomputeGreetingPayload,
): Promise<{ scanned: number; updated: number }> {
  const ctx = createSystemContext(payload.workspaceId, 'contacts.recompute_greeting');
  const settings = await loadGreetingSettings(ctx);

  let cursor = payload.cursor ?? '00000000-0000-0000-0000-000000000000';
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const batch = await withWorkspace(ctx, async (tx) => readBatch(tx, ctx, cursor));
    if (batch.length === 0) break;

    scanned += batch.length;
    // Kurzor se posouvá i tehdy, když dávka nezmění ani řádek. Podmínka výběru
    // se totiž zápisem NEMĚNÍ (bere všechny živé kontakty), takže bez posunu
    // by cyklus na první dávce bez změny běžel donekonečna.
    cursor = batch.reduce((max, row) => (row.id > max ? row.id : max), cursor);

    const changes = batch
      .map((row) => ({ row, built: buildGreetingFor(row, settings) }))
      .filter(
        ({ row, built }) =>
          // Prázdné oslovení se nezapisuje NIKDY (nález I91).
          built.greeting.length > 0 &&
          built.greetingNeutral.length > 0 &&
          // Zapisují se jen skutečné změny: `updated` má být počet dotčených
          // kontaktů, ne počet přečtených, a zbytečný UPDATE zdražuje běh
          // i replikaci.
          (built.greeting !== row.greeting || built.greetingNeutral !== row.greeting_neutral),
      );

    if (changes.length === 0) continue;
    updated += await writeBatch(ctx, changes);
  }

  return { scanned, updated };
}

type GreetingSettings = {
  addressForm: 'formal' | 'informal';
  salutationBy: 'first_name' | 'surname';
  vocativePolicy: 'strict' | 'balanced';
};

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  first_name_vocative: string | null;
  last_name_vocative: string | null;
  gender: Gender;
  locale: string;
  vocative_confidence: 'high' | 'low' | 'none';
  greeting: string;
  greeting_neutral: string;
};

/**
 * Nastavení se čte JEDNOU na začátku běhu, ne v každé dávce.
 *
 * Vykání a tykání je sloupec `workspaces.address_form`, ne větev
 * `settings.contacts`; obojí se tedy musí přečíst zvlášť. Kdyby se address_form
 * nečetl, přepočítal by se celý projekt na vykání a job, který má tykání
 * rozšířit, by ho naopak plošně zrušil.
 */
async function loadGreetingSettings(ctx: WorkspaceContext): Promise<GreetingSettings> {
  return withWorkspace(ctx, async (tx) => {
    const settings = await readContactsSettings(tx, ctx);
    const { rows } = await tx.execute<{ address_form: 'formal' | 'informal' }>(sql`
      SELECT address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
    `);
    return {
      addressForm: rows[0]?.address_form ?? 'formal',
      salutationBy: settings.salutation_by,
      vocativePolicy: settings.vocative_policy,
    };
  });
}

/**
 * Jedna stránka kontaktů. Průchod jde kurzorem přes `id`, ne přes OFFSET: index
 * `idx_contacts__ws_id` pokrývá dvojici (workspace_id, id) a dotaz nikdy
 * neprochází cizí projekty.
 *
 * Anonymizované kontakty se vynechávají. Po výmazu podle článku 17 nese sloupec
 * jména zástupnou hodnotu a přepočítat z ní oslovení by znamenalo osobní údaj
 * zpátky odvodit.
 */
async function readBatch(tx: Tx, ctx: WorkspaceContext, cursor: string): Promise<ContactRow[]> {
  const { rows } = await tx.execute<ContactRow>(sql`
    SELECT id, first_name, last_name, first_name_vocative, last_name_vocative,
           gender, locale, vocative_confidence, greeting, greeting_neutral
      FROM contacts
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND id > ${cursor}::uuid
       AND deleted_at IS NULL
       AND anonymized_at IS NULL
     ORDER BY id
     LIMIT ${GREETING_RECOMPUTE_BATCH_SIZE}
  `);
  return rows;
}

function buildGreetingFor(
  row: ContactRow,
  settings: GreetingSettings,
): { greeting: string; greetingNeutral: string } {
  return buildGreeting({
    firstName: row.first_name,
    lastName: row.last_name,
    firstNameVocative: row.first_name_vocative,
    lastNameVocative: row.last_name_vocative,
    gender: row.gender,
    locale: row.locale,
    addressForm: settings.addressForm,
    salutationBy: settings.salutationBy,
    vocativePolicy: settings.vocativePolicy,
    // Jistota se bere z kontaktu, ne natvrdo. Právě přes ni působí nastavení
    // `vocative_policy`: ve `strict` se vokativ s jistotou `low` nepoužije.
    // Kdyby se dosadila `high`, obešel by tenhle job celé to nastavení a projekt
    // by po přepočtu oslovoval jménem i tam, kde si ho nechal zakázat.
    vocativeConfidence: row.vocative_confidence,
  });
}

/**
 * Zápis jedné dávky. Píše se DVA sloupce a nic víc, viz hlavička modulu.
 *
 * Podmínka `nullif(..., '') IS NOT NULL` je druhá vrstva ochrany z nálezu I91.
 * První je filtr v aplikaci; tahle drží i pro volajícího, který by funkci
 * `writeBatch` použil s vlastní dávkou.
 */
async function writeBatch(
  ctx: WorkspaceContext,
  changes: readonly { row: ContactRow; built: { greeting: string; greetingNeutral: string } }[],
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const result = await tx.execute<{ id: string }>(sql`
      UPDATE contacts AS c
         SET greeting = g.greeting,
             greeting_neutral = g.neutral,
             updated_at = now()
        FROM unnest(
          ${sql.param(changes.map((c) => c.row.id))}::uuid[],
          ${sql.param(changes.map((c) => c.built.greeting))}::text[],
          ${sql.param(changes.map((c) => c.built.greetingNeutral))}::text[]
        ) AS g(id, greeting, neutral)
       WHERE c.id = g.id
         AND c.workspace_id = ${ctx.workspaceId}::uuid
         AND nullif(g.greeting, '') IS NOT NULL
         AND nullif(g.neutral, '') IS NOT NULL
      RETURNING c.id
    `);
    return result.rows.length;
  });
}
