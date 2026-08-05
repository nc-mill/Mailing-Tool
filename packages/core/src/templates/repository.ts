import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { designHash } from '@mlain/emails/document/canonical';
import type { Document } from '@mlain/emails/document/types';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';

export type TemplateKind = 'campaign' | 'transactional' | 'system';

/**
 * Kategorie, kterou vidí uživatel v knihovně. NENÍ to `templates.kind`, i když
 * z něj vychází, a schválně to není další hodnota toho sloupce.
 *
 * `kind` je technická klasifikace řádku: rozhoduje o profilu kontroly dokumentu
 * a o tom, jestli řádek do knihovny vůbec patří. Uživatel ho nezadává a slovo
 * `transactional` mu nic neříká.
 *
 * Kategorie odpovídá na otázku „co to je za e-mail", a to je ze dvou třetin
 * uložený fakt (`kind`) a z jedné třetiny fakt o POUŽITÍ:
 *
 * - `campaign`      … marketingové a newsletterové, `kind = 'campaign'`
 * - `form`          … e-mail, který rozesílá formulář, tedy transakční šablona,
 *                     na kterou ukazuje `forms.delivery_template_id`
 * - `transactional` … zbylé transakční, dnes hlavně potvrzení přihlášení
 *                     a uvítací e-mail seznamu (`lists.confirmation_template_id`,
 *                     `lists.welcome_template_id`)
 *
 * PROČ NENÍ `form` ČTVRTÁ HODNOTA `kind`: nebyla by to pravda o řádku, ale
 * o vazbě, a ta se mění bez šablony. Kdo smaže formulář, jeho e-mail přestane
 * být e-mailem z formuláře, jenže sloupec by dál tvrdil opak a nikdo by ho
 * nepřepsal. Odvození z vazby je naproti tomu vždycky aktuální a nepotřebuje
 * migraci ani součinnost domény formulářů.
 *
 * Kategorie se počítá Z `kind` NAPŘED, ne z vazby: `kind` určuje profil
 * kontroly dokumentu, takže šablona s profilem kampaně nesmí skončit mezi
 * transakčními, ani kdyby na ni omylem ukazoval formulář.
 */
export type TemplateCategory = 'campaign' | 'form' | 'transactional';

/**
 * „Ukazuje na tuhle šablonu nějaký formulář?" jako podmínka do SQL.
 *
 * Poddotaz, ne spojení tabulek: spojení by při dvou formulářích nad jednou
 * šablonou zdvojilo řádek ve výpisu a stránkování by přeskakovalo. `EXISTS`
 * se navíc zastaví na prvním nálezu.
 *
 * Projekt se v poddotazu nefiltruje schválně. Nad `forms` platí táž politika
 * RLS jako nad `templates` a cizí řádek se do poddotazu nedostane; opsaná
 * podmínka by budila dojem, že bez ní by se dostal.
 */
const usedByForm = sql`exists (
  select 1 from ${schema.forms}
  where ${schema.forms.deliveryTemplateId} = ${schema.templates.id}
)`;

/** Podmínka jedné kategorie. Kategorie jsou navzájem výlučné, součet dá celek. */
function categoryCondition(category: TemplateCategory) {
  if (category === 'campaign') return eq(schema.templates.kind, 'campaign');
  if (category === 'form') return and(eq(schema.templates.kind, 'transactional'), usedByForm)!;
  return and(eq(schema.templates.kind, 'transactional'), sql`not ${usedByForm}`)!;
}

