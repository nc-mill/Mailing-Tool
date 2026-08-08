import { describe, expect, it } from 'vitest';
import {
  CONFIG_REQUIREMENTS,
  configRequirementStates,
  missingConfigRequirements,
  type ConfigMode,
} from './requirements';
import { configVariableNames } from './schema';
import type { MlainConfig } from './schema';

function config(mode: ConfigMode, values: Record<string, unknown> = {}): MlainConfig {
  return { MODE: mode, ...values } as unknown as MlainConfig;
}

describe('povinnost podle procesu', () => {
  /**
   * Překlep v názvu by tuhle tabulku proměnil v tichou ozdobu: hledala by se
   * hodnota klíče, který v konfiguraci není, takže by proměnná vyšla vždycky
   * jako chybějící. Hlídá se to proti seznamu, který zná zod, ne proti ručnímu
   * výčtu, aby test nezastaral spolu s tabulkou.
   */
  it('každá jmenovaná proměnná v konfiguraci opravdu existuje', () => {
    const known = new Set(configVariableNames());
    const unknown = CONFIG_REQUIREMENTS.map((r) => r.variable).filter((name) => !known.has(name));
    expect(unknown, 'proměnná v tabulce neexistuje ve schématu konfigurace').toEqual([]);
  });

  it('každý dopad je vysvětlení pro člověka, ne odkaz do kódu', () => {
    for (const requirement of CONFIG_REQUIREMENTS) {
      expect(requirement.impact.length, `${requirement.variable} má krátký dopad`).toBeGreaterThan(
        80,
      );
      expect(requirement.modes.length, `${requirement.variable} nemá žádný proces`).toBeGreaterThan(
        0,
      );
    }
  });

  /**
   * `MODE=all` je dodávaná instalace v jednom kontejneru, tedy ten tvar, který
   * dostane většina lidí. Kdyby se na něj tabulka nevztahovala, hlídala by
   * přesně ty instalace, kde si konfiguraci skládá odborník, a mlčela by
   * u těch, kde ne.
   */
  it('všechno, co platí pro dílčí proces, platí i pro MODE=all', () => {
    for (const requirement of CONFIG_REQUIREMENTS) {
      expect(requirement.modes, `${requirement.variable} vynechává MODE=all`).toContain('all');
    }
  });

  it('worker bez údržbového připojení má chybějící právě tu jednu věc', () => {
    const missing = missingConfigRequirements(
      config('worker', { DATABASE_URL_GDPR: 'postgres://x' }),
    );
    expect(missing.map((state) => state.variable)).toEqual(['DATABASE_URL_MAINTENANCE']);
    expect(missing[0]?.impact).toContain('Naplánovaná kampaň se neodešle');
  });

  /**
   * Sender nečte úlohy napříč projekty ani nemaže souhlasy, takže jeho
   * konfigurace tyhle dvě proměnné mít nemusí. Kdyby je test vyžadoval,
   * naučila by se obsluha varování přeskakovat, a to je horší než mlčení.
   */
  it('sender se neptá na připojení, která nepoužívá, ale na svou doménu ano', () => {
    expect(missingConfigRequirements(config('sender')).map((s) => s.variable)).toEqual([
      'TRACKING_DOMAIN',
    ]);
  });

  it('web sám o sobě nepotřebuje ani jednu z nich', () => {
    expect(missingConfigRequirements(config('web'))).toEqual([]);
  });

  it('prázdný řetězec se počítá jako nevyplněno, ne jako hodnota', () => {
    const missing = missingConfigRequirements(config('all', { DATABASE_URL_MAINTENANCE: '' }));
    expect(missing.map((state) => state.variable)).toContain('DATABASE_URL_MAINTENANCE');
  });

  /**
   * Obrazovka má ukázat i to, co je v pořádku, jinak se „nic tu není" čte
   * dvojznačně: buď je vše nastavené, nebo kontrola vůbec neproběhla.
   */
  it('stav vrací celý seznam včetně toho, co se procesu netýká', () => {
    const states = configRequirementStates(config('web'));
    expect(states).toHaveLength(CONFIG_REQUIREMENTS.length);
    expect(states.every((state) => !state.applies)).toBe(true);
  });
});
