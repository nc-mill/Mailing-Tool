import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../config/index';
import { EXTENSION_BY_MIME, ORIGINAL_VARIANT, type StoredMimeType } from './registry';

/**
 * Úložiště obrázků.
 *
 * TVAR JE OPSANÝ Z `contacts/export/storage.ts` a odchylky jsou jen dvě, obě
 * vynucené specifikací 3.14.3:
 *
 *  1. Kořen je `UPLOADS_DIR` (výchozí `${DATA_DIR}/uploads`), NE `DATA_DIR`.
 *     Není to kosmetika: část 1 balí do zálohy obsah `UPLOADS_DIR` jako
 *     `uploads.tar.gz` včetně počtu souborů a kontrolního součtu v manifestu.
 *     Vlastní adresář vedle by znamenal zálohu, která vypadá úplně a úplná
 *     není, a poznalo by se to teprve při obnově tím, že v obnovených
 *     kampaních chybí obrázky.
 *  2. Klíč je OBSAHOVĚ ADRESOVANÝ (sha256 obsahu), ne odvozený z id řádku.
 *     Deduplikace tím padne na úroveň souborového systému: tentýž obrázek
 *     nahraný podruhé míří na tutéž cestu, takže se nezapíše dvakrát ani
 *     tehdy, kdyby kontrola v databázi selhala.
 *
 * Práva 0600 na souboru a 0700 na adresáři zůstávají. Obrázek sice není osobní
 * údaj jako archiv GDPR, ale `original_filename` uživatele bývá „smlouva-
 * novak.png"; výpis adresáře čitelný pro každý účet na stroji je zbytečné
 * riziko a nic to nestojí.
 */
export type AssetStorage = {
  /** Zapíše obsah pod klíč a vrátí počet skutečně zapsaných bajtů. */
  put(key: string, content: Buffer): Promise<{ byteSize: number }>;
  /** Absolutní cesta ke klíči. Používá ji veřejná trasa při výdeji souboru. */
  resolve(key: string): string;
  /** Velikost souboru, nebo `null` když soubor není. Používá to `doctor` a testy. */
  size(key: string): Promise<number | null>;
  /** Smaže soubor. Idempotentní: chybějící soubor není chyba, úklid běží denně. */
  remove(key: string): Promise<void>;
};

/**
 * Dvouúrovňové rozdělení podle prefixu hashe. Adresář s 50 000 soubory je na
 * některých souborových systémech pomalý; dva bajty prefixu dají 65 536
 * košů, takže na běžnou instalaci vychází pár souborů na adresář.
 *
 * `variant` se do JMÉNA souboru promítá jako vsuvka před příponou, protože
 * varianty téhož obrázku mají patřit k sobě: při ručním úklidu i při čtení
 * `ls` je vidět celá rodina pohromadě.
 */
export function assetStorageKey(input: {
  workspaceId: string;
  sha256Hex: string;
  variant: string;
  mimeType: StoredMimeType;
}): string {
  const extension = EXTENSION_BY_MIME[input.mimeType];
  const hash = input.sha256Hex;
  const suffix = input.variant === ORIGINAL_VARIANT ? '' : `.${input.variant}`;
  return join(
    'assets',
    input.workspaceId,
    hash.slice(0, 2),
    hash.slice(2, 4),
    `${hash}${suffix}.${extension}`,
  );
}

/**
 * Klíč musí zůstat uvnitř `UPLOADS_DIR`.
 *
 * Kontrola je na úložišti, ne u volajícího, a je to POVINNÉ, ne opatrnost:
 * čtecí strana bere klíč z databáze, kdežto veřejná trasa bere `public_id`
 * a příponu z ADRESY, tedy z internetu. Bez téhle kontroly by budoucí zápis,
 * který si klíč složí z čehokoli neověřeného, znamenal, že `/a/...` vydá
 * libovolný soubor ze serveru. Jméno souboru z požadavku se do klíče
 * nedostane nikdy (skládá ho `assetStorageKey` výhradně z uuid a hashe),
 * tohle je druhá vrstva pro případ, že první někdo obejde.
 */
function safeJoin(root: string, key: string): string {
  const base = resolve(root);
  const target = resolve(base, key);
  const rel = relative(base, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Klíč assetu ${JSON.stringify(key)} ukazuje mimo UPLOADS_DIR.`);
  }
  return target;
}

export function createFileAssetStorage(uploadsDir?: string): AssetStorage {
  const root = uploadsDir ?? loadConfig().UPLOADS_DIR;

  return {
    resolve(key: string): string {
      return safeJoin(root, key);
    },

    async size(key: string): Promise<number | null> {
      try {
        return (await stat(safeJoin(root, key))).size;
      } catch {
        return null;
      }
    },

    async put(key: string, content: Buffer): Promise<{ byteSize: number }> {
      const target = safeJoin(root, key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      // Zápis do dočasného souboru a teprve pak přejmenování. `rename` v rámci
      // jednoho svazku je atomické, takže pod klíčem nikdy neleží nedopsaný
      // obrázek. Bez toho by pád procesu uprostřed nahrávání nechal soubor,
      // který se tváří jako hotový, veřejná adresa ho vydá a poštovní klient
      // příjemce zobrazí půlku obrázku.
      //
      // Náhodná přípona řeší souběh: obsahově adresovaný klíč znamená, že dva
      // lidé nahrávající TENTÝŽ obrázek zároveň míří na tutéž cílovou cestu.
      // Bez ní by si rozepsané soubory přepsali navzájem.
      const temp = `${target}.${randomBytes(6).toString('hex')}.part`;
      try {
        await writeFile(temp, content, { mode: 0o600 });
        await chmod(temp, 0o600);
        await rename(temp, target);
      } catch (error) {
        await rm(temp, { force: true });
        throw error;
      }
      return { byteSize: content.length };
    },

    async remove(key: string): Promise<void> {
      await rm(safeJoin(root, key), { force: true });
    },
  };
}
