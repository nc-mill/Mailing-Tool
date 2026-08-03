import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { validationFailed } from '../errors/api-error';
/**
 * Seznam se importuje jako JSON modul, nečte se ze souboru. Dřív to byl
 * `fileURLToPath(new URL('./data/common-passwords.txt', import.meta.url))`,
 * jenže z takového zápisu udělá Turbopack odkaz na statický asset s vlastní
 * třídou URL a `fileURLToPath` ho odmítne, takže produkční build spadl už při
 * vyhodnocení modulu. Stejný vzor jako u `caniemail.json` v balíčku emails.
 * Hodnoty jsou uložené oříznuté a malými písmeny, porovnává se s nimi
 * `password.toLowerCase()`.
 */
import COMMON_PASSWORDS from './data/common-passwords.json' with { type: 'json' };

/**
 * Odchylka od plánu: plán importoval `Algorithm` z @node-rs/argon2 a psal
 * `Algorithm.Argon2id`. Jenže je to `declare const enum`, a ten se pod
 * `verbatimModuleSyntax` použít nedá (tsc hlásí TS2748): hodnota žije jen
 * v .d.ts a do JS se z ní neimportuje nic. Zapisuje se proto rovnou číslem,
 * které ten enum deklaruje (`Argon2id = 2`, ověřeno v index.d.ts balíčku).
 */
const ARGON2ID = 2;

/**
 * 3.1: OWASP Password Storage Cheat Sheet nabízí několik rovnocenných variant
 * lišících se poměrem paměti a času. Volíme tu s nejnižší pamětí, protože cílíme
 * na self-hosted instalaci se 2 GB RAM: m=47104 by při deseti souběžných
 * přihlášeních znamenalo skoro půl gigabajtu špičkově.
 */
export const ARGON2_PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Unicode NFKC před hashováním, aby se stejné heslo z různých klávesnic shodovalo. */
export function normalizePassword(raw: string): string {
  return raw.normalize('NFKC');
}

export async function hashPassword(raw: string): Promise<string> {
  return argonHash(normalizePassword(raw), { algorithm: ARGON2ID, ...ARGON2_PARAMS });
}

/**
 * Nikdy nehází. Poškozený PHC řetězec je z pohledu přihlášení totéž co špatné
 * heslo a rozdíl by se dal změřit.
 */
export async function verifyPassword(phc: string, raw: string): Promise<boolean> {
  try {
    return await argonVerify(phc, normalizePassword(raw));
  } catch {
    return false;
  }
}

/**
 * Dummy PHC řetězec pro případ, kdy účet neexistuje. Hash nad ním trvá stejně
 * dlouho jako nad skutečným, takže se z doby odpovědi nedá poznat, jestli účet je.
 * Heslo, ze kterého vznikl, je náhodných 32 bajtů, které nikdo nezná.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$4oAg26exCJUtOKG79tMKtQ$KZinUWa4uQO01yLwhrpfMtA5grYHaJvlPWAMfbePLow';

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * 3.1: po úspěšném ověření se z PHC řetězce přečtou parametry a při neshodě
 * s aktuálními se heslo přehashuje. Tím se instalace samy posunou, až parametry
 * zpřísníme.
 */
export function needsRehash(phc: string): boolean {
  const match = phc.match(PHC_PATTERN);
  if (!match) return true;
  return (
    Number(match[1]) !== ARGON2_PARAMS.memoryCost ||
    Number(match[2]) !== ARGON2_PARAMS.timeCost ||
    Number(match[3]) !== ARGON2_PARAMS.parallelism
  );
}

let blocklist: Set<string> | null = null;

function commonPasswords(): Set<string> {
  if (!blocklist) blocklist = new Set(COMMON_PASSWORDS);
  return blocklist;
}

export function commonPasswordCount(): number {
  return commonPasswords().size;
}

/**
 * Pravidla z 3.1. Žádné povinné třídy znaků: vynucená velká písmena a číslice
 * vedou k Heslo123!, což je horší než dlouhá fráze.
 */
export function assertPasswordPolicy(raw: string, email: string): void {
  const password = normalizePassword(raw);

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_short',
        message: `Heslo musí mít aspoň ${PASSWORD_MIN_LENGTH} znaků.`,
      },
    ]);
  }
  // Nad limit odmítnout, ne ořezat: tiché zkrácení by uživatele odstřihlo
  // od účtu, jakmile by heslo napsal celé jinde.
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_long',
        message: `Heslo smí mít nejvýš ${PASSWORD_MAX_LENGTH} znaků.`,
      },
    ]);
  }
  if (commonPasswords().has(password.toLowerCase())) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_common',
        message: 'Tohle heslo je mezi deseti tisíci nejpoužívanějšími. Zvolte jiné.',
      },
    ]);
  }
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_contains_email',
        message: 'Heslo nesmí obsahovat část vaší e-mailové adresy.',
      },
    ]);
  }
}
