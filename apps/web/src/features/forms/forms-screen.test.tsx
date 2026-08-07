import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormsScreen } from './forms-screen';
import type { FormView } from './types';
import { renderWithProviders } from './test-utils';

/**
 * Mountuje se CELÁ obrazovka, ne dialog s ručně dodanými propy: tlačítko, které
 * nic nevolá, poznají jedině testy nad tím, co si obsluhu dodává samo.
 */

// Radix `Select` jede na Pointer Events a jsdom je nezná. Bez těchhle náhrad
// spadne kliknutí na spouštěč chybou `target.hasPointerCapture is not a function`.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

const createForm = vi.fn();
const updateForm = vi.fn();
const deleteForm = vi.fn();
vi.mock('./actions', () => ({
  createFormAction: (input: unknown) => createForm(input),
  updateFormAction: (input: unknown) => updateForm(input),
  deleteFormAction: (input: unknown) => deleteForm(input),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push, replace: vi.fn(), back: vi.fn(), refresh }),
  };
});

const FORM: FormView = {
  id: 'form-1',
  name: 'Newsletter',
  slug: 'AAAAAAAAAAAAAAAAAAAAAAAA',
  hosted_url: 'https://mail.example.cz/f/AAAAAAAAAAAAAAAAAAAAAAAA',
  fields: [
    { target: 'email', label: { en: 'Email', cs: 'E-mail' }, required: true, type: 'email' },
  ],
  list_ids: ['list-1'],
  double_opt_in: true,
  consent_text: null,
  consent_required: true,
  redirect_url: null,
  thanks_template_id: null,
  confirmed_template_id: null,
  already_subscribed_template_id: null,
  success_message: {},
  active: true,
  delivery_template_id: null,
  submission_count: 12,
  accepted_30d: 4,
  dropped_30d: {},
  created_at: '2026-07-31T10:15:30.000Z',
};

const LISTS = [
  { id: 'list-1', name: 'Newsletter' },
  { id: 'list-2', name: 'VIP' },
];

function renderScreen(forms: FormView[], canEdit = true) {
  return renderWithProviders(
    <FormsScreen
      forms={forms}
      lists={LISTS}
      workspaceId="ws-1"
      basePath="/w/muj-projekt/forms"
      canEdit={canEdit}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  createForm.mockResolvedValue({ status: 'success', id: 'form-9' });
  updateForm.mockResolvedValue({ status: 'success', id: 'form-1' });
  deleteForm.mockResolvedValue({ status: 'success', id: 'form-1' });
});

/**
 * Akce řádku bydlí od 6. 8. 2026 v nabídce „…". Zavřená nabídka svoje položky
 * vůbec nevykresluje, takže ji test musí nejdřív otevřít.
 */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, index = 0) {
  const triggers = screen.getAllByRole('button', { name: /Další akce s formulářem/ });
  const trigger = triggers[index];
  if (trigger === undefined) throw new Error(`Řádek ${index} nemá nabídku akcí.`);
  await user.click(trigger);
}

function itemNames() {
  return screen.getAllByRole('menuitem').map((item) => item.textContent);
}

