import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { createSystemContext } from '../identity/context';
import { wsEq } from '../identity/scope';
import { withoutContext, withWorkspace } from '../tx';
import { PUBLIC_ID_PATTERN } from './public-id';
import {
  isStoredMimeType,
  MIME_BY_EXTENSION,
  ORIGINAL_VARIANT,
  type StoredMimeType,
} from './registry';

/**
 * Výdej obrázku na veřejné adrese `<ASSET_BASE_URL>/a/<public_id>/<variant>.<ext>`.
 *
 * TENHLE SOUBOR JE MÍSTO, KDE SE ROZPOR MEZI IZOLACÍ PROJEKTŮ A VEŘEJNOU
 * ADRESOU ŘEŠÍ, takže sem patří i vysvětlení.
 *
 * Asset patří projektu a v databázi na něj dopadá `ws_isolation` úplně stejně
 * jako na kontakty. Adresa obrázku ale musí fungovat bez přihlášení, protože ji
 * otevírá poštovní klient PŘÍJEMCE, ne uživatel produktu (3.14.4). Volající
 * tedy nemá odkud vzít workspace a mít ho nemůže.
 *
 * Řeší se to na DVA KROKY:
 *
 *  1. Bez kontextu se zjistí POUZE `workspace_id`, a to přes politiku
 *     `asset_public_lookup` z migrace 0011. Ta pouští jediný řádek, jehož
 *     `public_id` volající nastaví do `mlain.asset_public_id`. Bez nastavené
 *     proměnné nevydá nic, takže se přes ni nedá vypsat ani spočítat.
 *  2. Všechno ostatní (`storage_key`, rozměry, varianty) se čte až v druhé
 *     transakci pod `withWorkspace` v systémovém kontextu zjištěného projektu,
 *     tedy pod běžnou izolací.
 *
 * CO JE POD `public_id` DOSTUPNÉ: bajty obrázku a nic víc. Odpověď nenese
 * jméno projektu, jeho identifikátor, ani `original_filename` v těle; hlavička
 * `Content-Disposition` nese jméno očištěné na `[A-Za-z0-9._-]`.
 *
 * PROČ TO NEJDE UHODNOUT: `public_id` je 22 znaků base62, tedy zhruba 130 bitů
 * z `randomBytes`. Neodvozuje se z id řádku, z hashe obsahu ani z pořadí
 * nahrání, takže znalost jedné adresy neříká nic o jiné. Postupné zkoušení je
 * mimo možnosti kohokoli; instalace se navíc proti hrubé síle dá přiškrtit
 * `ASSET_RATE_LIMIT_PER_IP`, který je ale výchozím VYPNUTÝ schválně, protože
 * Gmail proxy chodí z omezené sady adres a limit by zasáhl ji.
 */

export type PublicAssetFile = {
  workspaceId: string;
  assetId: string;
  storageKey: string;
  mimeType: StoredMimeType;
  byteSize: number;
  /** Hex sha256 originálu. Základ pro ETag. */
  sha256Hex: string;
  originalFilename: string;
};

/** Tvar jména varianty. Týž výraz jako `ck_asset_variants__variant` v databázi. */
const VARIANT_PATTERN = /^[a-z][a-z0-9_]{0,15}$/;

/**
 * Rozebere `<variant>.<ext>` z posledního segmentu adresy.
 *
 * Dělí se na POSLEDNÍ tečce, ne na první. Jméno varianty tečku obsahovat nesmí
 * (hlídá to `VARIANT_PATTERN`), takže na výsledku to nic nemění, ale dělení na
 * první tečce by u vymyšleného vstupu `a.b.png` dalo variantu `a` a příponu
 * `b.png`, tedy dvě nesmyslné hodnoty místo jedné odmítnuté.
 */
export function parseVariantFile(file: string): { variant: string; extension: string } | null {
  const dot = file.lastIndexOf('.');
  if (dot <= 0 || dot === file.length - 1) return null;
  const variant = file.slice(0, dot);
  const extension = file.slice(dot + 1).toLowerCase();
  if (!VARIANT_PATTERN.test(variant)) return null;
  if (MIME_BY_EXTENSION[extension] === undefined) return null;
  return { variant, extension };
}

/**
 * Najde soubor pro veřejnou adresu, nebo `null`.
 *
 * `null` znamená 404 ve VŠECH případech: neplatný tvar identifikátoru, neznámý
 * identifikátor, neznámá varianta i nesouhlas přípony s uloženým typem.
 * Rozlišovat je by prozradilo, které identifikátory existují, a to je jediná
 * informace, kterou model „veřejné pro toho, kdo zná odkaz" chrání.
 */
