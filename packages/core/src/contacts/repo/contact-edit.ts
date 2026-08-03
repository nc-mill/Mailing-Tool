import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import type { WorkspaceContext } from '../../identity/types';
import { withWorkspace, type Tx } from '../../tx';
import { normalizeNameKey } from '../naming/normalize';
import { resolveName } from '../naming/resolve';
import type { Gender, NameOverrideLookup, NameResult } from '../naming/types';
import { readContactsSettings } from '../settings';
import type { ContactResponse } from '../api/schemas';
import { upsertContactFromApi, type ContactUpsertBody } from './contacts-api';
import { getContactById } from './contacts-query';
import { addTagsToContact, ensureTags, removeTagFromContact } from './tags';

/**
 * Ruční úprava jednoho kontaktu z obrazovky a náhled oslovení, který k ní patří.
 *
 * Tenhle soubor existuje kvůli jednomu rozdílu, který na první pohled vypadá jako
 * detail a v praxi je to rozdíl mezi "formulář funguje" a "formulář tiše nefunguje":
 *
 *   PATCH /contacts/{id} běží v režimu `update`, a ten v SQL upsertu ZACHOVÁVÁ starou
 *   hodnotu, kdykoliv nová přijde prázdná (`coalesce(nullif(excluded.first_name, ''),
 *   contacts.first_name)`). U dávkového importu je to správně: soubor, který sloupec
 *   nemá, nesmí jménem zamést. U editačního formuláře je to past. Uživatel, kterému
 *   import rozdělil "Petr Novák" na křestní jméno "Petr Novák" a příjmení "Novák",
 *   smaže obsah pole, uloží, dostane 200 OK a příjmení tam je pořád.
 *
 * Formulář proto ukládá v režimu `overwrite`: co je na obrazovce, to je v databázi.
 * Totéž platí pro rod, který v režimu `update` nejde vrátit na `unknown`
 * (`WHEN excluded.gender = 'unknown' AND NOT overwrite THEN contacts.gender`).
 *
 * Pravidla zápisu se tím NEOBCHÁZEJÍ. `overwrite` je jeden ze čtyř režimů, které
 * `applyWriteRules` zná, a pravidla 1 až 4 (adresa se nemění, atributy se slučují,
 * stav se nepovyšuje, stížnost a výmaz blokují zápis) platí ve všech čtyřech stejně.
 */

/** Rozšíření těla upsertu o věci, které formulář umí, ale dávkový zápis ne: odebírání. */
export type ContactEditBody = Omit<ContactUpsertBody, 'email' | 'on_conflict' | 'tags'> & {
  /**
   * ÚPLNÝ seznam štítků kontaktu, ne přírůstek. Štítky, které tu nejsou, se odeberou.
   *
   * `upsertContactFromApi` umí štítky jen přidávat, protože jeho volajícím je import
   * a webhook, a "soubor bez sloupce se štítky" nesmí štítky mazat. Formulář má opačné
   * zadání: zaškrtávátko, které uživatel odškrtl, musí štítek opravdu odebrat.
   */
  tags?: string[] | undefined;
};

/**
 * Úprava kontaktu z formuláře. Adresa se NEMĚNÍ, na to je POST /contacts/{id}/change-email:
 * změna adresy musí přepočítat otisky a ověřit kolizi s živým kontaktem, což je jiná
 * operace s jiným selháním.
 *
 * Vrací `null`, když kontakt neexistuje nebo je smazaný, aby volající vrátil 404 a nemusel
 * rozlišovat "cizí projekt" od "překlep v identifikátoru" (7.3 části 2).
 */
export async function replaceContact(
  ctx: WorkspaceContext,
  contactId: string,
  body: ContactEditBody,
): Promise<ContactResponse | null> {
  const current = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ email: string }>(sql`
      SELECT email::text AS email FROM contacts
       WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND deleted_at IS NULL
    `);
    return rows[0] ?? null;
  });
  if (current === null) return null;

  const { tags, ...rest } = body;

  // Štítky se řeší až po zápisu kontaktu, ale POČÍTAJÍ se z původního stavu: potřebuju
  // vědět, co kontakt měl, abych poznal, co odebrat. Načítá se to před zápisem, protože
  // zápis sám na vazby štítků nesahá a pořadí by nic nezměnilo, jen by se hůř četlo.
  const before = tags === undefined ? null : await getContactById(ctx, contactId);

  // Návratová hodnota se zahazuje schválně: štítky se řeší až pod tímhle voláním, takže
  // kontakt se stejně načítá znovu na konci. Vracet tenhle mezistav by znamenalo vrátit
  // kontakt se starými štítky.
  await upsertContactFromApi(ctx, {
    ...rest,
    email: current.email,
    on_conflict: 'overwrite',
    // Štítky se do upsertu ZÁMĚRNĚ nepředávají. Uměl by je jen přidat a přidané by pak
    // krok níž musel zase odebrat, což by v auditu vypadalo jako dvě změny místo jedné.
  });

  if (tags !== undefined && before !== null) {
    const wanted = new Set(tags.map((name) => name.trim()).filter((name) => name.length > 0));
    for (const tag of before.tags) {
      if (!wanted.has(tag.name)) await removeTagFromContact(ctx, contactId, tag.id);
    }
    const added = [...wanted].filter((name) => !before.tags.some((tag) => tag.name === name));
    if (added.length > 0) await addTagsToContact(ctx, contactId, await ensureTags(ctx, added));
  }

  const fresh = await getContactById(ctx, contactId);
  if (fresh === null) throw new ApiError('not_found');
  return fresh;
}

