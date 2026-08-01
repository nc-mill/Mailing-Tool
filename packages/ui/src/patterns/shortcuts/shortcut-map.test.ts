import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './shortcut-map';

describe('SHORTCUTS', () => {
  it('mapa je jedna pro všechny jazyky, klávesy jsou literály', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.every((key) => typeof key === 'string')).toBe(true);
      // Popis je překladový klíč, klávesa nikdy.
      expect(shortcut.descriptionKey).toMatch(/^common\.shortcuts\./);
    }
  });

  it('obsahuje všechny zkratky z tabulky 4.5', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'search',
        'goOverview',
        'goContacts',
        'goCampaigns',
        'goTemplates',
        'focusSearch',
        'save',
        'submit',
        'close',
        'help',
        'undo',
      ]),
    );
  });

  it('žádné dvě zkratky nemají stejnou kombinaci', () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      const signature = `${shortcut.modifier ?? ''}:${shortcut.keys.join(' ')}`;
      expect(seen.has(signature), `kolize u ${shortcut.id}`).toBe(false);
      seen.add(signature);
    }
  });

  it('názvy kláves zůstávají anglicky', () => {
    const help = SHORTCUTS.find((shortcut) => shortcut.id === 'help');
    expect(help?.keys).toEqual(['?']);
    const save = SHORTCUTS.find((shortcut) => shortcut.id === 'save');
    expect(save?.modifier).toBe('mod');
  });
});
