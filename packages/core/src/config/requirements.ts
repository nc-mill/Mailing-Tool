import type { MlainConfig } from './schema';

/**
 * KTERÁ PROMĚNNÁ JE POVINNÁ PRO KTERÝ PROCES.
 *
 * PROČ TO VZNIKLO. Konfigurace má 183 proměnných a zod z nich vyžaduje tři:
 * `APP_URL`, `DATABASE_URL` a `SECRET_KEY`. Povinnost se ve schématu vyjadřuje
 * absencí `.default()`, což je zápis, který neumí říct „povinná pro workera,
 * nesmyslná pro sender". `MODE` má přitom čtyři hodnoty a celá validace ho
 * používá jen na kolizi portů a na zákaz migrací mimo web. Worker proto projde
 * úplně stejnou kontrolou jako web, přestože potřebuje jiná připojení.
 *
 * NAMĚŘENÝ NÁSLEDEK, 8. 8. 2026. Worker běžel bez `DATABASE_URL_MAINTENANCE`.
 * Nastartoval, ohlásil 59 zaregistrovaných front, health port vrátil `ok`.
 * Za tři minuty spadlo 9 úloh v sedmi cronových frontách a na obrazovce z toho
 * bylo číslo „110 selhaných za 24 h" bez jediného vodítka proč. Naplánovaná
 * kampaň by se v tom stavu neodeslala a nikdo by se to nedozvěděl.
 *
 * TOHLE NENÍ TVRDÁ BRÁNA, JE TO VAROVÁNÍ, a je to vědomé rozhodnutí zadavatele
 * z 8. 8. 2026. Instalace, které dosud běžely bez těch proměnných, se tímhle
 * nerozbijí; jen konečně řeknou, co jim chybí a co kvůli tomu nedělají.
 * Tvrdá brána zůstává v `crossChecks`, kam patří stavy, po kterých se nedá
 * pokračovat vůbec.
 *
 * Go strana dělá tohle už dnes: `apps/sender/internal/config/load.go` odmítne
 * spustit sender bez `DATABASE_URL_SENDER` i bez `TRACKING_DOMAIN` a řekne
 * proč. Tahle tabulka jen srovnává TypeScript s tím, co Go umí.
 */

export type ConfigMode = MlainConfig['MODE'];

export type ConfigRequirement = {
  /** Název proměnné tak, jak se píše do prostředí. */
  readonly variable: string;
  /** Procesy, které bez ní nedělají to, co mají. `all` je spouští všechny. */
  readonly modes: readonly ConfigMode[];
  /** Co se stane, když chybí. Píše se z pohledu uživatele, ne z pohledu kódu. */
  readonly impact: string;
};

/**
 * Do seznamu patří JEN proměnné, u kterých se chybějící hodnota projeví
 * poškozením funkce, ne zhoršením pohodlí. Nesmyslně dlouhý seznam by se choval
 * jako hlášení, které přijde pokaždé: přestane se číst.
 *
 * `DATABASE_URL_MIGRATOR` tu schválně NENÍ. Jeho povinnost je podmíněná
 * (`MIGRATE_ON_START`) a hlídá ji `crossChecks` jako tvrdou chybu, protože bez
 * něj se migrace neprovede a instalace nemá schéma. To je jiná kategorie.
 */
export const CONFIG_REQUIREMENTS: readonly ConfigRequirement[] = [
  {
    variable: 'DATABASE_URL_MAINTENANCE',
    modes: ['worker', 'all'],
    impact:
      'Naplánovaná kampaň se neodešle. Systémové skeny napříč projekty nemají čím číst, ' +
      'protože aplikační role mlain_app pod řádkovou bezpečností bez kontextu projektu ' +
      'nevidí ani řádek a NEOHLÁSÍ to. Bez tohohle připojení neběží plánovač kampaní, ' +
      'hlídač běžících, obnova po vyčerpané kvótě, rekontrola odesílacích domén ani ' +
      'úklid smazaných projektů.',
  },
  {
    variable: 'DATABASE_URL_GDPR',
    modes: ['worker', 'all'],
    impact:
      'Žádost o výmaz podle článku 17 se nevyřídí a zůstane viset. Tabulka souhlasů se smí ' +
      'jen doplňovat: migrace 0006 bere roli mlain_app právo DELETE a migrace 0005 ho dává ' +
      'jedině roli mlain_gdpr. Bez toho připojení se anonymizace kontaktu, tedy výchozí ' +
      'režim výmazu, zruší celá. U produktu na rozesílání e-mailů je to zákonná povinnost ' +
      'se lhůtou, ne nastavení navíc.',
  },
  {
    variable: 'TRACKING_DOMAIN',
    modes: ['sender', 'all'],
    impact:
      'Odesílací služba v Go se bez ní vůbec nespustí a skončí kódem 78. Staví z ní odkazy ' +
      'na měření otevření, kliknutí a na odhlášení, takže bez ní by odešel e-mail, ze ' +
      'kterého se nejde odhlásit. Pozor na tvar: Go chce absolutní adresu se schématem ' +
      '(http:// nebo https://), holý název stroje odmítne.',
  },
];

export type ConfigRequirementState = ConfigRequirement & {
  /**
   * Potřebuje ji proces, který tenhle stav právě čte? Řídí se podle `MODE`.
   *
   * Neplést s `present`. `applies` říká, koho se proměnná týká, `present` říká,
   * jestli má hodnotu, a počítá se VŽDY, i u proměnné, kterou tenhle proces
   * nečte. Obrazovka průvodce na tom stojí: běží ve webu, kde se `MODE=web`,
   * a přesto musí ukázat i to, co potřebuje worker. V dodávané instalaci běží
   * všechny tři procesy v jednom kontejneru se sdíleným prostředím.
   */
  readonly applies: boolean;
  /** Má hodnotu? Počítá se u všech položek, viz `applies` výš. */
  readonly present: boolean;
};

function valueOf(config: MlainConfig, variable: string): unknown {
  return (config as unknown as Record<string, unknown>)[variable];
}

/**
 * Stav VŠECH sledovaných proměnných, i těch, které se tohohle procesu netýkají.
 *
 * Vrací se celý seznam, ne jen problémy, protože obrazovka má ukázat i to, co
 * je v pořádku. „Nic tu není" se čte dvojznačně: jednou jako „všechno sedí",
 * podruhé jako „kontrola neproběhla". Vypsaný zelený řádek tuhle dvojznačnost
 * odstraňuje.
 */
export function configRequirementStates(config: MlainConfig): ConfigRequirementState[] {
  return CONFIG_REQUIREMENTS.map((requirement) => {
    const value = valueOf(config, requirement.variable);
    return {
      ...requirement,
      applies: requirement.modes.includes(config.MODE),
      present: typeof value === 'string' ? value.length > 0 : value !== undefined && value !== null,
    };
  });
}

/** Jen to, co tomuhle procesu chybí. Prázdné pole znamená, že je vše nastavené. */
export function missingConfigRequirements(config: MlainConfig): ConfigRequirementState[] {
  return configRequirementStates(config).filter((state) => state.applies && !state.present);
}