/**
 * Profil, podle kterého se dokument kontroluje a kompiluje.
 *
 * DEFINICE JE V `@mlain/emails/document/profile`, ne tady, a tohle je jen
 * reexport pro serverovou stranu. Důvod je konkrétní: totéž mapování potřebuje
 * i EDITOR V PROHLÍŽEČI, a tenhle modul sahá přes drizzle na databázi, takže
 * se do prohlížeče nedostane. Druhá kopie by znamenala, že si editor a server
 * můžou o téže šabloně myslet každý něco jiného; přesně to se stalo a projevilo
 * se to tím, že uživatel v editoru neuložil obsah, který server přijme.
 *
 * Systémový profil `@mlain/emails` zůstává nevyužitý. Je to vědomé: žádný
 * řádek `templates` s obsahem systémového e-mailu dnes nevzniká a až vzniknou,
 * dostanou vlastní hodnotu `kind`, ne tuhle.
 */
export { validationProfileFor } from '@mlain/emails/document/profile';

export type TemplateRow = typeof schema.templates.$inferSelect;

/** SHA-256, tedy vždy 32 bajtů. Kratší ani delší buffer se k porovnání nepustí. */
const DESIGN_HASH_BYTES = 32;

/**
 * Kurzor stránkování je DVOJICE `(updated_at, id)`, ne samotné `updated_at`.
 * Hromadná převalidace po smazání kontaktního pole posune `updated_at` mnoha
 * řádkům naráz, klidně na tutéž hodnotu, a kurzor nad jedním sloupcem by pak
 * řádky přeskakoval nebo zdvojoval. Serializuje se jako `<iso>|<uuid>`.
 */
export type ListCursor = string;

function encodeCursor(row: { updatedAt: Date; id: string }): ListCursor {
  return `${row.updatedAt.toISOString()}|${row.id}`;
}

function decodeCursor(cursor: ListCursor): { updatedAt: Date; id: string } {
  const [iso, id] = cursor.split('|');
  const updatedAt = new Date(iso ?? '');
  if (Number.isNaN(updatedAt.getTime()) || !id) throw new Error('invalid_cursor');
  return { updatedAt, id };
}

export type CreateTemplateRowInput = {
  name: string;
  kind: TemplateKind;
  design: Document;
  /**
   * POVINNÉ. Dřív se doplňovalo až druhým voláním `updateTemplateDesign`
   * s týmž dokumentem, jenže to skončilo na shodě hashe a `used_fields`
   * zůstalo prázdné napořád. Nově založená, importovaná ani duplikovaná
   * šablona se pak neobjevila v dopadové analýze smazaného pole
   * a uživatel dostal hlášku „používá to 0 šablon".
   */
  usedFields: string[];
  createdBy?: string;
  starter?: boolean;
};

export async function createTemplateRow(
  tx: Tx,
  ctx: WorkspaceContext,
  input: CreateTemplateRowInput,
): Promise<TemplateRow> {
  const [row] = await tx
    .insert(schema.templates)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      kind: input.kind,
      schemaVersion: input.design.schemaVersion,
      design: input.design,
      designHash: designHash(input.design),
      usedFields: input.usedFields,
      createdBy: input.createdBy ?? null,
      starter: input.starter ?? false,
    })
    .returning();
  return row!;
}

export async function findTemplateById(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<TemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, id),
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
      ),
    );
  return row;
}

export type ListTemplatesOptions = {
  limit: number;
  cursor?: ListCursor;
  kind?: TemplateKind;
  category?: TemplateCategory;
  validationState?: string;
};

/**
 * Filtr stránky šablon. Vytažený zvlášť, protože ho potřebují dvě čtení téhož
 * seznamu, plná podoba a úsporná, a dvě kopie podmínek by se při první změně
 * rozešly. Rozdíl mezi nimi je JEN v tom, které sloupce se vybírají.
 */