describe('FormsScreen', () => {
  it('prázdný stav vysvětlí, k čemu formulář je, a nabídne založení', async () => {
    const user = userEvent.setup();
    renderScreen([]);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vytvořit první formulář' }));
    expect(screen.getByRole('heading', { name: 'Nový formulář' })).toBeInTheDocument();
  });

  it('ukazuje seznam, do kterého formulář zapisuje', () => {
    renderScreen([FORM]);
    expect(screen.getByRole('link', { name: 'Otevřít formulář Newsletter' })).toBeInTheDocument();
    // Jméno seznamu, ne jeho identifikátor: podle něj se pozná, kam přihlášení tečou.
    expect(screen.getAllByText('Newsletter').length).toBeGreaterThan(0);
  });

  it('formulář bez seznamu to přizná, místo aby ukázal prázdno', () => {
    renderScreen([{ ...FORM, list_ids: [] }]);
    expect(screen.getByText('Zatím do žádného, jen založit kontakt')).toBeInTheDocument();
  });

  it('pozastavený formulář má jiný odznak než zapnutý', () => {
    renderScreen([{ ...FORM, active: false }]);
    expect(screen.getByText('Pozastavený')).toBeInTheDocument();
  });

  it('založení pošle jméno i vybraný seznam a otevře detail nového formuláře', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);
    await user.click(screen.getByTestId('create-form'));
    await user.type(screen.getByTestId('form-name'), 'Patička webu');
    await user.click(screen.getByTestId('create-form-submit'));

    await waitFor(() => {
      expect(createForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        body: { name: 'Patička webu', list_ids: ['list-1'] },
      });
    });
    // Vrátit se do seznamu je slepá ulička: uživatel zakládal formulář proto,
    // aby ho nastavil a vložil na web.
    expect(push).toHaveBeenCalledWith('/w/muj-projekt/forms/form-9');
  });

  it('bez práva zapisovat se zakládání vůbec nenabízí', () => {
    renderScreen([FORM], false);
    expect(screen.queryByTestId('create-form')).toBeNull();
  });

  it('selhání založení řekne důvod ze serveru, ne obecnou hlášku', async () => {
    const user = userEvent.setup();
    createForm.mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Seznam, do kterého má formulář zapisovat, neexistuje.',
      fieldErrors: {},
    });
    renderScreen([FORM]);
    await user.click(screen.getByTestId('create-form'));
    await user.type(screen.getByTestId('form-name'), 'Patička webu');
    await user.click(screen.getByTestId('create-form-submit'));

    expect(await screen.findByTestId('forms-error')).toHaveTextContent(
      'Seznam, do kterého má formulář zapisovat, neexistuje.',
    );
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * KDYBY TENHLE BLOK SPADL: z řádku formuláře zase vede jediná cesta, a to kód
 * k vložení. Pozastavení bylo do 6. 8. 2026 schované v přepínači uvnitř
 * editoru, takže se muselo dvakrát proklikat, a smazat formulář šlo taky jen
 * odtamtud.
 */
