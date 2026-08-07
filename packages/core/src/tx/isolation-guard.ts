/**
 * Startovní kontrola, že izolace projektů opravdu platí.
 *
 * PROČ TENHLE SOUBOR VZNIKL. Predikát `checkIsolationPrerequisites` v P03
 * existoval od začátku a jeho hlavička říkala „volá se při startu aplikace
 * (P04) a z `mlain doctor` (P16)". Volal ho ale JEN doctor. V `apps/web`
 * ani v `apps/worker` nebyl jediný výskyt, takže samohostitel s jedinou
 * databázovou rolí (typicky vlastník databáze u spravovaného Postgresu, nebo
 * rovnou superuživatel) dostal aplikaci, která se rozeběhne úplně normálně,
 * jen bez izolace mezi projekty. Nic neselhalo, v logu nebylo nic a dozvěděl
 * se to jedině tehdy, když sám spustil kontrolu, o které nemusel vědět.
 *
 * PROČ SE NESTARTUJE HLASITÝM PÁDEM. Instalace s jediným projektem, která
 * běží pod vlastníkem databáze, je dnes funkční a chybějící izolace jí nic
 * neodnese: cizí projekt, ze kterého by data unikla, neexistuje. Odmítnout
 * start by takové instalaci sebral produkt kvůli riziku, které u ní nenastane.
 * Doctor to proto hlásí jako kritickou vadu s návodem, tenhle soubor to hlásí
 * při KAŽDÉM startu do logu a v readiness, a rozhodnutí zůstává na
 * provozovateli. Tichá ztráta bezpečnostní vlastnosti tím končí, protože
 * o ní od teď mluví tři místa místo nuly.
 *
 * Znění důvodů se tu NEOPISUJE. Vlastní ho `checkIsolationPrerequisites`
 * v P03, aby existoval jediný popis toho, co izolaci ruší.
 */
import { checkIsolationPrerequisites } from '@mlain/db';
import type { Check } from '../health/types';
import type { Logger } from '../logging/logger';
import { appPool } from './index';

/**
 * Výsledek se memoizuje. Role, pod kterou proces běží, se za jeho života
 * nemění, takže druhý dotaz by vrátil totéž. Readiness se ptá při každém
 * requestu a bez memoizace by to byl dotaz do katalogu na každý sken
 * orchestrátoru.
 */
let cached: Promise<string[]> | null = null;

/** Jen pro testy, které si mezi případy přepínají roli spojení. */
export function resetIsolationGuardCache(): void {
  cached = null;
  logged = false;
}

/** Důvody, proč izolace neplatí. Prázdné pole znamená, že je všechno v pořádku. */
export function isolationReasons(): Promise<string[]> {
  cached ??= checkIsolationPrerequisites(appPool());
  return cached;
}

let logged = false;

/**
 * Hlasité hlášení při startu. Volá se z kompozičních kořenů webu i workeru,
 * takže smí být zavolané víckrát za proces bez toho, aby log zdvojilo.
 *
 * Nikdy nevyhazuje: selhání dotazu do katalogu (databáze ještě nenaběhla) je
 * chyba spojení, ne důkaz o izolaci, a start kvůli němu padnout nesmí.
 * Vrací počet nalezených důvodů, aby to šlo otestovat bez čtení logu, a −1,
 * když se kontrola nedala provést.
 */
export async function warnIfIsolationBroken(logger: Logger): Promise<number> {
  let reasons: string[];
  try {
    reasons = await isolationReasons();
  } catch (error) {
    cached = null;
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      'Kontrolu izolace projektů se při startu nepodařilo provést. Není to důkaz, ' +
        'že izolace platí; spusťte `mlain doctor`, až bude databáze dostupná.',
    );
    return -1;
  }

  if (reasons.length === 0) return 0;
  if (logged) return reasons.length;
  logged = true;

  logger.error(
    { reasons, check: 'isolation_prerequisites_missing' },
    `PROJEKTY NEJSOU IZOLOVANÉ, přestože aplikace běží normálně: ${reasons.join('; ')}. ` +
      'Politiky RLS se na takovou roli neuplatní, takže dotaz jednoho projektu vrátí ' +
      'i data ostatních. Spusťte aplikaci pod rolí mlain_app, která nevlastní schéma ' +
      'a nemá BYPASSRLS. U spravované databáze s jedinou rolí izolace neplatí a víc ' +
      'projektů v jedné instalaci není bezpečné provozovat. Podrobnosti: mlain doctor.',
  );
  return reasons.length;
}

/**
 * Tentýž nález v readiness. Status je `warn`, ne `fail`, ze stejného důvodu,
 * proč start nepadá: sražená readiness by instalaci s jedním projektem uvrhla
 * do restartové smyčky. `warn` readiness nesráží, ale zůstane vidět v odpovědi
 * `/api/health/ready` napořád, takže se na to dá narazit i bez čtení logu.
 */
export function isolationCheck(): Check {
  return async () => {
    let reasons: string[];
    try {
      reasons = await isolationReasons();
    } catch {
      cached = null;
      return { name: 'isolation', status: 'skip', detail: 'isolation_check_unavailable' };
    }
    if (reasons.length === 0) return { name: 'isolation', status: 'ok' };
    return {
      name: 'isolation',
      status: 'warn',
      detail: `isolation_prerequisites_missing: ${reasons.join('; ')}`,
    };
  };
}
