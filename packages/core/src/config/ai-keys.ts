/**
 * Klíče AI providerů se před spuštěním web a worker procesu z prostředí mažou.
 *
 * Vercel AI SDK i SDK jednotlivých providerů mají fallback: když se klíč
 * nepředá explicitně, sáhnou tiše po proměnné prostředí. Projekt, který si
 * klíč nenakonfiguroval, by tím začal utrácet peníze provozovatele, requesty
 * by prošly a zjistilo by se to až na faktuře (část 1, kapitola 3.12).
 *
 * Vzor, ne výčet: výčet zastará při každém novém provideru a selže tiše.
 * Vzor *_API_KEY je bezpečný, protože žádná konfigurační proměnná Mlain
 * Maileru na _API_KEY nekončí; hlídá to test v forbidden-names.test.ts.
 */
export const AI_PROVIDER_ENV_PATTERN = /_API_KEY$/;

/** Proměnné, které vzoru neodpovídají, a přesto se mažou. */
export const AI_PROVIDER_ENV_EXCEPTIONS: readonly string[] = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'AZURE_OPENAI_ENDPOINT',
  'OLLAMA_HOST',
  'HF_TOKEN',
];

export function isAiProviderVariable(name: string): boolean {
  return AI_PROVIDER_ENV_PATTERN.test(name) || AI_PROVIDER_ENV_EXCEPTIONS.includes(name);
}

/**
 * Druhá vrstva ochrany. Entrypoint proměnné maže; tahle funkce ověří, že po
 * vymazání opravdu nezůstaly, například když někdo spustí `node server.js`
 * napřímo mimo entrypoint. Volající zaloguje warn s kódem ai_key_leaked_from_env
 * a klíč přesto ignoruje.
 */
export function aiKeyVariablesPresent(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && value !== '' && isAiProviderVariable(name))
    .map(([name]) => name);
}