describe('nabídka „…" v řádku formuláře', () => {
  it('běžící formulář nabízí pozastavení, ne spuštění', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);

    await openRowMenu(user);
    expect(itemNames()).toEqual([
      'Upravit',
      'Vložit na web',
      'Pozastavit',
      'Zobrazit cílový seznam',
      'Smazat',
    ]);
  });

  /*
   * Dvě různé položky, ne jedna zašedlá: v nabídce stojí vždycky ta, která stav
   * doopravdy změní. Zašedlá položka bez vysvětlení je zakázaná.
   */
  it('pozastavený formulář nabízí spuštění, ne pozastavení', async () => {
    const user = userEvent.setup();
    renderScreen([{ ...FORM, active: false }]);

    await openRowMenu(user);
    expect(itemNames()).toContain('Spustit');
    expect(itemNames()).not.toContain('Pozastavit');
  });

  it('formulář bez cílového seznamu ho nenabízí zobrazit', async () => {
    const user = userEvent.setup();
    renderScreen([{ ...FORM, list_ids: [] }]);

    await openRowMenu(user);
    expect(itemNames()).not.toContain('Zobrazit cílový seznam');
  });

  /*
   * Vložení na web je ČTENÍ: stránka s kódem nic nemění, takže na ni má nárok
   * i ten, kdo formuláře upravovat nesmí.
   */
  it('bez práva zapisovat zbyde jen vložení na web a cílový seznam', async () => {
    const user = userEvent.setup();
    renderScreen([FORM], false);

    await openRowMenu(user);
    expect(itemNames()).toEqual(['Vložit na web', 'Zobrazit cílový seznam']);
  });

  it('„Pozastavit" vypne sběr přihlášení a obnoví seznam', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Pozastavit' }));

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { active: false },
      });
    });
    expect(refresh).toHaveBeenCalled();
  });

  it('„Spustit" sběr zase zapne', async () => {
    const user = userEvent.setup();
    renderScreen([{ ...FORM, active: false }]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Spustit' }));

    await waitFor(() => {
      expect(updateForm).toHaveBeenCalledWith({
        workspaceId: 'ws-1',
        id: 'form-1',
        body: { active: true },
      });
    });
  });

  it('„Zobrazit cílový seznam" vede na detail seznamu, ne na formulář', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Zobrazit cílový seznam' }));

    expect(push).toHaveBeenCalledWith('/w/muj-projekt/lists/list-1');
  });

  it('„Vložit na web" vede na stránku s kódem', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Vložit na web' }));

    expect(push).toHaveBeenCalledWith('/w/muj-projekt/forms/form-1/embed');
  });

  /*
   * KDYBY TENHLE TEST SPADL: z okna mazání zmizel výčet následků. Formulář
   * vložený na cizím webu po smazání ukáže prázdno, a to se musí říct předem.
   */
  it('mazání se ptá a vyjmenuje následky včetně veřejné adresy', async () => {
    const user = userEvent.setup();
    renderScreen([FORM]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));

    expect(await screen.findByText(/Smazat formulář Newsletter\?/)).toBeInTheDocument();
    expect(screen.getByText(/jeho veřejná adresa přestane fungovat/)).toBeInTheDocument();
    expect(screen.getByText(/Kontakty, které přes formulář přišly, zůstávají/)).toBeInTheDocument();
    expect(screen.getByText(/vypněte přepínač/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Smazat formulář' }));
    await waitFor(() => {
      expect(deleteForm).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'form-1' });
    });
  });

  it('selhání mazání řekne důvod ze serveru', async () => {
    const user = userEvent.setup();
    deleteForm.mockResolvedValue({
      status: 'error',
      code: 'conflict',
      detail: 'Formulář zrovna zpracovává přihlášení.',
      fieldErrors: {},
    });
    renderScreen([FORM]);

    await openRowMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Smazat' }));
    await user.click(screen.getByRole('button', { name: 'Smazat formulář' }));

    expect(await screen.findByTestId('forms-error')).toHaveTextContent(
      'Formulář zrovna zpracovává přihlášení.',
    );
  });
});

/**
 * HROMADNÉ MAZÁNÍ Z PRUHU VÝBĚRU.
 *
 * KDYBY TENHLE BLOK SPADL: zaškrtávátka v tabulce formulářů zase nikam nevedou.
 * `DataTable` je kreslí vždycky a vypnout se nedají, takže pruh nad tabulkou
 * nabízel jedině „Vybrat všech N" a „Zrušit výběr". Je to týž nález, jaký
 * zadavatel 7. 8. 2026 popsal u kampaní.
 */
