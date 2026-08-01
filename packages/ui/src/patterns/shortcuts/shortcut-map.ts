/**
 * Mapa `zkratka → akce`. Jeden soubor bez závislosti na jazyku.
 *
 * Klávesa je konstanta v kódu, překladový katalog do ní nesahá.
 * Lokalizuje se jen popis v nápovědě (`descriptionKey`).
 *
 * Mnemotechnika `g k` (kontakty) dává smysl jen česky, a to je v pořádku:
 * zkratky se učí opakováním, ne odvozováním, a dvě mapy kláves
 * by uživatele přepínajícího jazyk připravily o svalovou paměť.
 */
export type Shortcut = {
  id: string;
  /** Posloupnost kláves. Delší než jedna znamená sekvenci, například `g` pak `k`. */
  keys: string[];
  /** `mod` je Ctrl na Windows a Linuxu, Cmd na macOS. */
  modifier?: 'mod' | 'alt';
  descriptionKey: string;
  /** Zkratka funguje i tehdy, když je fokus v textovém poli. */
  worksInInput?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  {
    id: 'search',
    keys: ['k'],
    modifier: 'mod',
    descriptionKey: 'common.shortcuts.search',
    worksInInput: true,
  },
  { id: 'goOverview', keys: ['g', 'p'], descriptionKey: 'common.shortcuts.goOverview' },
  { id: 'goContacts', keys: ['g', 'k'], descriptionKey: 'common.shortcuts.goContacts' },
  { id: 'goCampaigns', keys: ['g', 'c'], descriptionKey: 'common.shortcuts.goCampaigns' },
  { id: 'goTemplates', keys: ['g', 's'], descriptionKey: 'common.shortcuts.goTemplates' },
  { id: 'focusSearch', keys: ['/'], descriptionKey: 'common.shortcuts.focusSearch' },
  {
    id: 'save',
    keys: ['s'],
    modifier: 'mod',
    descriptionKey: 'common.shortcuts.save',
    worksInInput: true,
  },
  {
    id: 'submit',
    keys: ['Enter'],
    modifier: 'mod',
    descriptionKey: 'common.shortcuts.submit',
    worksInInput: true,
  },
  { id: 'close', keys: ['Escape'], descriptionKey: 'common.shortcuts.close', worksInInput: true },
  { id: 'help', keys: ['?'], descriptionKey: 'common.shortcuts.help' },
  {
    id: 'undo',
    keys: ['z'],
    modifier: 'alt',
    descriptionKey: 'common.shortcuts.undo',
    worksInInput: true,
  },
];

/** Zkratky tabulky, které obsluhuje sama komponenta K1, ne globální posluchač. */
export const TABLE_SHORTCUT_KEYS = ['j', 'k', 'x', ' '] as const;
