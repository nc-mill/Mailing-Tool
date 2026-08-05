import { desc, eq, ne } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '../../tx';

/**
 * Jediné místo, které sahá na `brand_profiles`. Doménové služby berou repozitář
 * jako parametr, takže se testují bez databáze; rozchod se schématem P03 je
 * díky tomu vidět na jednom místě.
 *
 * Dotaz se neomezuje na `workspace_id` sám: nad tabulkou běží RLS a transakce
 * je otevřená `withWorkspace` nebo `withReadOnly`, takže projekt vybírá
 * databáze. Dvojí filtrace by jen zakryla, kdyby politika chyběla.
 */
export type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  source: Record<string, string>;
};

export type BrandTypography = {
  headingStack: string;
  bodyStack: string;
  radius: number;
};

/** Tvar, který potřebuje obrazovka 8.5.4 a panel asistenta. */
export type BrandProfileSummary = {
  id: string;
  name: string;
  sourceUrl: string | null;
  logoAssetId: string | null;
  palette: BrandPalette;
  typography: BrandTypography;
  defaultProfile: boolean;
  extractedAt: string | null;
};

/**
 * Neutrální výchozí značka. Používá se dvakrát: při čtení profilu uloženého
 * starší verzí extrakce a v kompozičním kořeni skládání šablony, kde projekt
 * ještě žádný profil mít nemusí. Proto se exportuje, ať nevznikne třetí kopie
 * těchhle barev.
 */
export const DEFAULT_PALETTE: BrandPalette = {
  primary: '#1f2937',
  secondary: '#4b5563',
  accent: '#2563eb',
  background: '#ffffff',
  text: '#111827',
  source: {},
};

export const DEFAULT_TYPOGRAPHY: BrandTypography = {
  headingStack: 'Arial, Helvetica, sans-serif',
  bodyStack: 'Arial, Helvetica, sans-serif',
  radius: 4,
};

/**
 * `palette` a `typography` jsou v P03 `jsonb`, tedy `unknown`. Čtení je jediné
 * místo, kde se z nich stává typ, a chybějící pole se doplní výchozími, ať
 * obrazovka nespadne na profilu uloženém starší verzí extrakce.
 */
function toPalette(value: unknown): BrandPalette {
  const raw = (value ?? {}) as Partial<BrandPalette>;
  return {
    primary: typeof raw.primary === 'string' ? raw.primary : DEFAULT_PALETTE.primary,
    secondary: typeof raw.secondary === 'string' ? raw.secondary : DEFAULT_PALETTE.secondary,
    accent: typeof raw.accent === 'string' ? raw.accent : DEFAULT_PALETTE.accent,
    background: typeof raw.background === 'string' ? raw.background : DEFAULT_PALETTE.background,
    text: typeof raw.text === 'string' ? raw.text : DEFAULT_PALETTE.text,
    source: typeof raw.source === 'object' && raw.source !== null ? raw.source : {},
  };
}

function toTypography(value: unknown): BrandTypography {
  const raw = (value ?? {}) as Partial<BrandTypography>;
  return {
    headingStack:
      typeof raw.headingStack === 'string' ? raw.headingStack : DEFAULT_TYPOGRAPHY.headingStack,
    bodyStack: typeof raw.bodyStack === 'string' ? raw.bodyStack : DEFAULT_TYPOGRAPHY.bodyStack,
    radius: typeof raw.radius === 'number' ? raw.radius : DEFAULT_TYPOGRAPHY.radius,
  };
}

export type ExtractedBrandProfile = {
  /**
   * Vyplňuje se, přestože RLS projekt vybírá sama: `workspace_id` je NOT NULL
   * bez DEFAULT, takže vynechání skončí chybou 23502, ne tichým doplněním
   * z kontextu.
   */
  workspaceId: string;
  /**
   * Návrh jména pro PRVNÍ značku projektu, typicky doména staženého webu.
   * Existující značku extrakce nepřejmenovává: jméno patří uživateli.
   */
  name: string;
  sourceUrl: string | null;
  /** `palette` i `typography` jsou NOT NULL bez DEFAULT, obojí. */
  palette: unknown;
  typography: unknown;
  tone?: unknown;
};

