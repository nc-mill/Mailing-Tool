declare const auditBrand: unique symbol;

/** Branded řetězec, takže do audit logu nejde zapsat neregistrovaný název akce. */
export type AuditAction = string & { readonly [auditBrand]: 'AuditAction' };

/**
 * 3.7: název akce je `<entita>.<sloveso v minulém čase>`, entita v jednotném
 * čísle malými písmeny. Každá část si vlastní názvy svých akcí a zapisuje je do
 * `packages/core/src/<domena>/audit.ts`.
 *
 * Tahle funkce nahrazuje sdílený typový union: kdyby existoval jeden soubor
 * s unionem všech akcí, byl by to sdílený soubor a konflikt v každém plánu
 * (uzávěr S11 řídicího dokumentu). Test audit-actions.test.ts místo toho hlídá
 * jedinečnost napříč doménami mechanicky.
 */
const NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineAuditActions<const T extends readonly string[]>(
  names: T,
): Readonly<{ [K in T[number]]: AuditAction }> {
  const seen = new Set<string>();
  const out: Record<string, AuditAction> = {};

  for (const name of names) {
    if (!name.includes('.')) {
      throw new Error(`Auditní akce "${name}" nemá tvar entita.sloveso (3.7).`);
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error(
        `Auditní akce "${name}" musí být malými písmeny ve tvaru entita.sloveso (3.7).`,
      );
    }
    if (seen.has(name)) throw new Error(`Auditní akce "${name}" je duplicitní.`);
    seen.add(name);
    out[name] = name as AuditAction;
  }

  return Object.freeze(out) as Readonly<{ [K in T[number]]: AuditAction }>;
}
