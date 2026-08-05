import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { writeAudit } from '../audit';
import { buildGreeting } from '../naming/greeting';
import { resolveName } from '../naming/resolve';
import { EMPTY_OVERRIDES, type Gender } from '../naming/types';
import { readContactsSettings } from '../settings';
import type { ContactResponse } from '../api/schemas';
import { getContactById } from './contacts-query';

/**
 * RUČNÍ PŘEPIS OSLOVENÍ U JEDNOHO KONTAKTU.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Zámek `vocative_locked` v datech i v pravidlech zápisu
 * existoval od začátku (pravidlo 6 v `applyWriteRules`, větve `WHEN ... OR
 * contacts.vocative_locked THEN contacts.first_name_vocative` v dávkovém upsertu),
 * ale NEEXISTOVALA cesta, jak ho zvenčí nastavit pro JEDEN kontakt. Jediné místo,
 * které zámek zapínalo, byla hromadná akce fronty `vocative-review/actions.ts`,
 * a ta pracuje nad SKUPINOU stejných jmen, ne nad kontaktem, a bere výhradně řádky
 * s `vocative_confidence = 'low' AND vocative_locked = false`. Kontakt, u kterého se
 * systém mýlí, ale je si jistý, se tedy opravit nedal vůbec.
 *
 * Pole `first_name_vocative` sice bylo ve `ContactUpsertRequestSchema` s komentářem
 * "Zadání vokativu zamkne přepočet", jenže `ContactUpsertBody` ho nemá a žádná cesta
 * zápisu ho nečetla. Bylo to mrtvé pole: klient ho poslal, server odpověděl 200
 * a nezměnilo se nic.
 *
 * CO SE ZAPISUJE. Tvary vokativu, `vocative_confidence = 'high'`, zámek a razítko
 * kontroly, a k tomu PŘEPOČÍTANÉ `greeting` a `greeting_neutral`. Oslovení se
 * přepočítat MUSÍ ve stejné transakci: kdyby se zapsal jen vokativ, zůstala by ve
 * sloupci `greeting` stará věta a odeslaná kampaň by ruční opravu ignorovala.
 * Přesně tuhle past hlídá `recomputeGreetingForGroup` u hromadné akce.
 *
 * CO SE NEZAPISUJE. Jméno, rod ani nic dalšího. Na to je editační formulář; tahle
 * operace je úzká schválně, aby se dala nabídnout přímo z detailu kontaktu bez
 * rizika, že tlačítko "Upravit oslovení" přepíše něco jiného.
 */

export type GreetingOverrideInput = {
  /**
   * Tvar křestního jména v 5. pádu. `null` znamená "kontakt oslovovat bez jména",
   * tedy táž volba, jakou má fronta pod tlačítkem "Nepoužívat jméno". Prázdný
   * řetězec se chová jako `null`, protože vymazané pole ve formuláři přijde jako `''`
   * a "Dobrý den, " s visící čárkou nesmí vzniknout nikdy (kritérium 22).
   */
  firstNameVocative: string | null;
  /** Tvar příjmení v 5. pádu. Nepovinný: projekty, které oslovují křestním jménem, ho nepotřebují. */
  lastNameVocative?: string | null | undefined;
};

export type GreetingOverrideResult = ContactResponse;

/**
 * Zamkne ruční tvar oslovení. Vrací `null`, když kontakt neexistuje nebo je smazaný,
 * aby volající vrátil 404 a nemusel rozlišovat "cizí projekt" od "překlep v identifikátoru".
 */
