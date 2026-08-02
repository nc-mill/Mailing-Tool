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

const DEFAULT_PALETTE: BrandPalette = {
  primary: '#1f2937',
  secondary: '#4b5563',
  accent: '#2563eb',
  background: '#ffffff',
  text: '#111827',
  source: {},
};

const DEFAULT_TYPOGRAPHY: BrandTypography = {
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
