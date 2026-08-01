import type { LiquidIssue } from '@mlain/contracts/liquid';

/**
 * Nález na dokumentu. Vlastní ho tenhle balíček, protože ho vydává jak
 * validátor dokumentu, tak kompilace, tak předodesílací kontrola.
 *
 * Není to `LiquidIssue` z kontraktů: ten nese `span`, tedy znakovou pozici
 * uvnitř JEDNOHO Liquid výrazu, a o dokumentu nic neví. Tady potřebujeme
 * ukazatel na uzel dokumentu, protože hlášku zobrazuje editor u bloku.
 */
export type Issue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  /** JSON Pointer na uzel dokumentu, například `/blocks/0/children/1/props/alt`. */
  pointer: string;
  /** Tečková cesta pro obálku API. Odvozená z `pointer`, viz `pointerToDotted`. */
  path?: string | undefined;
  // `| undefined` je kvůli exactOptionalPropertyTypes: nálezy se skládají jedním
  // pomocným konstruktorem, kterému volitelné parametry chodí jako undefined.
  params?: Record<string, string | number> | undefined;
};

/**
 * Převod nálezu z Liquid validátoru na nález na dokumentu. `span` se zahazuje
 * schválně: ukazuje do řetězce výrazu, ne do dokumentu, a kdyby se protáhl dál,
 * editor by ho spletl s pozicí v dokumentu.
 */
export function fromLiquidIssue(found: LiquidIssue, pointer: string, path: string): Issue {
  return {
    code: found.code,
    severity: found.severity,
    pointer,
    path,
    params: found.params,
  };
}

export function hasBlockingIssue(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}
