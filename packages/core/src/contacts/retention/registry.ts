import type { WorkspaceContext } from '../../identity/types';

export const RETENTION_TARGETS = [
  'import_files',
  'import_errors',
  'form_submissions',
  'inbound_deliveries',
  'unconfirmed_subscriptions',
  'inactive_contacts',
  'exports',
] as const;

export type RetentionTarget = (typeof RETENTION_TARGETS)[number];

export type RetentionPolicy = {
  days: number;
  action: 'delete' | 'anonymize';
  enabled: boolean;
};

/** Výchozí hodnoty podle tabulky ve 4.15 části 2. */
export const RETENTION_DEFAULTS: Record<RetentionTarget, RetentionPolicy> = {
  import_files: { days: 30, action: 'delete', enabled: true },
  import_errors: { days: 90, action: 'delete', enabled: true },
  form_submissions: { days: 180, action: 'anonymize', enabled: true },
  inbound_deliveries: { days: 30, action: 'delete', enabled: true },
  unconfirmed_subscriptions: { days: 30, action: 'delete', enabled: true },
  // Vypnuté ve výchozím stavu: je to nevratná operace nad daty, která uživatel
  // roky sbíral, a zapnout ji musí vědomě.
  inactive_contacts: { days: 730, action: 'anonymize', enabled: false },
  exports: { days: 7, action: 'delete', enabled: true },
};

/**
 * Handler dostává KONTEXT PROJEKTU, ne holý handle.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ IZOLACÍ PROJEKTŮ, a je to oprava, ne kosmetika. Plán
 * předával `db: Database`. Všech pět tabulek téhle domény má politiku `ws_isolation`
 * a jedinou tabulkou s `maintenance_bypass` je `web_events` (ověřeno v
 * `packages/db/src/rls.ts`). Dotaz bez nastaveného `mlain.workspace_id` by tedy
 * ovlivnil NULA ŘÁDKŮ A NEVRÁTIL CHYBU: retence osobních údajů by se tiše neprováděla
 * a job by každou noc hlásil úspěch. Retenční běh je navíc per projekt (payload nese
 * `workspaceId` a singletonKey je `workspaceId`), takže kontext je i věcně správně.
 */
export type RetentionHandler = (input: {
  ctx: WorkspaceContext;
  policy: RetentionPolicy;
}) => Promise<{ scanned: number; affected: number }>;

const handlers = new Map<RetentionTarget, RetentionHandler>();

/**
 * Registrace handleru. Existuje proto, že dva ze sedmi cílů (import_files a exports)
 * musí navíc smazat soubor z úložiště, a úložiště zavádí plán P11 spolu s importem
 * a exportem.
 *
 * Chybějící handler znamená, že se cíl v běhu PŘESKOČÍ se zápisem do
 * retention_runs.error_detail, ne že běh spadne. Retence musí doběhnout i tehdy,
 * když jedna její část ještě neexistuje.
 */
export function registerHandler(target: RetentionTarget, handler: RetentionHandler): void {
  handlers.set(target, handler);
}

export function getHandler(target: RetentionTarget): RetentionHandler | undefined {
  return handlers.get(target);
}

/** Jen pro testy: odebere handler, aby šlo ověřit chování běhu bez něj. */
export function unregisterHandler(target: RetentionTarget): void {
  handlers.delete(target);
}