/**
 * PROJEKT MÁ PRÁVĚ JEDNU ZNAČKU.
 *
 * Rozhodnuto 4. 8. 2026 podle specifikace: obrazovka 8.5.4 (část 6) ukazuje
 * jedno pole s adresou, jedno tlačítko a pod ním výsledek, žádný seznam
 * a žádné přepínání. Nikde v produktu se značka nevybírá: skládání e-mailu
 * i panel asistenta berou `findDefaultBrandProfile`, tedy jednu jedinou.
 * Tabulka víc řádků unese, ale produkt pro ně nemá ani obrazovku, ani smysl.
 *
 * Předchozí podoba zakládala novou značku při KAŽDÉM stažení, takže šesté
 * kliknutí na „Stáhnout" znamenalo šest řádků téhož webu a seznam, se kterým
 * nešlo nic dělat. Odteď stažení PŘEPÍŠE tu jednu, kterou projekt má.
 *
 * Zbytek řádků se rovnou uklidí (`pruneOtherBrandProfiles`), aby se projekty
 * poznamenané starým chováním spravily samy tím, že se značka jednou uloží
 * nebo stáhne. Ruční SQL ani migrace na to nejsou potřeba.
 */
export async function saveExtractedBrandProfile(
  tx: Tx,
  row: ExtractedBrandProfile,
): Promise<{ id: string; removedProfiles: number }> {
  const table = schema.brandProfiles;
  const current = await findDefaultBrandProfile(tx);

  if (current !== null) {
    /*
     * Úklid PŘED zápisem, ne po něm: teprve když v projektu nezůstane jiný
     * řádek, se smí `default_profile` nastavit na true. Částečný unikátní
     * index `uq_brand_profiles__workspace_default` jinak druhou výchozí
     * značku odmítne a spadl by celý běh extrakce.
     */
    const removedProfiles = await pruneOtherBrandProfiles(tx, current.id);
    await tx
      .update(table)
      .set({
        /*
         * `name` ani `logoAssetId` se nepřepisují. Jméno si mohl uživatel
         * změnit a logo vybrat z knihovny médií; extrakce ani jedno nedodává
         * (logo zůstává na uživateli, viz `buildBrandProfile`), takže by je
         * zápisem jen vymazala.
         */
        sourceUrl: row.sourceUrl,
        palette: row.palette as never,
        typography: row.typography as never,
        ...(row.tone === undefined ? {} : { tone: row.tone as never }),
        defaultProfile: true,
        extractedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(table.id, current.id));
    return { id: current.id, removedProfiles };
  }

  /*
   * První značka projektu se rovnou označí za výchozí. Na částečném unikátním
   * indexu `uq_brand_profiles__workspace_default` to spadnout nemůže: sem se
   * běh dostane jedině tehdy, když projekt nemá ani jeden profil.
   */
  const inserted = await tx
    .insert(table)
    .values({
      workspaceId: row.workspaceId,
      name: row.name,
      sourceUrl: row.sourceUrl,
      logoAssetId: null,
      logoDarkAssetId: null,
      palette: row.palette as never,
      typography: row.typography as never,
      tone: (row.tone ?? {}) as never,
      defaultProfile: true,
      extractedAt: new Date(),
    })
    .returning({ id: table.id });
  return { id: inserted[0]!.id, removedProfiles: 0 };
}

/**
 * Úklid značek, které vznikly opakovaným stažením, než se vada opravila.
 *
 * Maže se pod RLS, takže se dotaz nemůže dostat mimo projekt otevřené
 * transakce. `brand_extractions.brand_profile_id` má `ON DELETE SET NULL`,
 * takže historie běhů zůstane; co který běh vytáhl, drží `result`, ne odkaz
 * na profil.
 */
export async function pruneOtherBrandProfiles(tx: Tx, keepId: string): Promise<number> {
  const table = schema.brandProfiles;
  const removed = await tx.delete(table).where(ne(table.id, keepId)).returning({ id: table.id });
  return removed.length;
}

export async function listBrandProfiles(tx: Tx): Promise<BrandProfileSummary[]> {
  const table = schema.brandProfiles;
  const rows = await tx
    .select({
      id: table.id,
      name: table.name,
      sourceUrl: table.sourceUrl,
      logoAssetId: table.logoAssetId,
      palette: table.palette,
      typography: table.typography,
      defaultProfile: table.defaultProfile,
      extractedAt: table.extractedAt,
    })
    .from(table)
    .orderBy(desc(table.defaultProfile), desc(table.createdAt));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl,
    logoAssetId: row.logoAssetId,
    palette: toPalette(row.palette),
    typography: toTypography(row.typography),
    defaultProfile: row.defaultProfile,
    extractedAt: row.extractedAt === null ? null : row.extractedAt.toISOString(),
  }));
}

