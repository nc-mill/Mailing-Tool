import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { StepFileCheck } from '../../src/features/import/step-file-check';
import { StepPreview } from '../../src/features/import/step-preview';
import { StepOptions } from '../../src/features/import/step-options';
import { StepMapping, fieldKeyFrom } from '../../src/features/import/step-mapping';
import { renderIntl } from '../helpers/intl';

const cp1250Preview = () => ({
  encoding: 'windows-1250',
  delimiter: ';',
  hasHeader: true,
  totalRows: 4,
  sample: [
    ['email', 'jmeno', 'mesto'],
    ['jana@firma.cz', 'Jana Nováková', 'Břeclav'],
    ['petr@firma.cz', 'Petr Novák', 'Praha'],
  ],
});

describe('file check step', () => {
  /**
   * jsdom nezná Pointer Capture ani `scrollIntoView`, na kterých Radix Select
   * stojí. Bez těchhle náhrad se rozbalovátko v testu neotevře a chyba vypadá
   * jako vada komponenty, přestože v prohlížeči funguje.
   */
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
  });

  it('shows undamaged diacritics for a windows-1250 file and asks for confirmation', () => {
    renderIntl(<StepFileCheck preview={cp1250Preview()} onRecheck={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
    expect(screen.getByText('Břeclav')).toBeInTheDocument();
    expect(screen.getByText(/vypadají jména a města správně/i)).toBeInTheDocument();
  });

  it('subtracts the header from the contact count and shows both numbers', () => {
    renderIntl(
      <StepFileCheck
        preview={{ ...cp1250Preview(), totalRows: 12_480, hasHeader: true }}
        onRecheck={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const line = screen.getByText(/z toho 1 hlavička/i);
    expect(line.textContent).toMatch(/12\s?480/);
    expect(line.textContent).toMatch(/12\s?479/);
  });

  it('offers the other supported encodings when the user says it is garbled', async () => {
    renderIntl(<StepFileCheck preview={cp1250Preview()} onRecheck={vi.fn()} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /je to rozsypané/i }));
    // Nabízí se všechna kódování, která server umí přečíst, kromě toho současného.
    expect(screen.getByRole('button', { name: 'UTF-8' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ISO-8859-2' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Windows-1250/ })).toBeNull();
  });

  /**
   * Tohle je jádro celého kroku a do 5. 8. 2026 to nefungovalo: volba jiného
   * kódování se jen zapsala do stavu a ukázka nad ní zůstala rozsypaná, takže
   * odpověď „ne, je to rozsypané" nevedla k ničemu viditelnému.
   */
  it('reads the file again right after the encoding changes', async () => {
    const onRecheck = vi.fn().mockResolvedValue(undefined);
    renderIntl(
      <StepFileCheck preview={cp1250Preview()} onRecheck={onRecheck} onConfirm={vi.fn()} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /je to rozsypané/i }));
    await userEvent.click(screen.getByRole('button', { name: 'ISO-8859-2' }));

    expect(onRecheck).toHaveBeenCalledWith({ encoding: 'iso-8859-2', delimiter: ';' });
  });

  it('says why the delimiter has to be picked by hand when detection failed', () => {
    renderIntl(
      <StepFileCheck
        preview={{ ...cp1250Preview(), error: 'delimiter_not_detected' as const }}
        onRecheck={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/vyberte oddělovač ručně/i);
  });

  it('reports the manually chosen encoding, not the detected one', async () => {
    const onConfirm = vi.fn();
    renderIntl(
      <StepFileCheck
        preview={cp1250Preview()}
        onRecheck={vi.fn().mockResolvedValue(undefined)}
        onConfirm={onConfirm}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /je to rozsypané/i }));
    await userEvent.click(screen.getByRole('button', { name: 'ISO-8859-2' }));
    await userEvent.click(screen.getByRole('button', { name: /^pokračovat$/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ encoding: 'iso-8859-2' }));
  });
});

