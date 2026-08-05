import { defineAuditActions } from '../audit/action';

/**
 * Auditní akce domény značky. Tvar `<entita>.<sloveso v minulém čase>` z 3.7,
 * jedinečnost napříč doménami hlídá `audit/audit-actions.test.ts`.
 *
 * PROČ SE AUDITUJE ŽÁDOST O EXTRAKCI. Je to jediná operace v produktu, která
 * na pokyn uživatele pošle požadavek na CIZÍ server, který si uživatel vybral.
 * Zbytkové riziko binárního orákula (útočník pozná, jestli na dané adrese něco
 * běží) se nedá odstranit úplně, jen zmírnit, a jedno ze tří přiznaných
 * zmírnění je právě to, že každý pokus nese jméno toho, kdo ho zadal.
 * Rozhodl tak návrh domény značky; `requestExtraction` audit volá vždy.
 */
export const BRAND_AUDIT_ACTIONS = ['brand_extraction.requested'] as const;

export type BrandAuditAction = (typeof BRAND_AUDIT_ACTIONS)[number];

export const BrandAuditActions = defineAuditActions(BRAND_AUDIT_ACTIONS);
