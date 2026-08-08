import { getTranslations } from 'next-intl/server';
import { configRequirementStates, type MlainConfig } from '@mlain/core/config';
import { Badge } from '@mlain/ui/components/badge';
import { Alert } from '@mlain/ui/patterns/states';

/**
 * STAV KONFIGURACE V PRŮVODCI PRVNÍM SPUŠTĚNÍM.
 *
 * Průvodce dosud konfiguraci jen ČETL a ke stavu mlčel. Člověk tak instalaci
 * dokončil, uviděl prázdnou aplikaci a nedozvěděl se, že mu chybí připojení,
 * bez kterého se naplánovaná kampaň nikdy neodešle. Zjistil to teprve podle
 * čísla „110 selhaných úloh za 24 h" na obrazovce, ze kterého se příčina
 * nedala poznat vůbec.
 *
 * TENHLE PANEL NENÍ BRÁNA. Chybějící položka nesmí zabránit dokončení
 * průvodce, je to varování (rozhodnutí zadavatele z 8. 8. 2026). Instalace,
 * které dosud běžely s neúplnou konfigurací, musí jít nastavit dál; jen se
 * konečně dozvědí, co jim chybí a co kvůli tomu nedělají.
 *
 * VYKRESLUJE SE NA SERVERU a ven z něj jde jen NÁZEV proměnné, příznak
 * chybí/je, a text dopadu. **Hodnota proměnné se do prohlížeče nesmí dostat
 * nikdy**, jsou v nich hesla k databázi. Hlídá to `configStatusItems`, které
 * ze stavu vybírá pole jmenovitě, nikoliv rozbalením celého objektu.
 */

export type ConfigStatusItem = {
  /** Název proměnné tak, jak se píše do `.env`. Nikdy ne její hodnota. */
  readonly variable: string;
  /** Týká se tohohle procesu? Řídí se podle `MODE`. */
  readonly applies: boolean;
  /** Má hodnotu? Jen ano/ne, samotná hodnota tudy neprochází. */
  readonly present: boolean;
  /** Co se stane, když chybí. Záloha pro případ, že překlad ještě není. */
  readonly impact: string;
  /** Procesy, které proměnnou potřebují. */
  readonly modes: readonly string[];
};

/**
 * Převod stavu z `@mlain/core/config` na to, co smí odejít do prohlížeče.
 *
 * Pole se vypisují JMENOVITĚ. Rozbalení (`...state`) by sem dnes propustilo
 * jen ta samá pole, ale první nové pole v `ConfigRequirementState` by odešlo
 * s ním, a kdyby to někdy byla hodnota, nikdo by si toho nevšiml.
 */
export function configStatusItems(config: MlainConfig): ConfigStatusItem[] {
  return configRequirementStates(config).map((state) => ({
    variable: state.variable,
    applies: state.applies,
    present: state.present,
    impact: state.impact,
    modes: state.modes,
  }));
}

type ItemStatus = 'missing' | 'present';

/**
 * PANEL UKAZUJE STAV INSTALACE, NE STAV PROCESU, a je to oprava naměřená
 * 8. 8. 2026 na skutečné obrazovce.
 *
 * Napřed se tu stav odvozoval podle `MODE`: co tenhle proces nepoužívá, se
 * vypsalo jako „tady se nepoužívá" a nekontrolovalo se. Web ale běží s
 * `MODE=web` a všechny tři sledované proměnné potřebuje worker nebo sender,
 * takže průvodce u VŠECH TŘÍ napsal, že je nekontroluje, a člověk se z něj
 * nedozvěděl vůbec nic. Přesně ta obrazovka, kterou má tenhle panel nahradit.
 *
 * Hodnota se proto čte vždycky. V dodávané instalaci běží web, fronty i
 * odesílání v jednom kontejneru se sdíleným prostředím, takže co vidí web,
 * vidí i worker. U rozdělené instalace to nemusí platit, a právě proto se
 * u každé položky píše, který proces ji potřebuje, i upozornění, že když ten
 * proces běží jinde, patří ověření tam. Planý zelený řádek je horší než
 * varování, které si obsluha ověří a odbude.
 */