const previewRows = () => ({
  rows: [
    {
      rowNumber: 2,
      email: 'jana@firma.cz',
      titlePrefix: null,
      firstName: 'Jana',
      lastName: 'Nováková',
      gender: 'female',
      greeting: 'Dobrý den, Jano',
      state: 'ok' as const,
    },
    {
      rowNumber: 3,
      email: 'pavel@firma.cz',
      titlePrefix: 'Ing.',
      firstName: 'Pavel',
      lastName: 'Novák',
      gender: 'male',
      greeting: 'Dobrý den, Pavle',
      state: 'ok' as const,
    },
    {
      rowNumber: 4,
      email: 'nguyen@firma.cz',
      titlePrefix: null,
      firstName: 'Nguyen',
      lastName: 'Van',
      gender: null,
      greeting: 'Dobrý den',
      state: 'ok' as const,
    },
    {
      rowNumber: 5,
      email: 'blocked@x.cz',
      titlePrefix: null,
      firstName: 'Karel',
      lastName: 'Blok',
      gender: 'male',
      greeting: 'Dobrý den, Karle',
      state: 'suppressed' as const,
    },
    {
      rowNumber: 6,
      email: 'jana@@firma.cz',
      titlePrefix: null,
      firstName: null,
      lastName: null,
      gender: null,
      greeting: null,
      state: 'error' as const,
    },
  ],
});

const estimate = () => ({
  totalRows: 5,
  shown: 5,
  reviewRows: 143,
  noEmailRows: 0,
  duplicateRows: 0,
  approximate: false,
});

describe('preview step', () => {
  it('shows the resulting greeting for every row', () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    expect(screen.getByText('Dobrý den, Jano')).toBeInTheDocument();
    expect(screen.getByText('Dobrý den, Pavle')).toBeInTheDocument();
  });

  it('shows the fallback without a name for an undetermined gender', () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    const row = screen.getByText('Nguyen').closest('tr');
    expect(within(row!).getByText('Dobrý den')).toBeInTheDocument();
    expect(within(row!).getByText('?')).toBeInTheDocument();
  });

  it('splits Ing. Pavel Novák into title, first name and last name', () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    const row = screen.getByText('Pavel').closest('tr');
    expect(within(row!).getByText('Ing.')).toBeInTheDocument();
    expect(within(row!).getByText('Novák')).toBeInTheDocument();
    expect(within(row!).getByText('Dobrý den, Pavle')).toBeInTheDocument();
  });

  it('promises never to guess wrong, only neutrally', () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    expect(
      screen.getByText(/oslovíme neutrálně .Dobrý den. bez jména, nikdy ne špatně/i),
    ).toBeInTheDocument();
  });

  /**
   * Projekt, který oslovení a 5. pád neřeší, nemá v náhledu co ukazovat: sloupec
   * „Oslovení" ani věta o nejistém 5. pádu nikam nevedou, protože obrazovka
   * kontroly 5. pádu v takovém projektu vrací 404.
   *
   * Ověřeno i v prohlížeči, v obou polohách přepínače: se zapnutým oslovením má
   * náhled hlavičky „E-mail, Titul, Jméno, Rod, Příjmení, Oslovení", s vypnutým
   * tutéž řadu bez posledního sloupce.
   */
  it('hides the greeting column when the project does not do greetings', () => {
    renderIntl(
      <StepPreview
        preview={previewRows()}
        estimate={estimate()}
        onNext={vi.fn()}
        greetingEnabled={false}
      />,
    );
    expect(screen.queryByRole('columnheader', { name: 'Oslovení' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dobrý den, Jano')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/oslovíme neutrálně .Dobrý den. bez jména, nikdy ne špatně/i),
    ).not.toBeInTheDocument();
    // Jméno, příjmení i rod zůstávají: rod není 5. pád ani oslovení.
    expect(screen.getByRole('columnheader', { name: 'Rod' })).toBeInTheDocument();
    expect(screen.getByText('Pavel')).toBeInTheDocument();
  });

  it('marks failing rows and suppressed rows differently', () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    expect(screen.getByText('jana@@firma.cz').closest('tr')).toHaveAttribute('data-state', 'error');
    expect(screen.getByText('blocked@x.cz').closest('tr')).toHaveAttribute(
      'data-state',
      'suppressed',
    );
  });

  it('offers the name splitting controls behind a disclosure', async () => {
    renderIntl(<StepPreview preview={previewRows()} estimate={estimate()} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /jméno se dělí špatně/i }));
    expect(screen.getByRole('radio', { name: /příjmení jméno/i })).toBeInTheDocument();
  });

  it('marks an extrapolated estimate as approximate', () => {
    renderIntl(
      <StepPreview
        preview={previewRows()}
        estimate={{ ...estimate(), approximate: true }}
        onNext={vi.fn()}
      />,
    );
    expect(screen.getByText(/přibližně/i)).toBeInTheDocument();
  });
});