function listConditions(ctx: WorkspaceContext, options: ListTemplatesOptions) {
  const conditions = [wsEq(ctx, schema.templates), isNull(schema.templates.deletedAt)];
  if (options.cursor) {
    const after = decodeCursor(options.cursor);
    // Řazení je (updated_at DESC, id DESC), takže „za kurzorem" znamená
    // buď starší updated_at, nebo shodné updated_at a menší id.
    conditions.push(
      or(
        lt(schema.templates.updatedAt, after.updatedAt),
        and(eq(schema.templates.updatedAt, after.updatedAt), lt(schema.templates.id, after.id)),
      )!,
    );
  }
  /*
   * Bez výslovného filtru se PRACOVNÍ OBSAHY KAMPANÍ nevypisují.
   *
   * `kind = 'system'` je řádek, který si vyrobila aplikace jako plátno pro
   * editor obsahu kampaně. Do knihovny šablon nepatří: uživatel ho nezaložil
   * a otevřít ho samostatně nedává smysl, protože bez své kampaně nic neznamená.
   *
   * Vylučuje se TADY, v jediné podmínce obou výpisů, ne v každé obrazovce
   * zvlášť. Filtr rozprostřený po volajících stačí v jednom místě vynechat
   * a pomocný řádek je zpátky v knihovně; tady se na něj nedá zapomenout.
   * Týž důvod, proč `campaigns.kind` filtruje sloupcem a ne jménem.
   *
   * Kdo si o systémové řádky výslovně řekne (`?kind=system`), dostane je.
   * Filtr není zákaz, je to výchozí stav.
   */
  if (options.kind) conditions.push(eq(schema.templates.kind, options.kind));
  else conditions.push(ne(schema.templates.kind, 'system'));
  // Filtr knihovny. Stojí VEDLE `kind`, ne místo něj: `kind` je vstup API
  // a smí si o systémové řádky říct, kategorie je volba uživatele v knihovně.
  // Když přijde obojí, platí obojí, protože obojí je zúžení.
  if (options.category) conditions.push(categoryCondition(options.category));
  if (options.validationState) {
    conditions.push(
      eq(
        schema.templates.validationState,
        options.validationState as TemplateRow['validationState'],
      ),
    );
  }
  return conditions;
}

/** Stránka a kurzor z načtených řádků. Kurzor stojí na dvojici (updated_at, id). */
function paginate<T extends { updatedAt: Date; id: string }>(
  rows: T[],
  limit: number,
): { items: T[]; nextCursor: ListCursor | null } {
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
}

export async function listTemplates(
  tx: Tx,
  ctx: WorkspaceContext,
  options: ListTemplatesOptions,
): Promise<{ items: TemplateRow[]; nextCursor: ListCursor | null }> {
  const rows = await tx
    .select()
    .from(schema.templates)
    .where(and(...listConditions(ctx, options)))
    .orderBy(desc(schema.templates.updatedAt), desc(schema.templates.id))
    .limit(options.limit + 1);
  return paginate(rows, options.limit);
}

export type TemplateSummaryRow = Pick<
  TemplateRow,
  'id' | 'name' | 'kind' | 'validationState' | 'starter' | 'updatedAt'
>;

/**
 * Táž stránka šablon bez sloupce `design`.
 *
 * Dokument šablony je zdaleka největší sloupec tabulky a do výběru šablony
 * (rozbalovací seznam v nastavení kampaně, dlaždice na přehledu) není k ničemu.
 * Při padesáti šablonách to je rozdíl mezi použitelným a nepoužitelným seznamem,
 * a nese ho jak odpověď, tak samotný dotaz: `select()` bez výčtu sloupců tahá
 * `design` z databáze, i kdyby ho odpověď zahodila.
 *
 * Vybrané sloupce nejsou libovolné. `updated_at` a `id` musí ve výběru zůstat,
 * protože z nich stojí kurzor stránkování; bez nich by se druhá stránka
 * nedala zaadresovat.
 */
export async function listTemplateSummaries(
  tx: Tx,
  ctx: WorkspaceContext,
  options: ListTemplatesOptions,
): Promise<{ items: TemplateSummaryRow[]; nextCursor: ListCursor | null }> {
  const rows = await tx
    .select({
      id: schema.templates.id,
      name: schema.templates.name,
      kind: schema.templates.kind,
      validationState: schema.templates.validationState,
      starter: schema.templates.starter,
      updatedAt: schema.templates.updatedAt,
    })
    .from(schema.templates)
    .where(and(...listConditions(ctx, options)))
    .orderBy(desc(schema.templates.updatedAt), desc(schema.templates.id))
    .limit(options.limit + 1);
  return paginate(rows, options.limit);
}