function statusOf(item: ConfigStatusItem): ItemStatus {
  return item.present ? 'present' : 'missing';
}

/** Problémy nahoru. Zelené řádky zůstávají, jen nepřekáží v cestě k tomu, co chybí. */
const ORDER: Record<ItemStatus, number> = { missing: 0, present: 1 };

const TONE: Record<ItemStatus, 'success' | 'warning'> = {
  missing: 'warning',
  present: 'success',
};

export type ConfigStatusProps = {
  /**
   * `null` znamená, že se konfigurace nedala přečíst. To NENÍ totéž co „vše je
   * v pořádku" a panel to tak taky napíše.
   */
  items: readonly ConfigStatusItem[] | null;
};

export async function ConfigStatus({ items }: ConfigStatusProps) {
  const t = await getTranslations('auth');

  /* Překlad dopadu je zdroj pravdy pro text na obrazovce. Když u nové položky
     ještě není, vypíše se český text z tabulky v jádře. Prázdný řádek by byl
     horší než neanglicky napsaná věta. */
  const impactOf = (item: ConfigStatusItem): string => {
    const key = `setup.config.impact.${item.variable}`;
    return t.has(key) ? t(key) : item.impact;
  };

  /* `all` je instalace v jednom kontejneru, tedy „všechny procesy". Ve výčtu
     procesů, které proměnnou potřebují, by vedle „fronty" stálo ještě jednou
     totéž jinými slovy. */
  const processesOf = (item: ConfigStatusItem): string =>
    item.modes
      .filter((mode) => mode !== 'all')
      .map((mode) => (t.has(`setup.config.modes.${mode}`) ? t(`setup.config.modes.${mode}`) : mode))
      .join(', ');

  const sorted =
    items === null ? [] : [...items].sort((a, b) => ORDER[statusOf(a)] - ORDER[statusOf(b)]);
  const missing = sorted.filter((item) => statusOf(item) === 'missing');

  const summary: 'unavailable' | 'someMissing' | 'allSet' =
    items === null ? 'unavailable' : missing.length > 0 ? 'someMissing' : 'allSet';

  return (
    <section
      aria-labelledby="setup-config-status"
      className="flex flex-col gap-[var(--spacing-stack)]"
    >
      <h2 id="setup-config-status" className="text-ui font-semibold text-text">
        {t('setup.config.title')}
      </h2>

      {summary === 'unavailable' ? (
        <Alert tone="warning">{t('setup.config.unavailable')}</Alert>
      ) : (
        <>
          <Alert tone={summary === 'allSet' ? 'success' : 'warning'}>
            <p>
              {summary === 'someMissing'
                ? t('setup.config.someMissing', { count: missing.length })
                : t(`setup.config.${summary}`)}
            </p>
            {summary === 'someMissing' ? (
              <p className="mt-1">{t('setup.config.stillWorks')}</p>
            ) : null}
          </Alert>

          <ul className="flex flex-col gap-[var(--spacing-stack)]">
            {sorted.map((item) => {
              const status = statusOf(item);
              return (
                <li
                  key={item.variable}
                  className="flex flex-col gap-[var(--spacing-hairline)]"
                  data-status={status}
                >
                  <div className="flex flex-wrap items-center gap-[var(--spacing-inline)]">
                    <Badge tone={TONE[status]}>{t(`setup.config.status.${status}`)}</Badge>
                    <span className="font-mono text-meta break-all text-text">{item.variable}</span>
                  </div>
                  {status === 'missing' ? (
                    <p className="text-meta text-text-muted">{impactOf(item)}</p>
                  ) : null}
                  {/* Který proces ji potřebuje, se píše VŽDY, u chybějící i u
                      vyplněné. U chybějící je to návod, kde se to projeví,
                      u vyplněné je to odpověď na otázku, k čemu vlastně je. */}
                  <p className="text-meta text-text-muted">
                    {t(status === 'missing' ? 'setup.config.neededBy' : 'setup.config.usedBy', {
                      processes: processesOf(item),
                    })}
                  </p>
                </li>
              );
            })}
          </ul>

          <p className="text-meta text-text-muted">{t('setup.config.envHint')}</p>
        </>
      )}
    </section>
  );
}