export async function resolvePublicAsset(
  publicId: string,
  file: string,
): Promise<PublicAssetFile | null> {
  // Tvar se ověřuje PŘED dotazem. `public_id` má v databázi CHECK na 22 znaků
  // base62, takže delší vstup by stejně nic nenašel, jenže by na něj šel
  // dotaz. Vstup z internetu se do databáze nepouští, dokud neprojde tvarem.
  if (!PUBLIC_ID_PATTERN.test(publicId)) return null;
  const parsed = parseVariantFile(file);
  if (parsed === null) return null;

  const found = await lookupWorkspace(publicId);
  if (found === null) return null;

  const ctx = createSystemContext(found.workspaceId, 'assets.public');
  return withWorkspace(ctx, async (tx) => {
    const [asset] = await tx
      .select()
      .from(schema.assets)
      .where(and(wsEq(ctx, schema.assets), eq(schema.assets.id, found.assetId)))
      .limit(1);
    if (asset === undefined || asset.purgedAt !== null) return null;
    if (!isStoredMimeType(asset.mimeType)) return null;

    // Přípona v adrese musí sedět na uložený typ. Bez téhle kontroly by
    // `/a/<pid>/orig.gif` vydalo JPEG s hlavičkou `image/jpeg`, tedy odpověď,
    // kde si adresa a hlavička protiřečí. Poštovní klienti hádají typ podle
    // obojího a část z nich by obrázek nezobrazila.
    if (MIME_BY_EXTENSION[parsed.extension] !== asset.mimeType) return null;

    const base = {
      workspaceId: found.workspaceId,
      assetId: asset.id,
      mimeType: asset.mimeType,
      sha256Hex: asset.sha256.toString('hex'),
      originalFilename: asset.originalFilename,
    };

    if (parsed.variant === ORIGINAL_VARIANT) {
      return { ...base, storageKey: asset.storageKey, byteSize: asset.byteSize };
    }

    const [variant] = await tx
      .select()
      .from(schema.assetVariants)
      .where(
        and(
          wsEq(ctx, schema.assetVariants),
          eq(schema.assetVariants.assetId, asset.id),
          eq(schema.assetVariants.variant, parsed.variant),
        ),
      )
      .limit(1);
    if (variant === undefined) return null;
    return { ...base, storageKey: variant.storageKey, byteSize: variant.byteSize };
  });
}

/**
 * Krok 1: z `public_id` na `workspace_id`, bez kontextu projektu.
 *
 * `set_config(..., true)` je TRANSAKČNĚ LOKÁLNÍ. Ten třetí argument je
 * povinný a není to detail: bez něj by hodnota zůstala viset na spojení
 * v poolu a další požadavek, který si ji nepřepíše, by četl asset předchozího.
 * Týž důvod, proč obálky v `packages/db/src/repo/tx.ts` nastavují
 * `mlain.workspace_id` taky s `true`.
 */
async function lookupWorkspace(
  publicId: string,
): Promise<{ workspaceId: string; assetId: string } | null> {
  return withoutContext(async (tx) => {
    await tx.execute(sql`SELECT set_config('mlain.asset_public_id', ${publicId}, true)`);
    const { rows } = await tx.execute<{ id: string; workspace_id: string }>(sql`
      SELECT id, workspace_id FROM assets WHERE public_id = ${publicId} LIMIT 1
    `);
    const row = rows[0];
    return row === undefined ? null : { workspaceId: row.workspace_id, assetId: row.id };
  });
}

/**
 * Jméno souboru do hlavičky `Content-Disposition`.
 *
 * `original_filename` pochází z multipartu, tedy z internetu, a v hlavičce
 * dělá uvozovka nebo znak nového řádku rozdělení odpovědi. Propouští se proto
 * jen `[A-Za-z0-9._-]` a délka se stříhá; prázdný výsledek padá na `image`.
 */
export function safeDownloadFilename(name: string, extension: string): string {
  const base = name
    // Nejdřív poslední segment cesty, teprve pak zbytek. V opačném pořadí by
    // `../../secret` přišlo o „příponu" `/secret` a zbyla by z toho změť teček.
    .slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1)
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 80);
  // Přípona se přidává NAŠE, z uloženého typu, ne uživatelova. Kdo nahraje
  // `virus.png.exe`, dostane ke stažení `virus.png.png`, ne to, co poslal.
  return `${base === '' ? 'image' : base}.${extension}`;
}
