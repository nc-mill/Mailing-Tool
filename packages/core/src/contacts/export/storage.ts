import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from '../../config/index';

/**
 * Úložiště hotových exportů.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Job `gdpr.export_subject` archiv se všemi osobními údaji
 * jednoho člověka sestavil a bez úložiště ho ZAHODIL. Žádost podle článku 20 se tím
 * uzavřela jako vyřízená, subjekt dostal potvrzení a žádný soubor. Tichý nesoulad
 * s nařízením vypadá zvenčí stejně jako hotová funkce, proto to nikdo nepoznal.
 *
 * Cesta je TÁŽ jako u exportu kontaktů (`jobs/run-export.ts`): `DATA_DIR/exports/
 * <workspace_id>/<export_id>.<přípona>`, tedy mimo webroot, pod svazkem, který se
 * v Dockeru montuje zvlášť. Nová cesta pro tentýž druh dat by znamenala druhé místo,
 * na které musí myslet zálohy, retence i výmaz.
 */

/**
 * Rozhraní, které si job vyžádá. Existuje kvůli testům a kvůli tomu, aby se dala
 * doplnit varianta nad objektovým úložištěm (`STORAGE_DRIVER=s3`), aniž by se sahalo
 * do jobu. Job smí předpokládat jen tyhle tři operace.
 */
export type ExportStorage = {
  /** Zapíše obsah pod klíč a vrátí počet skutečně zapsaných bajtů. */
  put(key: string, content: Buffer): Promise<{ byteSize: number }>;
  /** Absolutní cesta ke klíči. Používá ji čtení při stahování. */
  resolve(key: string): string;
  /** Smaže soubor. Idempotentní: chybějící soubor není chyba, retence běží opakovaně. */
  remove(key: string): Promise<void>;
};

/**
 * Jméno souboru se skládá VÝHRADNĚ z identifikátorů, nikdy ze vstupu od uživatele.
 * Jméno subjektu ani jeho adresa v cestě nesmí být: cesta se objevuje ve výpisech
 * adresáře, v zálohách i v logu, a to jsou všechno místa, kam osobní údaj nepatří.
 */
export function exportStorageKey(workspaceId: string, exportId: string, ext: string): string {
  return join('exports', workspaceId, `${exportId}.${ext}`);
}

/**
 * Klíč musí zůstat uvnitř `DATA_DIR`. Dnes ho skládá `exportStorageKey` z uuid,
 * takže se ven dostat nemůže, jenže čtecí strana bere klíč z databáze a ten se dá
 * podvrhnout jakýmkoli budoucím zápisem. Kontrola je proto na úložišti, ne u volajícího:
 * `../../../etc/passwd` uložený jako `storage_key` by jinak znamenal, že stažení exportu
 * vydá libovolný soubor ze serveru.
 */
function safeJoin(dataDir: string, key: string): string {
  const base = resolve(dataDir);
  const target = resolve(base, key);
  const rel = relative(base, target);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error(`Klíč exportu ${JSON.stringify(key)} ukazuje mimo DATA_DIR.`);
  }
  return target;
}

/**
 * Úložiště na lokálním disku.
 *
 * TŘI VĚCI, KTERÉ JSOU TU KVŮLI TOMU, ŽE OBSAH JSOU OSOBNÍ ÚDAJE:
 *
 *  1. Práva 0600 na souboru a 0700 na adresáři. `writeFile` sice mód bere, ale umask
 *     ho ořízne, takže se nastavuje ještě jednou přes `chmod`. Bez toho je archiv
 *     s celou historií jednoho člověka čitelný pro každý účet na stroji.
 *  2. Zápis do dočasného souboru a teprve pak přejmenování. `rename` v rámci jednoho
 *     svazku je atomické, takže pod klíčem nikdy neleží nedopsaný archiv. Bez toho by
 *     pád workera uprostřed zápisu nechal soubor, který se tváří jako hotový export,
 *     jde stáhnout a je useknutý.
 *  3. Dočasné jméno nese náhodnou příponu, aby si dva souběžné běhy téhož exportu
 *     nepřepisovaly rozepsaný soubor navzájem.
 */
export function createFileExportStorage(dataDir?: string): ExportStorage {
  const root = dataDir ?? loadConfig().DATA_DIR;

  return {
    resolve(key: string): string {
      return safeJoin(root, key);
    },

    async put(key: string, content: Buffer): Promise<{ byteSize: number }> {
      const target = safeJoin(root, key);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
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
