import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { wsEq } from '../identity/scope';
import type { WorkspaceContext } from '../identity/types';
import type { Tx } from '../tx';
import type { StoredMimeType } from './registry';

export type AssetRow = typeof schema.assets.$inferSelect;
export type AssetVariantRow = typeof schema.assetVariants.$inferSelect;

export type AssetSource = 'upload' | 'brand_extraction' | 'seed' | 'ai';

/**
 * Kurzor je DVOJICE `(created_at, id)`, ne samotné `created_at`. Hromadné
 * nahrání (ukázková data, extrakce značky) zapíše několik řádků ve stejné
 * transakci a `created_at` jim může vyjít shodně; kurzor nad jedním sloupcem
 * by pak řádky přeskakoval nebo zdvojoval. Týž tvar jako u šablon.
 */
export type ListCursor = string;

function encodeCursor(row: { createdAt: Date; id: string }): ListCursor {
  return `${row.createdAt.toISOString()}|${row.id}`;
}

function decodeCursor(cursor: ListCursor): { createdAt: Date; id: string } {
  const [iso, id] = cursor.split('|');
  const createdAt = new Date(iso ?? '');
  if (Number.isNaN(createdAt.getTime()) || !id) throw new Error('invalid_cursor');
  return { createdAt, id };
}

export type InsertAssetInput = {
  publicId: string;
  sha256: Buffer;
  byteSize: number;
  mimeType: StoredMimeType;
  width: number;
  height: number;
  frameCount: number;
  originalFilename: string;
  altText?: string | null;
  source: AssetSource;
  storageKey: string;
  createdBy?: string;
};

export async function insertAsset(
  tx: Tx,
  ctx: WorkspaceContext,
  input: InsertAssetInput,
): Promise<AssetRow> {
  const [row] = await tx
    .insert(schema.assets)
    .values({
      workspaceId: ctx.workspaceId,
      publicId: input.publicId,
      sha256: input.sha256,
      byteSize: input.byteSize,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      frameCount: input.frameCount,
      originalFilename: input.originalFilename,
      altText: input.altText ?? null,
      source: input.source,
      storageKey: input.storageKey,
      ...(input.createdBy === undefined ? {} : { createdBy: input.createdBy }),
    })
    .returning();
  if (row === undefined) throw new Error('asset_insert_failed');
  return row;
}

/**
 * Deduplikace (specifikace 3.14, sloupec `uq_assets__workspace_sha256`).
 *
 * Hledá se VÝHRADNĚ v rámci projektu a jen mezi neuklizenými řádky, protože
 * přesně tak zní unikátní index: `(workspace_id, sha256) WHERE purged_at IS
 * NULL`. Napříč projekty se schválně nededuplikuje. Sdílený soubor by znamenal,
 * že smazání projektu A odnese obrázky projektu B, a hlavně by kvóta
 * `ASSET_QUOTA_MB` přestala měřit to, co měří: kdo nahraje obrázek jako druhý,
 * neplatí za něj místem, a instalace jde zneužít jako cizí CDN zadarmo.
 */