export type NamePreviewInput = {
  firstName?: string | null | undefined;
  lastName?: string | null | undefined;
  fullName?: string | null | undefined;
  titlePrefix?: string | null | undefined;
  titleSuffix?: string | null | undefined;
  gender?: Gender | undefined;
  locale?: string | undefined;
};

/**
 * Jak bude kontakt osloven, kdyby se tenhle tvar jména uložil. Bez zápisu.
 *
 * Existuje proto, že celý produkt stojí na českém oslovení, a člověk, který opravuje
 * jméno v formuláři, musí vidět DŘÍV NEŽ ULOŽÍ, jestli z "Ondřej" vypadne "Ondřeji"
 * a z "Jana" "Jano". Bez náhledu se to pozná až v odeslané kampani, tedy pozdě.
 *
 * JE TO DRUHÁ IMPLEMENTACE TÉHOŽ PRAVIDLA, schválně, stejně jako `listMailableContacts`
 * je druhou podobou brány z `mailable.ts`. Zápis potřebuje transakci, zámek řádku
 * a šest pravidel; náhled potřebuje jen výsledek. Že se obě cesty neliší, hlídá
 * `contact-edit.db.test.ts`: pro tutéž trojici jméno, příjmení a rod se porovnává
 * `previewName(...)` proti oslovení, které po `writeContact` SKUTEČNĚ leží ve sloupci
 * `greeting`. Kdyby se cesty rozešly, spadne ten test, ne uživatel.
 */
export async function previewName(
  ctx: WorkspaceContext,
  input: NamePreviewInput,
): Promise<NameResult> {
  return withWorkspace(ctx, async (tx) => {
    const settings = await readContactsSettings(tx, ctx);
    const workspace = await loadWorkspaceDefaults(tx, ctx);

    return resolveName(
      {
        ...(input.fullName === undefined ? {} : { fullName: input.fullName }),
        ...(input.firstName === undefined ? {} : { firstName: input.firstName }),
        ...(input.lastName === undefined ? {} : { lastName: input.lastName }),
        ...(input.titlePrefix === undefined ? {} : { titlePrefix: input.titlePrefix }),
        ...(input.titleSuffix === undefined ? {} : { titleSuffix: input.titleSuffix }),
        ...(input.gender === undefined ? {} : { gender: input.gender }),
        locale: input.locale ?? workspace.locale,
      },
      {
        overrides: await loadOverridesFor(tx, ctx, input),
        settings: {
          addressForm: workspace.addressForm,
          salutationBy: settings.salutation_by,
          vocativePolicy: settings.vocative_policy,
        },
      },
    );
  });
}

async function loadWorkspaceDefaults(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<{ locale: string; addressForm: 'formal' | 'informal' }> {
  const { rows } = await tx.execute<{ locale: string; address_form: 'formal' | 'informal' }>(sql`
    SELECT locale, address_form FROM workspaces WHERE id = ${ctx.workspaceId}::uuid
  `);
  const row = rows[0];
  return { locale: row?.locale ?? 'cs', addressForm: row?.address_form ?? 'formal' };
}

/**
 * Přepisy jmen projektu pro klíče, kterých se náhled týká. Načítají se jen ty, ne celá
 * tabulka: projekt s deseti tisíci přepisy by jinak stahoval slovník při každém úhozu
 * do pole se jménem.
 */
async function loadOverridesFor(
  tx: Tx,
  ctx: WorkspaceContext,
  input: NamePreviewInput,
): Promise<NameOverrideLookup> {
  const candidates = new Set<string>();
  for (const value of [input.firstName, input.lastName, input.fullName]) {
    if (value === null || value === undefined) continue;
    for (const part of value.split(/\s+/)) {
      const key = normalizeNameKey(part);
      if (key.length > 0) candidates.add(key);
    }
  }
  if (candidates.size === 0) return { find: () => undefined };

  const { rows } = await tx.execute<{
    kind: 'first' | 'last';
    name_key: string;
    gender: Gender | null;
    vocative: string | null;
  }>(sql`
    SELECT kind, name_key, gender, vocative FROM name_overrides
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND name_key = ANY(${sql.param([...candidates])}::text[])
  `);

  const map = new Map<string, { gender?: Gender; vocative?: string }>();
  for (const row of rows) {
    map.set(`${row.kind}:${row.name_key}`, {
      ...(row.gender === null ? {} : { gender: row.gender }),
      ...(row.vocative === null ? {} : { vocative: row.vocative }),
    });
  }
  return { find: (kind, nameKey) => map.get(`${kind}:${nameKey}`) };
}
