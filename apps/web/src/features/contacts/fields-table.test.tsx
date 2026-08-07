import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldsTable, type ContactFieldRow } from './fields-table';
import { renderWithProviders } from './test-utils';

// Radix Select potřebuje v jsdom zachytávání ukazatele a `scrollIntoView`,
// jinak se nabídka nikdy neotevře. Táž čtveřice stojí u testů stavitele polí
// formuláře.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const loadImpact = vi.fn().mockResolvedValue({
  status: 'success',
  impact: {
    contacts_with_value: 8210,
    segments: [
      { id: 's1', name: 'Brno' },
      { id: 's2', name: 'VIP' },
    ],
    templates: [{ id: 't1', name: 'Newsletter', usages: 2 }],
    campaigns_scheduled: [],
    forms: [],
  },
});

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const createField = vi.fn().mockResolvedValue({ status: 'success' });

const renameField = vi.fn().mockResolvedValue({ status: 'success' });

const archiveField = vi.fn().mockResolvedValue({ status: 'success' });

vi.mock('./actions', () => ({
  archiveFieldAction: (...args: unknown[]) => archiveField(...args),
  createFieldAction: (...args: unknown[]) => createField(...args),
  deleteFieldAction: vi.fn().mockResolvedValue({ status: 'success' }),
  loadFieldImpactAction: (...args: unknown[]) => loadImpact(...args),
  renameFieldAction: (...args: unknown[]) => renameField(...args),
}));

const fields: ContactFieldRow[] = [
  {
    id: 'f-1',
    key: 'city',
    label: 'Město',
    labels: { cs: 'Město', en: 'City' },
    type: 'text',
    indexed: true,
    archived: false,
  },
  {
    id: 'f-2',
    key: 'orders',
    label: 'Objednávky',
    labels: { cs: 'Objednávky', en: 'Orders' },
    type: 'number',
    indexed: false,
    archived: false,
  },
];

function renderFields(props: Partial<React.ComponentProps<typeof FieldsTable>> = {}) {
  return renderWithProviders(
    <FieldsTable
      workspaceId="w-1"
      fields={fields}
      limits={{ fields: 100, indexed: 8 }}
      locale="cs"
      {...props}
    />,
  );
}

beforeEach(() => {
  loadImpact.mockClear();
  createField.mockClear();
  renameField.mockClear();
  archiveField.mockClear();
});

