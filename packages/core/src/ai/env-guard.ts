import { isAiProviderVariable } from '@mlain/core/config';
import { allFallbackEnvVars } from './providers';

export type MinimalLogger = { warn: (payload: Record<string, unknown>, message: string) => void };

/**
 * Sjednocení dvou zdrojů, ne jejich duplikát:
 *   1) `isAiProviderVariable` z P01: vzor *_API_KEY plus výčet výjimek
 *      (AWS_BEARER_TOKEN_BEDROCK, GOOGLE_APPLICATION_CREDENTIALS, OLLAMA_HOST, HF_TOKEN, ...)
 *   2) `allFallbackEnvVars()` z registru providerů tohohle plánu
 *
 * Druhý zdroj je tu kvůli proměnným, které vzoru neodpovídají a P01 je ve
 * výčtu nemá. Aktuálně jde o ANTHROPIC_AUTH_TOKEN. Do P01 je to zapsané jako
 * požadavek, ale spoléhat se na cizí opravu u bezpečnostní pojistky nechceme.
 */
function isKnownProviderVariable(name: string): boolean {
  if (isAiProviderVariable(name)) return true;
  return (allFallbackEnvVars() as readonly string[]).includes(name);
}

/**
 * Vrátí názvy proměnných providerů, které po startu zůstaly v prostředí.
 * Hodnoty nikam nevrací a nikam neloguje: jméno proměnné je informace o
 * konfiguraci, hodnota je tajemství.
 */
export function leakedProviderEnvVars(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): string[] {
  return Object.entries(env)
    .filter(
      ([name, value]) =>
        typeof value === 'string' && value.length > 0 && isKnownProviderVariable(name),
    )
    .map(([name]) => name)
    .sort();
}

export function warnOnLeakedEnvKeys(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  logger: MinimalLogger,
): readonly string[] {
  const leaked = leakedProviderEnvVars(env);
  if (leaked.length > 0) {
    logger.warn(
      { code: 'ai_key_leaked_from_env', variables: leaked },
      'Klíč AI providera zůstal v prostředí. Ignoruji ho, klíč se bere výhradně z nastavení projektu.',
    );
  }
  return leaked;
}

/**
 * Druhá vrstva kritéria 7b, a jediná verze téhle funkce, kterou někdo volá
 * v produkci: pouští ji `createAiRuntime()` při startu web i worker procesu
 * (úkol 39).
 *
 * Záměrně NEVYHAZUJE. Klíč z prostředí se nikdy nepoužije, protože jediný
 * zdroj klíče je databáze; zastavit kvůli němu start by znamenalo, že
 * instalace s cizí proměnnou v prostředí nenaběhne, i kdyby AI vůbec
 * nepoužívala. Trvat na pádu by z pojistky udělalo výpadek dostupnosti.
 */
export function assertNoLeakedProviderKeys(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
  logger: MinimalLogger,
): readonly string[] {
  return warnOnLeakedEnvKeys(env, logger);
}

/**
 * Kritérium 7c. Entrypoint maže každou proměnnou, jejíž název končí na
 * `_API_KEY`. Kdyby taková proměnná byla naší konfigurací, entrypoint by ji
 * vymazal a aplikace by spadla na chybějící konfiguraci. Kontrola se pouští
 * nad názvy z manifestu konfigurace (P01).
 */
export function assertNoConfigVarEndsWithApiKey(names: readonly string[]): void {
  const offenders = names.filter((name) => name.endsWith('_API_KEY'));
  if (offenders.length > 0) {
    throw new Error(
      `Konfigurační proměnná nesmí končit na _API_KEY, entrypoint ji maže: ${offenders.join(', ')}`,
    );
  }
}