export async function findAssetBySha256(
  tx: Tx,
  ctx: WorkspaceContext,
  sha256: Buffer,
): Promise<AssetRow | null> {
  const [row] = await tx
    .select()
    .from(schema.assets)
    .where(
      and(
        wsEq(ctx, schema.assets),
        eq(schema.assets.sha256, sha256),
        isNull(schema.assets.purgedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findAssetById(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<AssetRow | null> {
  const [row] = await tx
    .select()
    .from(schema.assets)
    .where(and(wsEq(ctx, schema.assets), eq(schema.assets.id, id), isNull(schema.assets.purgedAt)))
    .limit(1);
  return row ?? null;
}

export type ListAssetsQuery = {
  limit: number;
  cursor?: ListCursor;
  /** Podřetězec v původním jménu souboru nebo v alternativním textu. */
  q?: string;
  source?: AssetSource;
  /** `false` (výchozí) vrací jen viditelné, `true` jen skryté. */
  hidden?: boolean;
};

export async function listAssets(
  tx: Tx,
  ctx: WorkspaceContext,
  query: ListAssetsQuery,
): Promise<{ items: AssetRow[]; nextCursor: string | null }> {
  const conditions: Array<SQL | undefined> = [
    wsEq(ctx, schema.assets),
    // Uklizený asset se nevypisuje nikdy. Soubor už na disku není, takže by
    // v knihovně byla dlaždice s rozbitým náhledem.
    isNull(schema.assets.purgedAt),
    query.hidden === true ? isNotNull(schema.assets.hiddenAt) : isNull(schema.assets.hiddenAt),
  ];

  if (query.q !== undefined && query.q !== '') {
    // ILIKE s escapovanými zástupnými znaky. Bez escapování by uživatel psaním
    // `%` dostal celou knihovnu a psaním `_` skoro celou, což vypadá jako vada
    // hledání.
    const needle = `%${query.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    conditions.push(
      or(
        sql`${schema.assets.originalFilename} ILIKE ${needle}`,
        sql`${schema.assets.altText} ILIKE ${needle}`,
      ),
    );
  }
  if (query.source !== undefined) conditions.push(eq(schema.assets.source, query.source));

  if (query.cursor !== undefined) {
    const after = decodeCursor(query.cursor);
    conditions.push(
      or(
        lt(schema.assets.createdAt, after.createdAt),
        and(eq(schema.assets.createdAt, after.createdAt), lt(schema.assets.id, after.id)),
      ),
    );
  }

  const rows = await tx
    .select()
    .from(schema.assets)
    .where(and(...conditions))
    .orderBy(desc(schema.assets.createdAt), desc(schema.assets.id))
    // O jeden víc, než kolik se vrátí: bez toho by se `next_cursor` musel
    // hádat a poslední stránka by nesla kurzor na prázdno.
    .limit(query.limit + 1);

  const items = rows.slice(0, query.limit);
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: rows.length > query.limit && last !== undefined ? encodeCursor(last) : null,
  };
}

/**
 * Varianty pro sadu assetů. Odpověď API i knihovna v editoru potřebují
 * varianty ke KAŽDÉMU řádku stránky, takže jeden dotaz místo N.
 */
export async function listVariants(
  tx: Tx,
  ctx: WorkspaceContext,
  assetIds: readonly string[],
): Promise<AssetVariantRow[]> {
  if (assetIds.length === 0) return [];
  return tx
    .select()
    .from(schema.assetVariants)
    .where(
      and(wsEq(ctx, schema.assetVariants), inArray(schema.assetVariants.assetId, [...assetIds])),
    )
    .orderBy(asc(schema.assetVariants.width));
}

export type VariantInput = {
  variant: string;
  width: number;
  height: number;
  byteSize: number;
  mimeType: string;
  storageKey: string;
};

/**
 * Zápis variant. `ON CONFLICT DO UPDATE`, protože `content.process_asset` běží
 * opakovaně: fronta má `retryLimit: 3` a doplnění varianty přidané do registru
 * později projde i přes assety, které ji už mají. Bez `DO UPDATE` by druhý běh
 * skončil na porušení primárního klíče a úloha by se zasekla v opakování.
 */
export async function upsertVariants(
  tx: Tx,
  ctx: WorkspaceContext,
  assetId: string,
  variants: readonly VariantInput[],
): Promise<number> {
  if (variants.length === 0) return 0;
  await tx
    .insert(schema.assetVariants)
    .values(
      variants.map((variant) => ({
        workspaceId: ctx.workspaceId,
        assetId,
        variant: variant.variant,
        width: variant.width,
        height: variant.height,
        byteSize: variant.byteSize,
        mimeType: variant.mimeType,
        storageKey: variant.storageKey,
      })),
    )
    .onConflictDoUpdate({
      target: [
        schema.assetVariants.workspaceId,
        schema.assetVariants.assetId,
        schema.assetVariants.variant,
      ],
      set: {
        width: sql`excluded.width`,
        height: sql`excluded.height`,
        byteSize: sql`excluded.byte_size`,
        mimeType: sql`excluded.mime_type`,
        storageKey: sql`excluded.storage_key`,
      },
    });
  return variants.length;
}

/**
 * Obsazené místo projektu v bajtech, tedy vstup pro `ASSET_QUOTA_MB`.
 *
 * Sčítá se originál i varianty, protože kvóta měří MÍSTO NA DISKU, ne počet
 * nahraných obrázků. Kdyby se počítal jen originál, projekt s tisícem obrázků
 * by měl na disku zhruba dvojnásobek toho, co kvóta ukazuje, a limit by se
 * dal přesáhnout, aniž by se přesáhl.
 *
 * Uklizené řádky se nezapočítávají: jejich soubory na disku nejsou.
 */
export async function workspaceUsageBytes(tx: Tx, ctx: WorkspaceContext): Promise<number> {
  // `SUM` vrací `numeric`, který ovladač `pg` podává jako ŘETĚZEC, ne číslo:
  // numeric má větší rozsah než `double` a tichá konverze by u velkých hodnot
  // ztrácela přesnost. Převod je proto v aplikaci a je vidět.
  const { rows } = await tx.execute<{ total: string }>(sql`
    SELECT COALESCE((SELECT SUM(byte_size) FROM assets
                      WHERE workspace_id = ${ctx.workspaceId}::uuid AND purged_at IS NULL), 0)
         + COALESCE((SELECT SUM(v.byte_size) FROM asset_variants v
                       JOIN assets a ON a.id = v.asset_id AND a.workspace_id = v.workspace_id
                      WHERE v.workspace_id = ${ctx.workspaceId}::uuid AND a.purged_at IS NULL), 0)
        AS total
  `);
  return Number(rows[0]?.total ?? 0);
}

export async function updateAsset(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  patch: { altText?: string | null; hidden?: boolean },
): Promise<AssetRow | null> {
  const values: Record<string, unknown> = {};
  if (patch.altText !== undefined) values['altText'] = patch.altText;
  // `now()`, ne `new Date()`. Zdůvodnění je u `hideAsset`; platí tu doslova,
  // protože tahle cesta zapisuje TÝŽ sloupec, který úklid porovnává.
  if (patch.hidden !== undefined) values['hiddenAt'] = patch.hidden ? sql`now()` : null;
  if (Object.keys(values).length === 0) return findAssetById(tx, ctx, id);

  const [row] = await tx
    .update(schema.assets)
    .set(values)
    .where(and(wsEq(ctx, schema.assets), eq(schema.assets.id, id), isNull(schema.assets.purgedAt)))
    .returning();
  return row ?? null;
}

export type AssetUsage = { type: string; id: string; name: string };

/**
 * Kde se asset používá. Vstup pro odpověď API (`used_by`) i pro rozhodnutí,
 * jestli se smí smazat.
 *
 * ŽÁDNÁ KASKÁDA TU NENÍ, a je to důležité. `asset_references.ref_id` je
 * polymorfní, ukazuje střídavě na šablonu, na verzi šablony, na kampaň
 * a na profil značky, takže na něm NEMŮŽE být cizí klíč a databáze osiřelou
 * referenci nikdy nesebere sama. Drží to výhradně aplikace
 * (`syncAssetReferences` a `clearAssetReferences`). Kdo si tady přečte, že se
 * to „maže kaskádou", vynechá úklid v nové mazací cestě a vyrobí přesně ten
 * odpad, který má tenhle dotaz jen ukázat.
 *
 * `LEFT JOIN` na obě tabulky, ne `INNER`: osiřelá reference vzniknout může
 * (nová mazací cesta, ruční zásah do dat) a `INNER JOIN` by ji ZAHODIL, takže
 * by odpověď tvrdila, že se asset nikde nepoužívá, přestože `reference_count`
 * je nenulový. To je přesně ten rozpor, kvůli kterému existuje noční
 * `content.verify_asset_refcounts`, a schovat ho před uživatelem by znamenalo,
 * že se o něm nikdo nedozví.
 *
 * JMÉNO SE DOHLEDÁVÁ PRO VŠECHNY ČTYŘI DRUHY VLASTNÍKA, ne jen pro šablonu
 * a kampaň. Verze šablony (`template_version`) vzniká úplně běžně, protože
 * smazání šablony odkazy verzí schválně NECHÁVÁ; než se dohledávala, ukazovalo
 * rozhraní u takového obrázku „použito v:" a za tím nic. Verze se pojmenuje
 * svou šablonou, což je jediné jméno, které pro ni uživatel zná.
 *
 * Prázdné jméno tak zbývá jedině u reference, jejíž vlastník už neexistuje.
 * To je příznak odpadu v datech, ne stav, který by měl v rozhraní nastávat.
 */
export async function assetUsage(
  tx: Tx,
  ctx: WorkspaceContext,
  assetId: string,
): Promise<AssetUsage[]> {
  const { rows } = await tx.execute<{ type: string; id: string; name: string | null }>(sql`
    SELECT r.ref_type AS type,
           r.ref_id   AS id,
           COALESCE(t.name, c.name, vt.name, b.name) AS name
      FROM asset_references r
      LEFT JOIN templates t ON t.id = r.ref_id AND t.workspace_id = r.workspace_id
      LEFT JOIN campaigns c ON c.id = r.ref_id AND c.workspace_id = r.workspace_id
      LEFT JOIN template_versions v ON v.id = r.ref_id AND v.workspace_id = r.workspace_id
      LEFT JOIN templates vt ON vt.id = v.template_id AND vt.workspace_id = v.workspace_id
      LEFT JOIN brand_profiles b ON b.id = r.ref_id AND b.workspace_id = r.workspace_id
     WHERE r.workspace_id = ${ctx.workspaceId}::uuid
       AND r.asset_id = ${assetId}::uuid
     ORDER BY r.ref_type, r.ref_id
  `);
  return rows.map((row) => ({ type: row.type, id: row.id, name: row.name ?? '' }));
}

/**
 * Používá asset kampaň, která už odešla nebo odesílá?
 *
 * Tohle je jediná podmínka, která mazání ZAKÁŽE (specifikace 3.14.5). Důvod je
 * v tom, co se stane, když se poruší: e-mail leží ve schránkách příjemců
 * a obrázek si vyžádá jejich poštovní klient. Smazáním souboru zmizí obrázek
 * lidem, kteří ho už dostali, a nedá se to vzít zpět.
 *
 * Rozpracovaná kampaň a rozpracovaná šablona mazání NEBRÁNÍ, jen se z nich
 * odkaz rozpadne; uživateli se ukáže, kde se to používá, a nabídne se skrytí.
 */
export async function referencedBySentCampaign(
  tx: Tx,
  ctx: WorkspaceContext,
  assetId: string,
): Promise<boolean> {
  const { rows } = await tx.execute<{ hit: number }>(sql`
    SELECT 1 AS hit
      FROM asset_references r
      JOIN campaigns c ON c.id = r.ref_id AND c.workspace_id = r.workspace_id
     WHERE r.workspace_id = ${ctx.workspaceId}::uuid
       AND r.asset_id = ${assetId}::uuid
       AND r.ref_type = 'campaign'
       AND c.status IN ('sending', 'sent', 'paused')
     LIMIT 1
  `);
  return rows.length > 0;
}

/**
 * Skrytí z knihovny. Soubor zůstává, adresa v odeslaném e-mailu funguje dál.
 *
 * ČAS RAZÍ DATABÁZE (`now()`), NE APLIKACE (`new Date()`), a není to kosmetika.
 * Tenhle sloupec se nikde nezobrazuje sám o sobě; jeho jediný čtenář je úklid,
 * který ho porovnává s `now() - lhůta`, tedy s hodinami DATABÁZE. Zápis
 * aplikačními hodinami by do jednoho porovnání pustil dvoje hodiny, a stačí,
 * aby se rozešly, a `hidden_at` vyjde v budoucnosti databáze: řádek pak
 * podmínku nesplní a úklid ho NIKDY nesebere.
 *
 * Naměřeno na sdíleném testovacím Postgresu v kontejneru: rozdíl obou hodin
 * byl 0 až 2 ms, ale celá rezerva mezi „projde" a „neprojde" je pod 10 ms.
 * V provozu to při třicetidenní lhůtě neuvidíš, zato ve zkrácené lhůtě
 * (a v testech, které ji zkracují) rozhoduje pár milisekund shody dvou strojů.
 * Jednoduché pravidlo: co porovnává `now()`, ať `now()` i zapisuje.
 */
export async function hideAsset(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<AssetRow | null> {
  const [row] = await tx
    .update(schema.assets)
    .set({ hiddenAt: sql`now()` })
    .where(
      and(
        wsEq(ctx, schema.assets),
        eq(schema.assets.id, id),
        isNull(schema.assets.purgedAt),
        isNull(schema.assets.hiddenAt),
      ),
    )
    .returning();
  // `null` znamená „už byl skrytý nebo neexistuje". Volající si ho dotáhne sám;
  // opakované skrytí není chyba.
  return row ?? null;
}

/**
 * Kandidáti na fyzické smazání: skryté déle než `days` dní a bez jediné
 * reference. Vstup pro `content.cleanup_assets`.
 *
 * Podmínka `reference_count = 0` je tu ZÁMĚRNĚ ZDVOJENÁ s tím, co hlídá
 * mazací trasa. Skrýt asset jde i tehdy, když ho něco používá (rozpracovaná
 * šablona), takže mezi skrytím a uplynutím lhůty se stav klidně změní. Kdyby
 * úklid četl jen `hidden_at`, smazal by soubor, na který mezitím někdo
 * v šabloně odkázal.
 */
export async function listPurgeCandidates(
  tx: Tx,
  ctx: WorkspaceContext,
  days: number,
  limit: number,
): Promise<AssetRow[]> {
  return tx
    .select()
    .from(schema.assets)
    .where(
      and(
        wsEq(ctx, schema.assets),
        isNull(schema.assets.purgedAt),
        isNotNull(schema.assets.hiddenAt),
        eq(schema.assets.referenceCount, 0),
        sql`${schema.assets.hiddenAt} < now() - make_interval(days => ${days})`,
      ),
    )
    .orderBy(asc(schema.assets.hiddenAt))
    .limit(limit);
}

/** Označení uklizeného assetu. Čas razí databáze, ze stejného důvodu jako u `hideAsset`. */
export async function markPurged(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  await tx
    .update(schema.assets)
    .set({ purgedAt: sql`now()` })
    .where(and(wsEq(ctx, schema.assets), eq(schema.assets.id, id)));
}

/**
 * Ukazuje ještě někdo živý na týž soubor?
 *
 * VOLÁ SE PŘED KAŽDÝM SMAZÁNÍM SOUBORU a je to pojistka proti deduplikaci.
 * Klíč v úložišti je obsahově adresovaný, takže dva řádky téhož projektu můžou
 * ukazovat na tutéž cestu: unikátní index `uq_assets__workspace_sha256` platí
 * jen `WHERE purged_at IS NULL`, takže po uklizení řádku smí vzniknout nový
 * se stejným obsahem, a ten míří na stejnou cestu. Kdyby úklid mazal soubor
 * rovnou podle `storage_key`, druhý řádek by zůstal v databázi a v knihovně,
 * ale jeho soubor by byl pryč a obrázek v e-mailu by zmizel.
 */
export async function storageKeyStillUsed(
  tx: Tx,
  ctx: WorkspaceContext,
  storageKey: string,
  exceptAssetId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.assets.id })
    .from(schema.assets)
    .where(
      and(
        wsEq(ctx, schema.assets),
        eq(schema.assets.storageKey, storageKey),
        isNull(schema.assets.purgedAt),
        sql`${schema.assets.id} <> ${exceptAssetId}::uuid`,
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Rozdíly mezi denormalizovaným `reference_count` a skutečným počtem řádků
 * v `asset_references`. Vstup pro noční `content.verify_asset_refcounts`.
 *
 * Funkce NIC NEOPRAVUJE. Denormalizaci udržuje `syncAssetReferences`
 * v transakci se zápisem dokumentu; tiché dorovnání by z rozpadu udělalo
 * neviditelnou událost a příčina by se nikdy nenašla.
 */
export async function refcountMismatches(
  tx: Tx,
  ctx: WorkspaceContext,
): Promise<Array<{ assetId: string; stored: number; actual: number }>> {
  const { rows } = await tx.execute<{ asset_id: string; stored: number; actual: number }>(sql`
    SELECT a.id AS asset_id,
           a.reference_count AS stored,
           COUNT(r.asset_id)::int AS actual
      FROM assets a
      LEFT JOIN asset_references r
        ON r.asset_id = a.id AND r.workspace_id = a.workspace_id
     WHERE a.workspace_id = ${ctx.workspaceId}::uuid
     GROUP BY a.id, a.reference_count
    HAVING a.reference_count <> COUNT(r.asset_id)
  `);
  return rows.map((row) => ({
    assetId: row.asset_id,
    stored: Number(row.stored),
    actual: Number(row.actual),
  }));
}