/** Kolik šablon je v které kategorii. Klíč `all` je součet, ne další kategorie. */
export type TemplateCategoryCounts = {
  all: number;
  campaign: number;
  form: number;
  transactional: number;
};

/**
 * Počty pro filtr knihovny.
 *
 * Počítají se JEDNÍM dotazem přes `FILTER`, ne čtyřmi. Čtyři dotazy by nad
 * měnícími se daty vrátily čísla z různých okamžiků a součet by neseděl na
 * celek, což je přesně to, čeho si uživatel u filtru všimne první.
 *
 * Kurzor ani zvolená kategorie se sem NEPŘENÁŠÍ: čísla u přepínačů musí platit
 * o celé knihovně, jinak by po přepnutí na „E-maily z formulářů" ukazovaly
 * ostatní kategorie nulu.
 */
export async function countTemplatesByCategory(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<TemplateCategoryCounts> {
  const [row] = await tx
    .select({
      all: sql<number>`count(*)::int`,
      campaign: sql<number>`(count(*) filter (where ${schema.templates.kind} = 'campaign'))::int`,
      form: sql<number>`(count(*) filter (
        where ${schema.templates.kind} = 'transactional' and ${usedByForm}
      ))::int`,
      transactional: sql<number>`(count(*) filter (
        where ${schema.templates.kind} = 'transactional' and not ${usedByForm}
      ))::int`,
    })
    .from(schema.templates)
    .where(
      and(
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
        // Táž výjimka jako ve výpisu: pracovní obsah kampaně není šablona,
        // takže se nesmí objevit ani v čísle nad přepínačem „Vše".
        ne(schema.templates.kind, 'system'),
      ),
    );
  return row ?? { all: 0, campaign: 0, form: 0, transactional: 0 };
}

/**
 * Kde všude je šablona zapojená.
 *
 * Odpovídá na otázku „smím to smazat", ne „kolik z toho vzniklo kampaní".
 * Kampaň si obsah kopíruje do vlastních sloupců, takže smazání šablony nepocítí,
 * kdežto formulář a seznam si e-mail berou ze ŽIVÉ šablony pokaždé, když ho
 * odesílají. Vazba na formulář nebo seznam je proto překážka mazání, vazba
 * z kampaně ne.
 */
export type TemplateUsage = {
  forms: Array<{ id: string; name: string }>;
  lists: Array<{ id: string; name: string; role: 'confirmation' | 'welcome' }>;
};

export const EMPTY_TEMPLATE_USAGE: TemplateUsage = { forms: [], lists: [] };

/*
 * Do registru čtecích funkcí (`templates/index.ts`) se `loadTemplateUsage`
 * NEZAPISUJE. Generický test izolace z P03 uznává za prázdný jen `null`,
 * `undefined` nebo prázdné pole, kdežto tahle funkce vrací mapu. Izolaci
 * navíc drží `wsEq` nad `forms` i `lists` a politiky RLS těch tabulek.
 */
export async function loadTemplateUsage(
  tx: Tx,
  ctx: WorkspaceContext,
  templateIds: readonly string[],
): Promise<Map<string, TemplateUsage>> {
  const usage = new Map<string, TemplateUsage>();
  // Prázdný `IN ()` je v Postgresu syntaktická chyba a drizzle z něj vyrobí
  // `in (null)`. Prázdná stránka tedy nesmí do databáze vůbec.
  if (templateIds.length === 0) return usage;

  const at = (id: string): TemplateUsage => {
    const found = usage.get(id) ?? { forms: [], lists: [] };
    usage.set(id, found);
    return found;
  };

  const [forms, lists] = await Promise.all([
    tx
      .select({
        id: schema.forms.id,
        name: schema.forms.name,
        templateId: schema.forms.deliveryTemplateId,
      })
      .from(schema.forms)
      .where(
        and(wsEq(ctx, schema.forms), inArray(schema.forms.deliveryTemplateId, [...templateIds])),
      )
      .orderBy(asc(schema.forms.name)),
    tx
      .select({
        id: schema.lists.id,
        name: schema.lists.name,
        confirmationTemplateId: schema.lists.confirmationTemplateId,
        welcomeTemplateId: schema.lists.welcomeTemplateId,
      })
      .from(schema.lists)
      .where(
        and(
          wsEq(ctx, schema.lists),
          or(
            inArray(schema.lists.confirmationTemplateId, [...templateIds]),
            inArray(schema.lists.welcomeTemplateId, [...templateIds]),
          ),
        ),
      )
      .orderBy(asc(schema.lists.name)),
  ]);

  for (const form of forms) {
    if (form.templateId) at(form.templateId).forms.push({ id: form.id, name: form.name });
  }
  for (const list of lists) {
    // Jeden seznam může tutéž šablonu použít na potvrzení i na uvítání.
    // Pak se objeví dvakrát, s jinou rolí, protože to jsou dvě různá použití.
    if (list.confirmationTemplateId && templateIds.includes(list.confirmationTemplateId)) {
      at(list.confirmationTemplateId).lists.push({
        id: list.id,
        name: list.name,
        role: 'confirmation',
      });
    }
    if (list.welcomeTemplateId && templateIds.includes(list.welcomeTemplateId)) {
      at(list.welcomeTemplateId).lists.push({ id: list.id, name: list.name, role: 'welcome' });
    }
  }
  return usage;
}

/**
 * Kategorie jedné šablony. `kind` napřed, vazba na formulář rozhoduje až uvnitř
 * transakčních.
 *
 * Pracovní obsah kampaně (`kind = 'system'`) spadne do `campaign`, a je to
 * záměr: do knihovny se nedostane, a kdo si o něj výslovně řekne (`?kind=system`),
 * dostane kategorii shodnou s profilem, kterým se ten dokument kontroluje.
 */
export function categoryOf(kind: TemplateKind, usage: TemplateUsage): TemplateCategory {
  if (kind !== 'transactional') return 'campaign';
  return usage.forms.length > 0 ? 'form' : 'transactional';
}

/**
 * Zápis pracovní verze. Když se hash nezměnil, nezapisuje se nic:
 * autosave běží každých pět sekund a bez tohohle by přepisoval řádek pořád dokola.
 */
export async function updateTemplateDesign(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  design: Document,
  usedFields: string[],
  expectedHash?: Buffer,
): Promise<{ changed: boolean; row: TemplateRow }> {
  // Délku kontrolujeme dřív, než se buffer dostane k porovnání. Hodnota chodí
  // z hlavičky requestu, takže sem může přijít prázdný i přerostlý buffer
  // a `.equals()` by na něm jen tiše vrátil false, tedy „konflikt".
  if (expectedHash && expectedHash.length !== DESIGN_HASH_BYTES) {
    throw new Error('precondition_malformed');
  }
  const current = await findTemplateById(tx, ctx, id);
  if (!current) throw new Error('not_found');
  if (expectedHash && !current.designHash.equals(expectedHash)) {
    throw new Error('precondition_failed');
  }
  const hash = designHash(design);
  if (current.designHash.equals(hash)) return { changed: false, row: current };
  const [row] = await tx
    .update(schema.templates)
    .set({
      design,
      designHash: hash,
      schemaVersion: design.schemaVersion,
      usedFields,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)))
    .returning();
  return { changed: true, row: row! };
}

