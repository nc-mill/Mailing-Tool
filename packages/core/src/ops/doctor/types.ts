export type DoctorSeverity = 'critical' | 'warning' | 'info';

export type DoctorFinding = {
  /** Stabilní identifikátor nálezu, podle kterého se dá hledat v dokumentaci. */
  id: string;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  /** Co má provozovatel udělat. Prázdné jen u čistě informativních nálezů. */
  action: string;
};

export type DoctorContext = {
  /**
   * URL APLIKAČNÍ role. Používá se výhradně tam, kde je aplikační role sama
   * předmětem kontroly: rozpočet spojení a předpoklady izolace. **Nikdy se
   * z ní nečtou data.** Politika `ws_isolation` filtruje podle
   * `mlain.workspace_id`, který diagnostika nenastavuje a nastavit nemůže,
   * takže by každý dotaz vrátil nula řádků, exit 0 a žádnou chybu.
   */
  appUrl: string;
  /**
   * URL MIGRÁTORA, tedy `DATABASE_URL_MIGRATOR`. Jediná cesta, kterou smí
   * diagnostika číst data napříč projekty. Když chybí, kontrola, která ji
   * potřebuje, vrátí `check_failed`, ne prázdný seznam.
   */
  adminUrl: string | null;
  dataDir: string;
  backupDir: string;
  uploadsDir: string;
  secretKey: string;
  secretKeyPrevious: string;
  imageVersion: string;
  now: Date;
};

export type DoctorCheck = (ctx: DoctorContext) => Promise<DoctorFinding[]>;

/**
 * Nález pro kontrolu, která neměla jak proběhnout.
 *
 * Existuje proto, že mlčení a „vše v pořádku" vypadají v tomhle nástroji
 * úplně stejně. Kontrola, která nemá `DATABASE_URL_MIGRATOR`, nesmí vrátit
 * prázdný seznam: provozovatel by z výstupu četl, že mu nechybí žádné
 * pokolení klíče, přestože se ho nikdo nezeptal.
 *
 * Kód `check_failed` je v registru P01 se závažností `warning`.
 */
export function cannotRun(what: string, reason: string): DoctorFinding {
  return {
    id: 'check_failed',
    severity: 'warning',
    title: `Kontrolu „${what}" nešlo provést`,
    detail: `${reason} Výsledek téhle kontroly proto NENÍ „v pořádku", ale „nezjištěno".`,
    action:
      'Nastavte DATABASE_URL_MIGRATOR a spusťte mlain doctor znovu. Bez migrátora se ' +
      'data napříč projekty přečíst nedají, protože na aplikační roli platí row level security.',
  };
}

export const SEVERITY_ORDER: Record<DoctorSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
