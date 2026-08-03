import { loadConfig, type MlainConfig } from '../config';
import type { Logger } from '../logging/logger';

/**
 * Vývojářský vypínač brzd přihlašování, proměnná `LOGIN_THROTTLING_DISABLED`.
 *
 * Brzd je v cestě přihlášení víc a leží ve dvou balíčcích, takže tenhle modul
 * je jediné místo, které o vypínači rozhoduje. Kdo se ptá jinak než přes něj,
 * obchází pojistky.
 *
 * Vypínají se právě tyhle tři věci a nic dalšího:
 *
 *   1. limity přihlašovacích cest v `apps/web/src/lib/api/rate-limit.ts`
 *      (pravidla z `LOGIN_THROTTLE_RULE_NAMES`),
 *   2. zamykání účtu po neúspěších v `login.ts` (`locked_until`),
 *   3. časová podlaha odpovědi z `constant-time.ts`.
 *
 * Ověření hesla se NEMĚNÍ. Vypínač nepouští dovnitř nikoho, kdo heslo nezná,
 * jen přestane zpomalovat toho, kdo ho hádá. Proto ho `cross-checks.ts`
 * v produkci odmítá a proto se hlásí při každém startu.
 */

/**
 * Pravidla limiteru, která vypínač vypíná. Jsou to všechna pravidla na cestě
 * k účtu, tedy i obnova hesla a prvotní nastavení instalace: obojí se při
 * ručním testování prochází opakovaně a obojí má okno v hodinách.
 *
 * Seznam je schválně jen o autentizaci. Limity API klíčů, importu kontaktů ani
 * odesílání kampaní se netýká, ty zůstávají v platnosti i s vypínačem.
 */
export const LOGIN_THROTTLE_RULE_NAMES: readonly string[] = [
  'login_ip',
  'login_ip_email',
  'password_reset_ip',
  'setup_ip',
];

/**
 * Konfigurace se čte líně a memoizovaně, stejně jako v `session.ts`
 * a `api/auth.routes.ts`: načtení při importu modulu by shodilo každý test,
 * který se souboru jen dotkne.
 */
let cachedConfig: MlainConfig | null = null;

function cfg(): MlainConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/** Jsou brzdy přihlašování vypnuté? Bez proměnné vždy `false`. */
export function loginThrottlingDisabled(config?: MlainConfig): boolean {
  return (config ?? cfg()).LOGIN_THROTTLING_DISABLED;
}

/**
 * Zahodí memoizovanou konfiguraci. Jen pro testy, které si prostředí přepínají
 * mezi případy; za běhu se konfigurace nemění.
 */
export function resetLoginThrottlingCache(): void {
  cachedConfig = null;
  warned = false;
}

let warned = false;

/**
 * Hlasité hlášení při startu. Vypnutá ochrana, o které se nikde nemluví, je
 * horší než žádná: nikdo si jí nevšimne, dokud ji nezneužije útočník.
 *
 * Volá se jednou za proces, takže smí být zavolaná z víc kompozičních kořenů
 * (instrumentace webu i konstrukce registru limiterů) bez toho, aby log
 * zaplavila. Vrací, jestli k varování došlo, aby to šlo otestovat bez čtení logu.
 */
export function warnIfLoginThrottlingDisabled(logger: Logger, config?: MlainConfig): boolean {
  if (!loginThrottlingDisabled(config)) return false;
  if (warned) return false;
  warned = true;
  logger.warn(
    {
      variable: 'LOGIN_THROTTLING_DISABLED',
      disabled: ['rate_limit_login_paths', 'account_lockout', 'constant_time_floor'],
    },
    'BRZDY PŘIHLAŠOVÁNÍ JSOU VYPNUTÉ: limity přihlašovacích cest, zamykání účtu ' +
      'po neúspěších ani časová podlaha odpovědi neplatí. Hádání hesel nic nezpomaluje. ' +
      'Je to vývojářské nastavení, do produkce nepatří a produkční běh s ním nenastartuje.',
  );
  return true;
}