describe('FieldsTable', () => {
  it('pojmenuje typ pole česky, ne jak stojí v databázi', () => {
    renderFields({
      fields: [
        {
          id: 'f-9',
          key: 'vip',
          label: 'VIP',
          labels: { cs: 'VIP', en: 'VIP' },
          type: 'boolean',
          indexed: false,
          archived: false,
        },
        {
          id: 'f-10',
          key: 'note',
          label: 'Poznámka',
          labels: { cs: 'Poznámka', en: 'Note' },
          type: 'long_text',
          indexed: false,
          archived: false,
        },
      ],
    });
    expect(screen.getByText('Ano/ne')).toBeInTheDocument();
    expect(screen.getByText('Dlouhý text')).toBeInTheDocument();
    expect(screen.queryByText('boolean')).not.toBeInTheDocument();
    expect(screen.queryByText('long_text')).not.toBeInTheDocument();
  });

  it('ukáže využití obou limitů', () => {
    renderFields();
    expect(screen.getByTestId('fields-usage')).toHaveTextContent('2 pole ze 100');
    expect(screen.getByTestId('fields-indexed-usage')).toHaveTextContent('1 zrychlené pole z 8');
  });

  it('na stropu polí nezešediví tlačítko, ale vysvětlí, co udělat', () => {
    renderFields({
      fields: Array.from({ length: 100 }, (_, index) => ({
        ...fields[0]!,
        id: `f${index}`,
        key: `k${index}`,
        indexed: false,
      })),
    });
    expect(screen.getByRole('button', { name: 'Přidat pole' })).not.toBeDisabled();
    expect(screen.getByText(/Nepoužívané pole nejdřív archivujte/)).toBeInTheDocument();
  });

  /**
   * SLOUPEC AKCÍ JE JEDNA IKONA, ne tři tlačítka pod sebou a mezi nimi
   * čtyřřádkové vysvětlení archivace. Vysvětlení se přesunulo do okna
   * archivace, kde se člověk doopravdy rozhoduje.
   */
  it('řádek nabízí akce pod jednou ikonou a bez vysvětlujícího odstavce', () => {
    renderFields();
    expect(screen.queryByRole('button', { name: 'Archivovat' })).toBeNull();
    expect(screen.queryByText(/hodnoty zůstanou a segmenty dál fungují/)).toBeNull();
    // Jméno akce zůstává čtečce i hlasovému ovládání, byť tlačítko nemá text.
    expect(screen.getByRole('button', { name: 'Další akce k poli Město' })).toBeInTheDocument();
  });

  it('archivace se ptá a vysvětlí následek, než se provede', async () => {
    const user = userEvent.setup();
    renderFields();

    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Archivovat' }));

    expect(await screen.findByText('Archivovat pole Město?')).toBeInTheDocument();
    expect(screen.getByText(/Hodnoty u kontaktů zůstanou/)).toBeInTheDocument();
    // Dokud se okno nepotvrdí, na server nic neodešlo.
    expect(archiveField).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Archivovat pole' }));
    expect(archiveField).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'f-1' });
  });

  /** Mazání stojí za oddělovačem a v červené, ať se netrefí místo archivace. */
  it('mazání je v nabídce oddělené od vratných akcí', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('field-row-menu-city'));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Přejmenovat', 'Archivovat', 'Smazat']);
    expect(await screen.findByRole('separator')).toBeInTheDocument();
  });

  it('dialog smazání ukáže dopad z endpointu impact', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Smazat' }));
    expect(loadImpact).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'f-1' });
    expect(await screen.findByText(/8\s210 kontaktů/)).toBeInTheDocument();
    expect(screen.getByText(/1 šablona pole používá/)).toBeInTheDocument();
    expect(screen.getByText(/2 segmenty na pole odkazují/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archivovat místo smazání' })).toBeInTheDocument();
  });

  it('u pole drženého naplánovanou kampaní smazání nenabídne a řekne proč', async () => {
    const user = userEvent.setup();
    loadImpact.mockResolvedValueOnce({
      status: 'success',
      impact: {
        contacts_with_value: 10,
        segments: [],
        templates: [],
        campaigns_scheduled: [{ id: 'c1', name: 'Letní výprodej' }],
        forms: [],
      },
    });
    renderFields();
    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Smazat' }));
    expect(
      await screen.findByText(/Pole používá naplánovaná kampaň Letní výprodej/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat pole' })).toBeNull();
  });

  /**
   * TLAČÍTKO BEZ OBSLUHY je v tomhle produktu vada horší než chybějící
   * tlačítko: slibuje cestu, která nikam nevede. „Přidat pole" ji do 7. 8. 2026
   * nemělo, takže vlastní pole šlo založit jedině oklikou přes stavitele polí
   * formuláře.
   */
  it('tlačítko Přidat pole otevře dialog a pole doopravdy založí', async () => {
    const user = userEvent.setup();
    renderFields();

    await user.click(screen.getByTestId('create-field'));
    await user.type(screen.getByTestId('new-field-label'), 'Číslo zákazníka');
    // Klíč se odvodí z popisku, aby ho uživatel nemusel psát podruhé.
    expect(screen.getByTestId('new-field-key')).toHaveValue('cislo_zakaznika');

    await user.click(screen.getByTestId('new-field-submit'));
    expect(createField).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      key: 'cislo_zakaznika',
      label: 'Číslo zákazníka',
      type: 'text',
    });
  });

  it('nevyplněný dialog nezakazuje tlačítko, ale řekne, co zbývá', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('create-field'));

    // Princip P5: primární akce se nezašedne. Klik nic neodešle a pod tlačítkem
    // stojí důvod, ne mlčení.
    await user.click(screen.getByTestId('new-field-submit'));
    expect(createField).not.toHaveBeenCalled();
    expect(screen.getByText(/Nejdřív vyplňte název pole a klíč/)).toBeInTheDocument();
  });

  it('chybu ze serveru ukáže tak, jak přišla', async () => {
    const user = userEvent.setup();
    createField.mockResolvedValueOnce({
      status: 'error',
      code: 'already_exists',
      detail: 'Pole s klíčem mesto už existuje.',
    });
    renderFields();

    await user.click(screen.getByTestId('create-field'));
    await user.type(screen.getByTestId('new-field-label'), 'Město');
    await user.click(screen.getByTestId('new-field-submit'));

    // „Klíč už existuje" a „strop polí" jsou dvě různé příčiny a obecná hláška
    // by je slila do jedné.
    expect(await screen.findByTestId('new-field-error')).toHaveTextContent(
      'Pole s klíčem mesto už existuje.',
    );
  });

  it('typy se v dialogu nabízejí pojmenovaně, ne jmény z databáze', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('create-field'));

    const select = screen.getByRole('combobox', { name: 'Jaké hodnoty pole ponese' });
    await user.click(select);
    expect(await screen.findByRole('option', { name: 'Ano/ne' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'boolean' })).toBeNull();
  });

  /**
   * PŘEJMENOVÁNÍ JE NUTNÉ MINIMUM, ne ozdoba. V projektu zadavatele leželo pole
   * pojmenované „boolen", které nešlo ani přejmenovat, ani smazat, takže bylo
   * v jeho datech napořád.
   */
  it('pole jde přejmenovat a přepíše se jen jazyk rozhraní', async () => {
    const user = userEvent.setup();
    renderFields();

    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Přejmenovat' }));
    const input = screen.getByTestId('rename-field-label');
    // Předvyplní se dosavadní jméno, jinak by přejmenování začínalo od prázdna.
    expect(input).toHaveValue('Město');
    await user.clear(input);
    await user.type(input, 'Obec');
    await user.click(screen.getByTestId('rename-field-submit'));

    // Anglický popisek se NEZAHAZUJE: posílá se celá mapa a mění se jen `cs`.
    expect(renameField).toHaveBeenCalledWith({
      workspaceId: 'w-1',
      id: 'f-1',
      label: { cs: 'Obec', en: 'City' },
    });
  });

  it('dialog přejmenování řekne, že klíč ani typ se nemění', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Přejmenovat' }));
    // Co se nemění, musí být vidět PŘED uložením, ne až v chybě po něm.
    expect(screen.getByTestId('rename-field-locked')).toHaveTextContent('city');
  });

  it('beze změny názvu se neukládá a řekne se proč', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getByTestId('field-row-menu-city'));
    await user.click(await screen.findByRole('menuitem', { name: 'Přejmenovat' }));
    await user.click(screen.getByTestId('rename-field-submit'));
    expect(renameField).not.toHaveBeenCalled();
    expect(screen.getByText(/Napište nový název/)).toBeInTheDocument();
  });

  it('prázdný stav vysvětlí, k čemu vlastní pole jsou', () => {
    renderFields({ fields: [] });
    expect(
      screen.getByRole('heading', { name: 'Zatím tu není žádné vlastní pole' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat první pole' })).toBeInTheDocument();
  });

  /**
   * „Přidat první pole" volalo `router.refresh()`, tedy překreslovalo prázdnou
   * obrazovku prázdnou obrazovkou. Vypadalo to jako rozbitá aplikace.
   */
  it('z prázdného stavu vede tlačítko do dialogu, ne do překreslení', async () => {
    const user = userEvent.setup();
    renderFields({ fields: [] });
    await user.click(screen.getByRole('button', { name: 'Přidat první pole' }));
    expect(screen.getByTestId('new-field-label')).toBeInTheDocument();
  });
});

/**
 * HROMADNÁ ARCHIVACE Z PRUHU VÝBĚRU.
 *
 * KDYBY TENHLE BLOK SPADL: zaškrtávátka v tabulce polí zase nikam nevedou.
 * `DataTable` je kreslí vždycky a vypnout se nedají, takže pruh nad tabulkou
 * nabízel jedině „Vybrat všech N" a „Zrušit výběr".
 *
 * HROMADNĚ SE ARCHIVUJE, NEMAŽE. Mazání pole se u jednoho řádku ptá až po načtení
 * dopadu (kolik kontaktů má hodnotu, drží ho naplánovaná kampaň?) a nad výběrem se
 * ta věta říct nedá. Poslední test hlídá, že to okno říká nahlas místo mlčení.
 */
describe('hromadná archivace polí', () => {
  async function selectRow(user: ReturnType<typeof userEvent.setup>, index: number) {
    // Popisek řádkového zaškrtávátka je `fields.label`, tedy „Název";
    // hlavičkové má „Vlastní pole", takže se nepletou.
    const boxes = screen.getAllByRole('checkbox', { name: 'Název' });
    const box = boxes[index];
    if (box === undefined) throw new Error(`Řádek ${index} nemá zaškrtávátko.`);
    await user.click(box);
  }

  it('výběr vede k akci, ne jen k počtu', async () => {
    const user = userEvent.setup();
    renderFields();

    await selectRow(user, 0);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('fields-bulk-delete')).toHaveTextContent('Archivovat 1 pole');
  });

  it('archivované pole se přeskočí a okno to řekne nahlas', async () => {
    const user = userEvent.setup();
    renderFields({
      fields: [fields[0]!, { ...fields[1]!, archived: true }],
    });

    await selectRow(user, 0);
    await selectRow(user, 1);
    expect(screen.getByTestId('fields-bulk-delete')).toHaveTextContent('Archivovat 1 pole');

    await user.click(screen.getByTestId('fields-bulk-delete'));
    expect(screen.getByTestId('fields-bulk-skipped')).toHaveTextContent('je už archivované');

    await user.click(screen.getByTestId('fields-bulk-submit'));

    await vi.waitFor(() => expect(archiveField).toHaveBeenCalledTimes(1));
    expect(archiveField).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'f-1' });
  });

  it('okno vysvětlí, proč se hromadně nemaže', async () => {
    const user = userEvent.setup();
    renderFields();

    await selectRow(user, 0);
    await user.click(screen.getByTestId('fields-bulk-delete'));

    expect(screen.getByText(/Hromadné mazání polí tu schválně není/)).toBeInTheDocument();
  });
});