export async function findBrandProfile(
  tx: Tx,
  profileId: string,
): Promise<BrandProfileSummary | null> {
  const table = schema.brandProfiles;
  const rows = await tx.select().from(table).where(eq(table.id, profileId)).limit(1);
  const row = rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    name: row.name,
    sourceUrl: row.sourceUrl,
    logoAssetId: row.logoAssetId,
    palette: toPalette(row.palette),
    typography: toTypography(row.typography),
    defaultProfile: row.defaultProfile,
    extractedAt: row.extractedAt === null ? null : row.extractedAt.toISOString(),
  };
}

/** Výchozí značka projektu. Panel asistenta ji ukazuje jménem. */
export async function findDefaultBrandProfile(tx: Tx): Promise<BrandProfileSummary | null> {
  const profiles = await listBrandProfiles(tx);
  return profiles.find((profile) => profile.defaultProfile) ?? profiles[0] ?? null;
}

export type BrandProfileInput = {
  name: string;
  palette: BrandPalette;
  typography: BrandTypography;
  logoAssetId: string | null;
};

/**
 * Uložení značky z obrazovky Nastavení → Značka projektu.
 *
 * Píše se do TÉHOŽ profilu, který obrazovka ukazuje, tedy do toho, který
 * vrací `findDefaultBrandProfile`. Kdyby se zakládal nový, uživatel by po
 * změně jedné barvy dostal druhou položku v seznamu značek a asistent by
 * skládal e-maily podle té staré: `findDefaultBrandProfile` bere výchozí,
 * a tou by nová nebyla.
 *
 * Když projekt zatím nemá ani jeden profil, založí se a rovnou se označí za
 * výchozí. Na částečném unikátním indexu `uq_brand_profiles__workspace_default`
 * to spadnout nemůže, protože se vkládá jen tehdy, když žádný profil neexistuje,
 * takže žádný jiný výchozí být nemůže. Stejný postup jako u
 * `saveExtractedBrandProfile`: projekt má právě jednu značku a obě cesty píší
 * do téhož řádku.
 *
 * `extractedAt` zůstává `null`. Ručně zadaná značka se odnikud nestahovala
 * a datum stažení by o ní lhalo; obrazovka podle něj pozná, že u barev nemá
 * co ukazovat jako „odkud jsme ji vzali".
 */
export async function saveDefaultBrandProfile(
  tx: Tx,
  workspaceId: string,
  input: BrandProfileInput,
): Promise<{ id: string }> {
  const table = schema.brandProfiles;
  const current = await findDefaultBrandProfile(tx);

  if (current !== null) {
    // Úklid po starém chování, kdy každé stažení zakládalo další značku.
    // Projekt s jedinou značkou tady smaže nula řádků. Musí být PŘED zápisem,
    // protože až pak smí `default_profile` přejít na true, viz
    // `saveExtractedBrandProfile`.
    await pruneOtherBrandProfiles(tx, current.id);
    await tx
      .update(table)
      .set({
        name: input.name,
        palette: input.palette as never,
        typography: input.typography as never,
        logoAssetId: input.logoAssetId,
        defaultProfile: true,
        updatedAt: new Date(),
      })
      .where(eq(table.id, current.id));
    return { id: current.id };
  }

  const inserted = await tx
    .insert(table)
    .values({
      workspaceId,
      name: input.name,
      sourceUrl: null,
      logoAssetId: input.logoAssetId,
      logoDarkAssetId: null,
      palette: input.palette as never,
      typography: input.typography as never,
      tone: {} as never,
      defaultProfile: true,
    })
    .returning({ id: table.id });
  return inserted[0]!;
}