/**
 * Přejmenování šablony. Mění DVA sloupce, ne jeden, a je to celý smysl funkce.
 *
 * `templates.name` je jméno ŘÁDKU, tedy to, co uživatel vidí v knihovně.
 * `design.meta.name` je jméno DOKUMENTU, a to není zdvojení téhož: skládá se
 * z něj PŘEDMĚT odesílaného e-mailu. Dělají to dvě různá místa nezávisle na
 * sobě, `subjectFor` v `templates/test-send.ts` i `subjectFor`
 * v `contacts/forms/delivery-email.ts`, a obě berou `meta.name` a jméno řádku
 * mají jen jako záložní hodnotu. Kdyby přejmenování sáhlo jen na sloupec,
 * uživatel by si šablonu přejmenoval z „E-mail z formuláře test" na „Děkujeme
 * za zprávu", v knihovně by viděl nový název a lidem by pořád chodil e-mail
 * s předmětem „E-mail z formuláře test". To je přesně ta vada, kvůli které
 * přejmenování vzniká, jen o patro níž.
 *
 * Hash se proto přepočítá a volající ho musí převzít: editor drží `design_hash`
 * jako optimistický zámek a s tím starým by mu příští automatické uložení
 * spadlo na 412 „změnil to někdo jiný".
 *
 * `used_fields` se nepřepočítává schválně. `meta.name` není cesta do dat
 * kontaktu, takže se dopadová analýza polí přejmenováním nemá jak změnit.
 */
