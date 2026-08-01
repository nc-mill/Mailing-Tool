/** Domény podle sedmi částí specifikace. */
export type ErrorDomain = 'platform' | 'contacts' | 'content' | 'campaigns' | 'sender' | 'tracking';

/**
 * `spec` = status i chování jsou ve specifikaci napsané.
 * `derived` = kód je ve specifikaci jmenovaný, ale HTTP status doplnil plán P01
 *             podle pravidel v packages/core/src/errors/registry.ts. Vlastnící
 *             plán ho smí upřesnit, ale musí to udělat změnou plánu P01.
 */
export type CodeSource = 'spec' | 'derived';

/** Kořenové pole `code` v application/problem+json. */
export interface ProblemCodeEntry {
  readonly code: string;
  readonly status: number;
  /** Stabilní anglický text, nezávislý na jazyce klienta (4.2). */
  readonly title: string;
  readonly retryable: boolean;
  /** Sekundy do `retry_after`. Smí být jen u opakovatelných kódů. */
  readonly retryAfterSeconds?: number;
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** `errors[].code` u validation_failed. Nemá vlastní HTTP status. */
export interface ValidationCodeEntry {
  readonly code: string;
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** `findings[].code` s vlastní závažností. */
export interface FindingCodeEntry {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** Klasifikační třída z části 4b, kapitoly 3.12.2 a 4.2. */
export type MessageErrorClass = 'retryable' | 'fatal' | 'permanent' | 'contract';

/** Hodnota sloupce messages.error_code. */
export interface MessageCodeEntry {
  readonly code: string;
  readonly class: MessageErrorClass;
  readonly source: CodeSource;
}

/** Hodnota sloupce import_errors.error_code. */
export interface ImportRowCodeEntry {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly source: CodeSource;
}

/**
 * Šestý jmenný prostor (rozhodnutí R5). Pokrývá dvě věci, které do prvních pěti
 * druhů nepatří a dosud neměly kde být:
 *   scope 'cli'    = kód provozního nebo migračního běhu, nese exit kód CLI
 *   scope 'doctor' = nález `mlain doctor`, nese vlastní závažnost
 *
 * Škála závažnosti je ZÁMĚRNĚ jiná než u FindingCodeEntry: nálezy preflightu
 * kampaně rozhodují o tom, jestli operace projde, takže mají jen error a warning.
 * Nálezy doktoru jsou diagnostika instalace a potřebují i stupeň `info`
 * (například „běží ukázková data"), který o ničem nerozhoduje.
 *
 * Tentýž kód smí být v obou scope. Unikátnost se proto uvnitř tohohle druhu
 * počítá z dvojice scope a kódu, viz registryKey() v registry.ts.
 */
export interface OperationalCodeEntry {
  readonly code: string;
  readonly scope: 'cli' | 'doctor';
  /** Exit kód procesu. Povinný u scope 'cli', zakázaný u 'doctor'. */
  readonly exitCode?: number;
  /** Závažnost nálezu. Povinná u scope 'doctor', zakázaná u 'cli'. */
  readonly severity?: 'critical' | 'warning' | 'info';
  /** Plán, který kód vrací. Registr vlastní P01, chování ne. */
  readonly owner: string;
  readonly source: CodeSource;
}

/** Kód, který specifikace výslovně odmítla zavést. */
export interface RejectedCodeEntry {
  readonly code: string;
  readonly reason: string;
  readonly useInstead: string;
}

export type AnyCodeEntry =
  | ProblemCodeEntry
  | ValidationCodeEntry
  | FindingCodeEntry
  | MessageCodeEntry
  | ImportRowCodeEntry
  | OperationalCodeEntry;
