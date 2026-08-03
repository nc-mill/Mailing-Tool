import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  KEY_PURPOSES,
  currentKeyId,
  deriveKey,
  keyringFromEnv,
  type Keyring,
} from '@mlain/contracts/keyring';
import { EXTENSION_BY_MIME, type StoredMimeType } from './registry';

/**
 * Veřejná adresa obrázku podle 3.14.4: `<ASSET_BASE_URL>/a/<public_id>/<variant>.<ext>`.
 *
 * TENTÝŽ TVAR SKLÁDÁ `assetUrl` v `packages/emails/src/emitter/assets.ts`.
 * Dvě implementace jsou tu vědomě a shodu hlídá test: renderer je čistá funkce
 * bez IO a nesmí sáhnout na konfiguraci ani na keyring, kdežto API vrstva
 * potřebuje podepisování podle `ASSET_REQUIRE_SIGNED_URL`. Sloučit je by
 * znamenalo protáhnout keyring do rendereru, což je horší než dvě funkce
 * o třech řádcích, jejichž rozejití testem spadne.
 */
export function publicAssetPath(
  publicId: string,
  variant: string,
  mimeType: StoredMimeType,
): string {
  return `/a/${publicId}/${variant}.${EXTENSION_BY_MIME[mimeType]}`;
}

export type AssetUrlOptions = {
  baseUrl: string;
  /** Zapíná HMAC podpis bez expirace (`ASSET_REQUIRE_SIGNED_URL`). */
  signed?: boolean;
  keyring?: Keyring;
};

export function publicAssetUrl(
  publicId: string,
  variant: string,
  mimeType: StoredMimeType,
  options: AssetUrlOptions,
): string {
  const path = publicAssetPath(publicId, variant, mimeType);
  const base = `${options.baseUrl.replace(/\/$/, '')}${path}`;
  if (options.signed !== true) return base;
  return `${base}?s=${signAssetPath(path, options.keyring ?? keyringFromEnv())}`;
}

/**
 * Podpis cesty pro `ASSET_REQUIRE_SIGNED_URL = true`.
 *
 * BEZ EXPIRACE, A JE TO ZÁMĚR ZE SPECIFIKACE, ne opomenutí. Podepsaná adresa
 * je TRVALE PLATNÝ odkaz na soubor: kdo ji jednou dostane, má ji navždy,
 * protože ji nejde zneplatnit jinak než rotací `SECRET_KEY`, která zneplatní
 * všechny naráz. Pro obrázek v newsletteru to je v pořádku (e-mail leží ve
 * schránce roky), pro cokoli citlivého ne, a přesně tohle musí být napsané
 * v UI u toho přepínače. Podpis chrání proti ENUMERACI, ne proti sdílení.
 *
 * Podepisuje se CESTA včetně varianty a přípony, ne jen `public_id`. Kdyby se
 * podepisoval jen identifikátor, jeden platný podpis by odemkl všechny
 * varianty téhož obrázku, což sice není únik, ale je to slabší tvrzení, než
 * jaké jde mít zadarmo.
 */
export function signAssetPath(path: string, keyring: Keyring): string {
  const master = keyring.get(currentKeyId(keyring));
  if (master === undefined) throw new Error('keyring nezná aktuální pokolení');
  return createHmac('sha256', deriveKey(master, KEY_PURPOSES.assetUrl))
    .update(path, 'utf8')
    .digest('base64url')
    .slice(0, 32);
}

/**
 * Ověření podpisu. Prochází VŠECHNA pokolení klíče, ne jen aktuální: adresa
 * v e-mailu odeslaném před rotací `SECRET_KEY` musí platit dál, jinak by
 * rotace, tedy doporučená bezpečnostní operace, umazala obrázky ze všech
 * odeslaných kampaní.
 */
export function verifyAssetSignature(
  path: string,
  signature: string,
  keyring: Keyring = keyringFromEnv(),
): boolean {
  const given = Buffer.from(signature, 'utf8');
  let ok = false;
  for (const master of keyring.values()) {
    const expected = Buffer.from(
      createHmac('sha256', deriveKey(master, KEY_PURPOSES.assetUrl))
        .update(path, 'utf8')
        .digest('base64url')
        .slice(0, 32),
      'utf8',
    );
    // Porovnává se v konstantním čase a cyklus se NEPŘERUŠUJE po první shodě:
    // `break` by z doby odpovědi udělal informaci o tom, kolikáté pokolení
    // adresu podepsalo.
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
