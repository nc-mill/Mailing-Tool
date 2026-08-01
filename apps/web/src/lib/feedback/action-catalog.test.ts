import { describe, expect, it } from 'vitest';
import { ACTION_CATALOG, CHANNEL_BY_CLASS, type ActionName } from './action-catalog';

describe('katalog akcí, kritérium 1 kapitoly 15.1 části 6', () => {
  it('kanál každé akce odpovídá její třídě podle tabulky 5.2', () => {
    for (const [name, descriptor] of Object.entries(ACTION_CATALOG)) {
      expect(descriptor.channel, `akce ${name}`).toBe(CHANNEL_BY_CLASS[descriptor.class]);
    }
  });

  // Moduly akcí vznikají až v úkolech 12 až 31. Plán to říká výslovně
  // v kroku 7 úkolu 5: „Test katalogu zatím padá na neexistujících modulech
  // akcí. Pouští se poprvé v úkolu 37." Značka `skip` je jediný způsob, jak
  // to zapsat do kódu; v úkolu 37 se odstraní.
  it.skip('každá akce z katalogu je opravdu exportovaná ze svého modulu', async () => {
    const names = Object.keys(ACTION_CATALOG) as ActionName[];
    for (const name of names) {
      const descriptor = ACTION_CATALOG[name];
      const loaded: Record<string, unknown> = await import(`../../${descriptor.module}`);
      expect(typeof loaded[name], `${descriptor.module} neexportuje ${name}`).toBe('function');
    }
  });

  it('destruktivní akce mají úroveň ochrany aspoň N2', () => {
    const destructive: ActionName[] = [
      'deleteWorkspaceAction',
      'removeMemberAction',
      'rotateApiKeyAction',
      'revokeApiKeyAction',
      'deleteWebhookAction',
      'logoutAllAction',
    ];
    for (const name of destructive) {
      expect(ACTION_CATALOG[name].risk, `akce ${name}`).not.toBe('N1');
    }
  });

  it('smazání projektu je jediná akce úrovně N4', () => {
    const n4 = Object.entries(ACTION_CATALOG)
      .filter(([, descriptor]) => descriptor.risk === 'N4')
      .map(([name]) => name);
    expect(n4).toEqual(['deleteWorkspaceAction']);
  });
});