export async function renameTemplateRow(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  name: string,
  design: Document,
): Promise<TemplateRow> {
  const [row] = await tx
    .update(schema.templates)
    .set({
      name,
      design,
      designHash: designHash(design),
      updatedAt: new Date(),
    })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)))
    .returning();
  return row!;
}

export async function setValidationState(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  state: 'unknown' | 'valid' | 'invalid',
  errors: unknown[],
): Promise<void> {
  await tx
    .update(schema.templates)
    .set({ validationState: state, validationErrors: errors, updatedAt: new Date() })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)));
}

export async function softDeleteTemplate(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  await tx
    .update(schema.templates)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)));
}

/**
 * Čtení SMAZANÉ šablony. `findTemplateById` ji schválně nevrací, takže obnova
 * potřebuje vlastní dotaz; jinak by musela `deletedAt` v podmínce obcházet
 * ručně a filtr smazaných řádků by přestal být na jednom místě.
 */
export async function findDeletedTemplateById(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<TemplateRow | undefined> {
  const [row] = await tx
    .select()
    .from(schema.templates)
    .where(
      and(
        eq(schema.templates.id, id),
        wsEq(ctx, schema.templates),
        isNotNull(schema.templates.deletedAt),
      ),
    );
  return row;
}

/**
 * Obnova měkce smazané šablony. `updated_at` se NEPOSOUVÁ: obnova není úprava
 * obsahu a posunutím by šablona vyskočila na začátek knihovny řazené podle
 * poslední změny, přestože se v ní nic nezměnilo.
 *
 * Může spadnout na `uq_templates__workspace_name` (SQLSTATE 23505), protože
 * částečný unikátní index jméno hlídá jen mezi nesmazanými řádky: mezitím
 * mohla vzniknout jiná šablona téhož jména. Volající to překládá na konflikt.
 */
export async function restoreTemplateRow(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  await tx
    .update(schema.templates)
    .set({ deletedAt: null })
    .where(and(eq(schema.templates.id, id), wsEq(ctx, schema.templates)));
}

export async function findTemplateIdsUsingField(
  tx: Tx,
  ctx: WorkspaceContext,
  path: string,
): Promise<Array<{ id: string; name: string }>> {
  // GIN index nad used_fields; bez něj by to byl sekvenční průchod s deserializací JSON.
  return tx
    .select({ id: schema.templates.id, name: schema.templates.name })
    .from(schema.templates)
    .where(
      and(
        wsEq(ctx, schema.templates),
        isNull(schema.templates.deletedAt),
        sql`${schema.templates.usedFields} @> ARRAY[${path}]::text[]`,
      ),
    )
    .orderBy(asc(schema.templates.name));
}