export async function setGreetingOverride(
  ctx: WorkspaceContext,
  contactId: string,
  input: GreetingOverrideInput,
): Promise<GreetingOverrideResult | null> {
  const written = await withWorkspace(ctx, async (tx) => {
    const row = await loadContact(tx, ctx, contactId);
    if (row === null) return false;

    const settings = await loadNamingSettings(tx, ctx);
    const firstNameVocative = trimToNull(input.firstNameVocative);
    const lastNameVocative =
      input.lastNameVocative === undefined
        ? row.last_name_vocative
        : trimToNull(input.lastNameVocative);

    // Oslovení se skládá TOUTÉŽ funkcí jako při zápisu kontaktu, ne ručně slepeným
    // řetězcem. Kdyby se tady napsalo `'Dobrý den, ' + vocative`, existovala by
    // pravidla pro oslovení na dvou místech a jedno z nich by se rozešlo.
    // `vocativeConfidence: 'high'` je tvrzení o ručně potvrzeném tvaru, ne odhad:
    // člověk ho právě napsal, takže se použít MÁ i v režimu `strict`.
    //
    // ZMĚŘENO, NE ODHADNUTO: `compose` v `naming/greeting.ts` sahá v jazyce BEZ
    // vokativu na nominativ (`useNominative = !localeHasVocative(locale)`) a uložený
    // vokativ přeskočí. To je pro automatický výpočet správně, jenže ruční tvar by
    // tím propadl: kontakt v anglickém projektu se po opravě na „Petře" dál oslovoval
    // „Hello Petr" a člověk, který tvar právě potvrdil, by neviděl žádnou změnu.
    // Ručně potvrzený tvar proto jde do OBOU slotů, a to i když je prázdný: prázdné
    // pole je volba „neoslovovat jménem" a musí platit ve všech jazycích stejně,
    // jinak by kontakt v anglickém projektu dál dostával „Hello Petr". Člověk
    // neurčoval pád, určil TVAR, kterým se má kontakt oslovovat.
    const greeting = buildGreeting({
      locale: row.locale,
      addressForm: settings.addressForm,
      salutationBy: settings.salutationBy,
      vocativePolicy: settings.vocativePolicy,
      firstName: firstNameVocative,
      lastName: lastNameVocative,
      gender: row.gender,
      firstNameVocative,
      lastNameVocative,
      vocativeConfidence: 'high',
    });

    const reviewedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;

    await tx.execute(sql`
      UPDATE contacts
         SET first_name_vocative = ${firstNameVocative},
             last_name_vocative = ${lastNameVocative},
             vocative_confidence = 'high',
             vocative_locked = true,
             vocative_locked_for = coalesce(first_name, '') || '|' || coalesce(last_name, ''),
             vocative_reviewed_at = now(),
             vocative_reviewed_by = ${reviewedBy}::uuid,
             greeting = ${greeting.greeting},
             greeting_neutral = ${greeting.greetingNeutral},
             updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);

    // Auditní akce je záměrně tatáž jako u hromadného potvrzení fronty: je to týž
    // druh zásahu (člověk potvrdil tvar oslovení), jen nad jedním řádkem. Rozsah
    // nese metadatový klíč `scope`, takže se obojí dá v auditu rozlišit bez toho,
    // aby se do registru akcí přidávalo jméno navíc.
    await writeAudit(tx, ctx, {
      action: 'contact.vocative_bulk_confirmed',
      targetType: 'contact',
      targetId: contactId,
      metadata: { scope: 'contact', affected: 1, no_name: firstNameVocative === null },
    });

    return true;
  });

  if (!written) return null;
  return getContactById(ctx, contactId);
}

/**
 * Zruší ruční tvar a vrátí kontakt zpátky pod automatický výpočet.
 *
 * Nestačí shodit zámek: kdyby se jen přepnul `vocative_locked` na false, zůstal by
 * ve sloupcích ručně zapsaný tvar až do nejbližšího zápisu kontaktu, tedy klidně
 * navždy. Vokativ se proto rovnou přepočítá `resolveName`, tedy toutéž cestou,
 * jakou by prošel při uložení kontaktu.
 */
export async function clearGreetingOverride(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<GreetingOverrideResult | null> {
  const written = await withWorkspace(ctx, async (tx) => {
    const row = await loadContact(tx, ctx, contactId);
    if (row === null) return false;

    const settings = await loadNamingSettings(tx, ctx);
    const resolved = resolveName(
      {
        firstName: row.first_name,
        lastName: row.last_name,
        gender: row.gender,
        locale: row.locale,
      },
      {
        // Přepisy projektu se tu ZÁMĚRNĚ nenačítají, stejně jako je nenačítá větev
        // `set_gender` v `vocative-review/actions.ts`. `loadNameOverrides` si otevírá
        // vlastní transakci a volat ji zevnitř téhle by znamenalo transakci ve
        // transakci. Přepis jména je navíc pravidlo pro BUDOUCÍ kontakty; tady
        // uživatel právě ruční tvar ruší a chce vidět, co spočítá automat.
        overrides: EMPTY_OVERRIDES,
        settings: {
          addressForm: settings.addressForm,
          salutationBy: settings.salutationBy,
          vocativePolicy: settings.vocativePolicy,
        },
      },
    );

    await tx.execute(sql`
      UPDATE contacts
         SET first_name_vocative = ${resolved.firstNameVocative},
             last_name_vocative = ${resolved.lastNameVocative},
             vocative_confidence = ${resolved.vocativeConfidence},
             vocative_locked = false,
             vocative_locked_for = NULL,
             greeting = ${resolved.greeting},
             greeting_neutral = ${resolved.greetingNeutral},
             updated_at = now()
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);

    await writeAudit(tx, ctx, {
      action: 'contact.vocative_lock_released',
      targetType: 'contact',
      targetId: contactId,
      metadata: { scope: 'contact', reason: 'manual_release' },
    });

    return true;
  });

  if (!written) return null;
  return getContactById(ctx, contactId);
}

type ContactNameRow = {
  first_name: string | null;
  last_name: string | null;
  first_name_vocative: string | null;
  last_name_vocative: string | null;
  gender: Gender;
  locale: string;
};

async function loadContact(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ContactNameRow | null> {
  const { rows } = await tx.execute<ContactNameRow>(sql`
    SELECT first_name, last_name, first_name_vocative, last_name_vocative, gender, locale
      FROM contacts
     WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
       AND deleted_at IS NULL
  `);
  return rows[0] ?? null;
}

/**
 * Vykání a tykání je sloupec `workspaces.address_form`, zbytek je větev
 * `settings.contacts`. Musí se číst obojí, jinak by se ručně opravený kontakt
 * v projektu, který tyká, přepočítal na vykání.
 */
async function loadNamingSettings(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<{
  addressForm: 'formal' | 'informal';
  salutationBy: 'first_name' | 'surname';
  vocativePolicy: 'strict' | 'balanced';
}> {
  const settings = await readContactsSettings(tx, ctx);
  const { rows } = await tx.execute<{ address_form: 'formal' | 'informal' }>(sql`
    SELECT address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  return {
    addressForm: rows[0]?.address_form ?? 'formal',
    salutationBy: settings.salutation_by,
    vocativePolicy: settings.vocative_policy,
  };
}

/** Prázdný a bílý řetězec se chová stejně jako `null`, viz `nonEmpty` v `naming/greeting.ts`. */
function trimToNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
