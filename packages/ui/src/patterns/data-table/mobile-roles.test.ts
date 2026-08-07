import { describe, expect, it } from 'vitest';
import { mobileRoles } from './mobile-roles';

const ids = (columns: string[]) => columns.map((id) => ({ id }));

describe('mobileRoles', () => {
  it('první sloupec je hlavní údaj, nabídka řádku se pozná podle id', () => {
    const roles = mobileRoles(ids(['email', 'name', 'actions']));

    expect(roles['email']).toBe('primary');
    expect(roles['name']).toBe('secondary');
    expect(roles['actions']).toBe('actions');
  });

  it('bere i starší tvar `action`, protože obě podoby v repozitáři jsou', () => {
    expect(mobileRoles(ids(['email', 'action']))['action']).toBe('actions');
  });

  /**
   * Kontakty mají devět sloupců. Bez stropu by karta na 390 px nesla devět
   * údajů pod sebou a nepřečetl by se ani jeden.
   */
  it('nad tři doplňkové údaje se zbytek na kartě nekreslí', () => {
    const roles = mobileRoles(
      ids([
        'email',
        'name',
        'greeting',
        'status',
        'confirm',
        'lists',
        'tags',
        'createdAt',
        'actions',
      ]),
    );

    expect(roles['email']).toBe('primary');
    expect([roles['name'], roles['greeting'], roles['status']]).toEqual([
      'secondary',
      'secondary',
      'secondary',
    ]);
    for (const id of ['confirm', 'lists', 'tags', 'createdAt']) {
      expect(roles[id]).toBe('hidden');
    }
    // Nabídka řádku zůstává dosažitelná i jako devátý sloupec. Je to jediná
    // cesta k akcím řádku, takže se schovat nesmí ani ve stropu.
    expect(roles['actions']).toBe('actions');
  });

  it('volba obrazovky přebíjí výpočet a nezapočítá se do stropu dvakrát', () => {
    const roles = mobileRoles([
      { id: 'email' },
      { id: 'name', mobile: 'primary' },
      { id: 'status' },
      { id: 'lists' },
      { id: 'tags' },
      { id: 'createdAt', mobile: 'secondary' },
    ]);

    expect(roles['name']).toBe('primary');
    // `email` už hlavní být nemůže, obrazovka si vybrala jiný sloupec.
    expect(roles['email']).toBe('secondary');
    // Strop je tři a `createdAt` si jedno místo vzal předem, takže na dopočet
    // zbyla dvě: vezme je `email` a `status`, na zbytek karta místo nemá.
    expect(roles['status']).toBe('secondary');
    expect(roles['lists']).toBe('hidden');
    expect(roles['tags']).toBe('hidden');
  });

  it('sloupce, které si uživatel schoval, se do výpočtu vůbec nedostanou', () => {
    // Vstupem je pořadí VIDITELNÝCH sloupců. Kdyby se počítalo ze všech,
    // stal by se hlavním údajem sloupec, který na obrazovce není.
    const roles = mobileRoles(ids(['name', 'status']));

    expect(roles['name']).toBe('primary');
    expect(Object.keys(roles)).toHaveLength(2);
  });
});
