import { needsDependencies } from '../../queues';

/**
 * Vstupní bod, který hledá codegen workeru (P01, rozhodnutí D4). Fronty samotné
 * zakládá P01 dopředu; tady se k nim jen připojují handlery.
 *
 * Jméno `handlers` je závazné: codegen generuje
 * `import { handlers as hN } from '@mlain/core/<domena>/jobs'`. Pod jiným
 * jménem se soubor přeloží a testy projdou, ale bundle workeru spadne až při
 * buildu image.
 *
 * Adresář se odvozuje z PREFIXU JMÉNA FRONTY, ne z domény: `handlerModulePath`
 * dělá `entry.name.split('.')[0]`. Fronta `content.brand_extract` proto patří
 * do `src/content/jobs/queue-handlers.ts`, i když logika extrakce bydlí
 * v `src/brand` (rozhodnutí D15).
 */
// Obsluhy, které potřebují injektované závislosti, se registrují přes
// `needsDependencies`: funkce existují a mají testy, ale továrnu jejich `deps`
// v repu nikdo nedodal, takže se nedají složit. Fronta se zaregistruje a při
// první úloze řekne nahlas, co chybí.
//
// Ostatní obsluhy se obalují `perJob`: pg-boss volá handler s DÁVKOU úloh,
// kdežto tyhle funkce berou jednu. Bez obalu by dostaly pole, sáhly na `.data`
// a dostaly `undefined`. Fronty by se přitom zaregistrovaly a worker naběhl,
// takže by se to poznalo teprve na první skutečně zpracované úloze.
export const handlers = {
  'ai.cleanup_conversations': needsDependencies('ai.cleanup_conversations', 'CleanupDeps'),
} as const;
