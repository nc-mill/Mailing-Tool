import { desc, eq } from 'drizzle-orm';
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

export type NewBrandProfile = {
  /**
   * Vyplňuje se, přestože RLS projekt vybírá sama: `workspace_id` je NOT NULL
   * bez DEFAULT, takže vynechání skončí chybou 23502, ne tichým doplněním
   * z kontextu.
   */
  workspaceId: string;
  name: string;
  sourceUrl: string | null;
  logoAssetId: string | null;
  logoDarkAssetId: string | null;
  /** `palette` i `typography` jsou NOT NULL bez DEFAULT, obojí. */
  palette: unknown;
  typography: unknown;
  tone?: unknown;
};

/**
 * Založení profilu extrakcí značky.
 *
 * `defaultProfile` se ZÁMĚRNĚ nenastavuje. Nad tabulkou je částečný unikátní
 * index `uq_brand_profiles__workspace_default`, takže druhá extrakce v témž
 * projektu by na něm spadla a celý běh by skončil jako `failed`, přestože se
 * značka stáhla i analyzovala. Výchozí značku volí uživatel; dokud žádnou
 * nezvolil, `findDefaultBrandProfile` vrací nejnovější profil.
 */
export async function insertBrandProfile(tx: Tx, row: NewBrandProfile): Promise<{ id: string }> {
  const inserted = await tx
    .insert(schema.brandProfiles)
    .values({
      workspaceId: row.workspaceId,
      name: row.name,
      sourceUrl: row.sourceUrl,
      logoAssetId: row.logoAssetId,
      logoDarkAssetId: row.logoDarkAssetId,
      palette: row.palette as never,
      typography: row.typography as never,
      tone: (row.tone ?? {}) as never,
      extractedAt: new Date(),
    })
    .returning({ id: schema.brandProfiles.id });
  return inserted[0]!;
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