describe('hromadné mazání formulářů', () => {
  const SECOND: FormView = { ...FORM, id: 'form-2', name: 'Patička webu', active: false };

  async function selectRow(user: ReturnType<typeof userEvent.setup>, index: number) {
    // Popisek řádkového zaškrtávátka je u formulářů `forms.name`, tedy „Název";
    // hlavičkové má „Formuláře", takže se nepletou.
    const boxes = screen.getAllByRole('checkbox', { name: 'Název' });
    const box = boxes[index];
    if (box === undefined) throw new Error(`Řádek ${index} nemá zaškrtávátko.`);
    await user.click(box);
  }

  it('výběr vede k akci, ne jen k počtu', async () => {
    const user = userEvent.setup();
    renderScreen([FORM, SECOND]);

    await selectRow(user, 0);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.getByTestId('forms-bulk-delete')).toHaveTextContent('Smazat 1 formulář');
  });

  it('potvrzení smaže všechny označené a seznam se obnoví', async () => {
    const user = userEvent.setup();
    renderScreen([FORM, SECOND]);

    await selectRow(user, 0);
    await selectRow(user, 1);
    expect(screen.getByTestId('forms-bulk-delete')).toHaveTextContent('Smazat 2 formuláře');

    await user.click(screen.getByTestId('forms-bulk-delete'));
    // Okno říká i to, že na dočasné zastavení je přepínač, ne mazání.
    expect(screen.getByText(/Formulář sbírá přihlášení/)).toBeInTheDocument();
    await user.click(screen.getByTestId('forms-bulk-submit'));

    await waitFor(() => expect(deleteForm).toHaveBeenCalledTimes(2));
    expect(deleteForm).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'form-1' });
    expect(deleteForm).toHaveBeenCalledWith({ workspaceId: 'ws-1', id: 'form-2' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('nezdar výběr nezruší a pojmenuje se počtem', async () => {
    deleteForm.mockResolvedValue({ status: 'error', code: 'conflict', detail: '' });
    const user = userEvent.setup();
    renderScreen([FORM]);

    await selectRow(user, 0);
    await user.click(screen.getByTestId('forms-bulk-delete'));
    await user.click(screen.getByTestId('forms-bulk-submit'));

    const error = await screen.findByTestId('forms-bulk-error');
    expect(error).toHaveTextContent('conflict');
    // Odklikaná práce se po chybě neztrácí.
    expect(screen.getByTestId('forms-bulk-delete')).toBeInTheDocument();
  });

  it('bez práva upravovat pruh akci nenabízí', async () => {
    const user = userEvent.setup();
    renderScreen([FORM], false);

    await selectRow(user, 0);

    expect(screen.getByTestId('selection-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('forms-bulk-delete')).toBeNull();
  });
});

/**
 * ZAHOZENÁ ODESLÁNÍ MUSÍ BÝT VIDĚT.
 *
 * Ochrana formuláře zahazuje TIŠE, aby si robot neodvodil, které pravidlo ho chytlo.
 * Tu cenu ale platí i člověk: správce hesel vyplní pole naráz, časová past (výchozí
 * dvě sekundy) odeslání zahodí a návštěvník uvidí „Poslali jsme vám e-mail s odkazem",
 * přestože žádný nedostane. Nedozví se to nikdo, protože i produkt to považuje za
 * vyřízené. Naměřeno 7. 8. 2026 na běžící instalaci: řádky `dropped`
 * v `form_submissions` a v `contacts` nic.
 *
 * Tenhle sloupec je jediné místo, kde na to jde přijít.
 */
describe('FormsScreen: zahozená odeslání', () => {
  it('ukáže počet zahozených vedle počtu přihlášení', () => {
    renderScreen([{ ...FORM, accepted_30d: 4, dropped_30d: { too_fast: 3 } }]);
    expect(screen.getByText(/3 odeslání zahozena ochranou/)).toBeInTheDocument();
  });

  it('zahozená se do počtu přihlášení NEPŘIČÍTAJÍ', () => {
    renderScreen([{ ...FORM, accepted_30d: 4, dropped_30d: { too_fast: 3 } }]);
    // Kdyby se sčítala, stálo by tu sedm a formulář by vypadal úspěšněji, než je.
    expect(screen.getByText(/^4 /)).toBeInTheDocument();
  });

  it('bez zahozených se nic navíc nekreslí', () => {
    renderScreen([{ ...FORM, accepted_30d: 4, dropped_30d: {} }]);
    expect(screen.queryByText(/zahoz/i)).toBeNull();
  });

  it('sečte důvody dohromady, protože správce zajímá ztráta, ne rozbor', () => {
    renderScreen([
      { ...FORM, accepted_30d: 0, dropped_30d: { too_fast: 2, honeypot: 1, missing_nonce: 4 } },
    ]);
    expect(screen.getByText(/7 odeslání zahozeno ochranou/)).toBeInTheDocument();
  });
});