describe('options step', () => {
  const base = { totalRows: 100, errorRows: 0, duplicates: 0 };
  const LIST_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a384';

  /**
   * jsdom nezná Pointer Capture ani `scrollIntoView`, na kterých Radix Select
   * stojí. Bez těchhle náhrad se rozbalovátko v testu neotevře a chyba vypadá
   * jako vada komponenty, přestože v prohlížeči funguje.
   */
  beforeAll(() => {
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.setPointerCapture = () => undefined;
    Element.prototype.releasePointerCapture = () => undefined;
    Element.prototype.scrollIntoView = () => undefined;
  });

  async function chooseList(name: string): Promise<void> {
    await userEvent.click(screen.getByRole('combobox', { name: /zařadit do seznamu/i }));
    await userEvent.click(await screen.findByRole('option', { name }));
  }

  it('describes conflict handling by sentence, not by name, and defaults to update', () => {
    renderIntl(
      <StepOptions estimate={base} lists={[]} onCreateList={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByRole('radio', { name: /doplnit/i })).toBeChecked();
    expect(
      screen.getByText(/přidáme, co chybí. co už máme vyplněné, nepřepíšeme/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/merge|upsert/i)).toBeNull();
  });

  it('puts the real number on the submit button', () => {
    renderIntl(
      <StepOptions
        estimate={{ totalRows: 12_479, errorRows: 6, duplicates: 12 }}
        lists={[]}
        onCreateList={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /naimportovat/i });
    expect(button.textContent).toMatch(/12\s?461/);
  });

  it('prefills a dated tag so the import can be found later', () => {
    renderIntl(
      <StepOptions
        estimate={base}
        lists={[]}
        onCreateList={vi.fn()}
        onSubmit={vi.fn()}
        today={new Date('2026-08-01T10:00:00Z')}
      />,
    );
    expect(screen.getByLabelText(/štítek/i)).toHaveValue('import-2026-08-01');
  });

  /**
   * Prohlášení u seznamu s dvojím potvrzením se nesmí dát obejít. Dřív se to
   * hlídalo atributem `required` na zaškrtávátku, jenže krok není `<form>`,
   * takže prohlížeč neměl co vynucovat a volby odešly bez prohlášení; server
   * je pak odmítl 422 a uživatel četl „Náhled se nepodařilo načíst". Test proto
   * měří CHOVÁNÍ: krok se nehne dál a řekne proč.
   */
  it('requires the declaration before confirmed subscription on a double opt-in list', async () => {
    const onSubmit = vi.fn();
    renderIntl(
      <StepOptions
        estimate={base}
        lists={[{ id: LIST_ID, name: 'Zákazníci', optIn: 'double' }]}
        onCreateList={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await chooseList('Zákazníci');
    await userEvent.click(screen.getByRole('radio', { name: /potvrzené/i }));
    await userEvent.click(screen.getByRole('button', { name: /naimportovat/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/prohlášení/i);
  });

  /** Kontakt bez seznamu nemá co dostat a nemá se z čeho odhlásit. */
  it('refuses to submit without a list', async () => {
    const onSubmit = vi.fn();
    renderIntl(
      <StepOptions
        estimate={base}
        lists={[{ id: LIST_ID, name: 'Zákazníci', optIn: 'double' }]}
        onCreateList={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /naimportovat/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/vyberte seznam/i);
  });

  /** Výchozí seznam projektu je předvybraný, takže běžný import projde bez klikání. */
  it('preselects the default list of the project', async () => {
    const onSubmit = vi.fn();
    renderIntl(
      <StepOptions
        estimate={base}
        lists={[{ id: LIST_ID, name: 'Odběratelé', optIn: 'single', isDefault: true }]}
        onCreateList={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /naimportovat/i }));

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ listId: LIST_ID }));
  });

  it('says the declaration is stored as evidence', () => {
    renderIntl(
      <StepOptions estimate={base} lists={[]} onCreateList={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(screen.getByText(/uloží se jako důkaz včetně data a mého jména/i)).toBeInTheDocument();
  });

  it('greys out the duplicate error option above the memory threshold and explains why', () => {
    renderIntl(
      <StepOptions
        estimate={{ ...base, totalRows: 2_000_000 }}
        lists={[]}
        onCreateList={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: /nahlásit jako chybu/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByText(/neumíme spolehlivě poznat druhý výskyt/i)).toBeInTheDocument();
  });
});

describe('mapping step', () => {
  const preview = () => ({
    columns: [
      { name: 'Email', sample: 'jana@firma.cz', target: 'email' },
      { name: 'Jmeno', sample: 'Jana Nováková', target: 'full_name' },
      { name: 'Krestni', sample: 'Jana', target: 'ignore' },
      { name: 'Poznámka', sample: 'VIP', target: 'ignore' },
    ],
  });

  it('shows a sample value next to every column', () => {
    renderIntl(<StepMapping preview={preview()} onCreateField={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
  });

  it('preselects the automatic suggestion and lets it be overridden', async () => {
    renderIntl(<StepMapping preview={preview()} onCreateField={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByLabelText('Email')).toHaveValue('email');
    await userEvent.selectOptions(screen.getByLabelText('Email'), 'ignore');
    expect(screen.getByLabelText('Email')).toHaveValue('ignore');
  });

  /**
   * Tlačítko „Vytvořit pole" do 5. 8. 2026 nemělo obsluhu, takže sloupec navíc
   * se dal jedině zahodit. Test měří, že se pole doopravdy založí A že se na ně
   * sloupec rovnou namapuje; samotné vykreslení tlačítka nic nedokazuje.
   */
  it('offers to create a custom field for an unmapped column', () => {
    renderIntl(<StepMapping preview={preview()} onCreateField={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: /vytvořit pole .Poznámka./i })).toBeInTheDocument();
  });

  it('creates the field and maps the column onto it', async () => {
    const onCreateField = vi.fn().mockResolvedValue('poznamka');
    const onNext = vi.fn();
    renderIntl(<StepMapping preview={preview()} onCreateField={onCreateField} onNext={onNext} />);

    await userEvent.click(screen.getByRole('button', { name: /vytvořit pole .Poznámka./i }));

    expect(onCreateField).toHaveBeenCalledWith({ key: 'poznamka', label: 'Poznámka' });
    await userEvent.click(screen.getByRole('button', { name: /zobrazit náhled/i }));
    expect(onNext).toHaveBeenCalledWith(
      expect.objectContaining({ Poznámka: 'attribute:poznamka' }),
    );
  });

  it('says it when the field cannot be created, instead of doing nothing', async () => {
    renderIntl(
      <StepMapping
        preview={preview()}
        onCreateField={vi.fn().mockResolvedValue(null)}
        onNext={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /vytvořit pole .Poznámka./i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nepodařilo založit/i);
  });

  it('derives a field key the server accepts', () => {
    expect(fieldKeyFrom('Číslo smlouvy')).toBe('cislo_smlouvy');
    expect(fieldKeyFrom('  Poznámka!  ')).toBe('poznamka');
    // Klíč musí začínat písmenem, jinak ho server odmítne s invalid_format.
    expect(fieldKeyFrom('2024 obrat')).toBe('pole_2024_obrat');
    expect(/^[a-z][a-z0-9_]{0,39}$/.test(fieldKeyFrom('Číslo smlouvy'))).toBe(true);
  });

  it('keeps the continue button enabled without an email column and moves focus to the picker', async () => {
    const withoutEmail = {
      columns: preview().columns.map((column) =>
        column.name === 'Email' ? { ...column, target: 'ignore' } : column,
      ),
    };
    renderIntl(<StepMapping preview={withoutEmail} onCreateField={vi.fn()} onNext={vi.fn()} />);
    const next = screen.getByRole('button', { name: /zobrazit náhled/i });
    // Žádné tlačítko primární akce nemá disabled. Mrtvé tlačítko neřekne proč.
    expect(next).not.toBeDisabled();
    await userEvent.click(next);
    expect(
      screen.getByText(/nevybrali jste, ve kterém sloupci je e-mailová adresa/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveFocus();
  });

  it('names both columns when two point at the same field', async () => {
    renderIntl(<StepMapping preview={preview()} onCreateField={vi.fn()} onNext={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText('Krestni'), 'first_name');
    await userEvent.selectOptions(screen.getByLabelText('Jmeno'), 'first_name');
    expect(screen.getByText(/míří dva sloupce/i)).toBeInTheDocument();
  });

  it('says the full name column will be split', () => {
    renderIntl(<StepMapping preview={preview()} onCreateField={vi.fn()} onNext={vi.fn()} />);
    expect(screen.getByText(/rozdělíme na jméno a příjmení/i)).toBeInTheDocument();
  });
});
