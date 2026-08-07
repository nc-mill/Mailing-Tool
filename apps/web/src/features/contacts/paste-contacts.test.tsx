import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PasteContacts, mappingForHeader } from './paste-contacts';
import { PASTE_MAX_ROWS } from './paste-parser';
import { renderWithProviders } from './test-utils';

const push = vi.fn();
vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push, refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const WORKSPACE_ID = '019fbf52-d8b9-7b0d-b67e-528e8026a383';
const IMPORT_ID = '9855e936-c11a-4b3d-b799-33a53178916c';
const LIST_ID = '0199a1f8-4f3f-7a7a-9c3d-2c1b0f9d1111';
const TAG_ID = '0199a1f8-4f3f-7a7a-9c3d-2c1b0f9d2222';

/**
 * Odpovědi celé dávkové cesty importu ve tvaru, ve kterém je vrací server.
 *
 * `statuses` jsou stavy, které postupně vrací dotaz na běžící import. Výchozí
 * `['completed']` znamená „doběhlo hned"; test běžícího zpracování si posílá
 * `['importing', ...]`, protože právě ten stav se dřív hlásil jako selhání.
 */
function stubApi(statuses: string[] = ['completed']): {
  calls: { url: string; init?: RequestInit }[];
} {
  const calls: { url: string; init?: RequestInit }[] = [];
  const queue = [...statuses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init === undefined ? {} : { init }) });
      if (url === '/api/v1/lists' && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ data: { id: LIST_ID, name: 'Odběratelé', opt_in: 'double' } }),
          { status: 201 },
        );
      }
      if (url.endsWith('/preview')) {
        return new Response(
          JSON.stringify({ header: ['email', 'first_name', 'last_name'], rows: [] }),
          { status: 200 },
        );
      }
      if (url.endsWith('/confirm')) {
        return new Response(JSON.stringify({ id: IMPORT_ID }), { status: 202 });
      }
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({ id: IMPORT_ID }), { status: 200 });
      }
      // Dotaz na stav dávky: GET na import bez další cesty.
      if (url.endsWith(IMPORT_ID) && init?.method === undefined) {
        const status = queue.length > 1 ? queue.shift() : queue[0];
        return new Response(
          JSON.stringify({ id: IMPORT_ID, status, checkpoint_row: 1, total_rows: 2 }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ id: IMPORT_ID }), { status: 202 });
    }),
  );
  return { calls };
}

function renderScreen(pollIntervalMs = 0) {
  return renderWithProviders(
    <PasteContacts
      workspaceId={WORKSPACE_ID}
      basePath="/w/muj-projekt/contacts"
      lists={[{ id: LIST_ID, name: 'Zákazníci', isDefault: true }]}
      tags={[{ id: TAG_ID, name: 'Brno' }]}
      pollIntervalMs={pollIntervalMs}
    />,
  );
}

async function type(text: string) {
  const field = screen.getByLabelText(/kontakty/i);
  // `paste` místo `type`: uživatel sem text vkládá ze schránky a `type` by
  // u víceřádkového textu odesílalo klávesu Enter po každém řádku.
  await userEvent.click(field);
  await userEvent.paste(text);
}

/**
 * jsdom nezná Pointer Capture ani `scrollIntoView`, na kterých Radix Select
 * stojí. Bez těchhle náhrad se rozbalovátko v testu neotevře.
 */
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

beforeEach(() => {
  push.mockClear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('mapování sloupců dočasného CSV', () => {
  it('najde sloupce podle názvu z hlavičky, ne podle pevného pořadí', () => {
    expect(mappingForHeader(['last_name', 'email', 'first_name'])).toEqual({
      '0': { target: 'last_name' },
      '1': { target: 'email' },
      '2': { target: 'first_name' },
    });
  });

  it('vrátí null, když hlavička nesedí, aby se nenaimportovaly rozsypané sloupce', () => {
    expect(mappingForHeader(['email,first_name,last_name'])).toBeNull();
    expect(mappingForHeader([])).toBeNull();
  });
});

describe('obrazovka vložení kontaktů textem', () => {
  it('ukáže souhrn s počty ještě před uložením', async () => {
    renderScreen();
    await type(
      'jana@example.com; Jana; Nováková\nrozbite@\njana@example.com; Jana\n\nsam@example.com',
    );

    // Dva použitelné řádky, jeden s vadnou adresou, jeden opakovaný. Všechna tři
    // čísla musí být vidět NAJEDNOU: samotné „2 k uložení" by z pěti vložených
    // řádků nevysvětlilo, kam se poděly zbylé tři.
    const summary = screen.getByRole('status');
    expect(summary).toHaveTextContent('K uložení jsou 2 řádky.');
    expect(summary).toHaveTextContent('Vadnou adresu má 1 řádek.');
    expect(summary).toHaveTextContent('1 řádek opakuje adresu z téhle dávky.');
  });

  it('ukáže v poli ukázku tvaru z katalogu, ne prázdné pole ani název klíče', () => {
    // Chytá překlep v názvu klíče: next-intl na chybějící klíč nespadne, jen
    // vykreslí jeho jméno, takže by v poli místo ukázky stálo „paste.example".
    renderScreen();

    const field = screen.getByLabelText(/kontakty/i) as HTMLTextAreaElement;
    expect(field.placeholder).toContain('jana@example.com; Jana; Nováková');
  });

  it('vypíše u chybného řádku číslo i obsah, aby šel opravit', async () => {
    renderScreen();
    await type('jana@example.com; Jana\nrozbite@\n');

    expect(screen.getByText(/Řádek 2: rozbite@/)).toBeInTheDocument();
  });

  it('vypíše duplicitu i s řádkem, na kterém je adresa poprvé', async () => {
    renderScreen();
    await type('jana@example.com; Jana\njana@example.com; Jana Druhá');

    expect(screen.getByText(/Řádek 2: jana@example.com; Jana Druhá/)).toBeInTheDocument();
    expect(screen.getByText(/už je na řádku 1/)).toBeInTheDocument();
  });

  it('pošle dávku hotovou cestou importu a odejde na její výsledek', async () => {
    const { calls } = stubApi();
    renderScreen();
    await type('jana@example.com; Jana; Nováková\nsam@example.com');

    await userEvent.click(screen.getByRole('button', { name: /uložit 2 kontakty/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());

    // 1. Založení importu z řádků, ne zakládání kontaktů po jednom.
    const create = calls[0];
    expect(create?.url).toBe('/api/v1/contacts/imports');
    expect(create?.init?.method).toBe('POST');
    expect(JSON.parse(String(create?.init?.body))).toEqual({
      rows: [
        { email: 'jana@example.com', first_name: 'Jana', last_name: 'Nováková' },
        { email: 'sam@example.com', first_name: '', last_name: '' },
      ],
    });
    const headers = create?.init?.headers as Record<string, string>;
    expect(headers['X-Workspace-Id']).toBe(WORKSPACE_ID);
    expect(headers['Idempotency-Key']).toBeTruthy();

    // 2. Náhled, 3. mapování a volby, 4. spuštění.
    expect(calls[1]?.url).toBe(`/api/v1/contacts/imports/${IMPORT_ID}/preview`);
    const patch = calls[2];
    expect(patch?.init?.method).toBe('PATCH');
    // DOSLOVNÉ tělo, ne `toMatchObject` s jedním klíčem. Volby jsou to jediné,
    // co nese přání uživatele až na server, a `toMatchObject` by nevšimlo, kdyby
    // některá z nich přestala odcházet.
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      mapping: {
        '0': { target: 'email' },
        '1': { target: 'first_name' },
        '2': { target: 'last_name' },
      },
      options: {
        on_conflict: 'update',
        duplicate_in_file: 'first',
        list_ids: [LIST_ID],
        subscription_status: 'confirmed',
        tag_ids: [],
        // Bez zaškrtnutého prohlášení se souhlas nezapisuje, protože není co doložit.
        consent: null,
      },
    });
    expect(calls[3]?.url).toBe(`/api/v1/contacts/imports/${IMPORT_ID}/confirm`);

    expect(push).toHaveBeenCalledWith(`/w/muj-projekt/contacts/import/${IMPORT_ID}`);
  });

  /**
   * Druhá branka k témuž problému jako v průvodci importem: kontakt bez seznamu
   * nemá co dostat a nemá se z čeho odhlásit. Obrazovka proto bez seznamu
   * neuloží nic a řekne proč.
   */
  /**
   * Obrazovka slibovala „Potvrzené", jenže bez prohlášení o doloženém souhlasu
   * automat přihlášení na seznamu s DVOJÍM potvrzením nepotvrdí, takže
   * v databázi vznikalo „čeká na potvrzení". Ověřeno na dev serveru.
   */
  it('u seznamu s dvojím potvrzením trvá na prohlášení a pošle ho jako souhlas', async () => {
    const { calls } = stubApi();
    renderWithProviders(
      <PasteContacts
        workspaceId={WORKSPACE_ID}
        basePath="/w/muj-projekt/contacts"
        lists={[{ id: LIST_ID, name: 'Zákazníci', optIn: 'double', isDefault: true }]}
        tags={[]}
        pollIntervalMs={0}
      />,
    );
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/prohlášení/i);
    expect(calls).toHaveLength(0);

    await userEvent.click(screen.getByRole('checkbox', { name: /potvrzuji, že tito lidé/i }));
    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    const body = JSON.parse(String(patch?.init?.body)) as {
      options: { consent: { declaration: boolean; source: string } | null };
    };
    expect(body.options.consent).toMatchObject({ declaration: true, source: 'paste' });
  });

  it('bez seznamu dávku neuloží a řekne proč', async () => {
    const { calls } = stubApi();
    renderWithProviders(
      <PasteContacts
        workspaceId={WORKSPACE_ID}
        basePath="/w/muj-projekt/contacts"
        lists={[{ id: LIST_ID, name: 'Zákazníci' }]}
        tags={[]}
        pollIntervalMs={0}
      />,
    );
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/vyberte seznam/i);
    expect(calls).toHaveLength(0);
    expect(push).not.toHaveBeenCalled();
  });

  /** Kdo nemá ani jeden seznam, musí ho založit odsud, jinak přijde o vložený text. */
  it('založí seznam rovnou z téhle obrazovky a dávku do něj zařadí', async () => {
    const { calls } = stubApi();
    renderWithProviders(
      <PasteContacts
        workspaceId={WORKSPACE_ID}
        basePath="/w/muj-projekt/contacts"
        lists={[]}
        tags={[]}
        pollIntervalMs={0}
      />,
    );
    await type('jana@example.com; Jana');

    await userEvent.type(screen.getByTestId('paste-new-list-name'), 'Odběratelé');
    await userEvent.click(screen.getByRole('button', { name: /^založit seznam$/i }));

    const created = calls.find(
      (call) => call.url === '/api/v1/lists' && call.init?.method === 'POST',
    );
    expect(JSON.parse(String(created?.init?.body))).toEqual({
      name: 'Odběratelé',
      opt_in: 'double',
    });

    // Nový seznam vzniká s dvojím potvrzením, takže obrazovka trvá na prohlášení.
    await userEvent.click(screen.getByRole('checkbox', { name: /potvrzuji, že tito lidé/i }));
    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    const body = JSON.parse(String(patch?.init?.body)) as { options: { list_ids: string[] } };
    expect(body.options.list_ids).toEqual([LIST_ID]);
  });

  it('pošle vybraný seznam, štítek i stav přihlášení', async () => {
    const { calls } = stubApi();
    renderScreen();
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('combobox', { name: /zařadit do seznamu/i }));
    await userEvent.click(await screen.findByRole('option', { name: 'Zákazníci' }));
    await userEvent.click(screen.getByLabelText('Brno'));
    await userEvent.click(screen.getByLabelText(/čeká na potvrzení/i));
    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    await waitFor(() => expect(push).toHaveBeenCalled());
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    expect(JSON.parse(String(patch?.init?.body)).options).toMatchObject({
      list_ids: [LIST_ID],
      tag_ids: [TAG_ID],
      subscription_status: 'pending',
    });
  });

  it('výchozí stav je přihlášený k odběru', () => {
    renderScreen();

    expect(screen.getByLabelText(/přihlášené k odběru/i)).toBeChecked();
    expect(screen.getByLabelText(/čeká na potvrzení/i)).not.toBeChecked();
  });

  it('bez jediného platného řádku řekne důvod, místo aby tlačítko jen zhaslo', async () => {
    const { calls } = stubApi();
    renderScreen();
    await type('rozbite@');

    await userEvent.click(screen.getByRole('button', { name: /uložit kontakty/i }));

    expect(screen.getByText(/aspoň jeden řádek s platnou adresou/i)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    // Důvod sám o sobě nestačí: opravuje se ve vloženém textu, takže tam musí
    // skončit i kurzor.
    expect(screen.getByLabelText(/kontakty/i)).toHaveFocus();
  });

  it('u dávky nad limitem mluví o limitu, ne o chybějící adrese', async () => {
    const { calls } = stubApi();
    renderScreen();
    const rows: string[] = [];
    for (let index = 0; index <= PASTE_MAX_ROWS; index += 1) {
      rows.push(`clovek${index}@example.com`);
    }
    await type(rows.join('\n'));

    const save = screen.getByRole('button', { name: /uložit/i });
    await userEvent.click(save);

    // Jedna věta o obojím naráz nutila člověka zjišťovat, která půlka se týká
    // jeho textu. Platných adres je tu deset tisíc, chybí jen místo v dávce.
    // Čte se DŮVOD U TLAČÍTKA, ne libovolná shoda na stránce: tutéž radu má
    // i výstraha v souhrnu.
    const reason = document.getElementById(save.getAttribute('aria-describedby') ?? '');
    expect(reason?.textContent).toMatch(/Rozdělte text na víc dávek/);
    expect(reason?.textContent).not.toMatch(/platnou adresou/);
    expect(calls).toHaveLength(0);
  });

  it('věta o cílovém seznamu stojí nad tlačítky, ne mezi nimi', () => {
    // ROZVRŽENÍ JE SOUČÁST SDĚLENÍ. Věta o zařazení do seznamu stála v řádku za
    // tlačítkem „Zrušit" a četla se jako jeho vysvětlení, přestože popisuje celou
    // dávku. Důvod nedostupnosti zase stál MEZI tlačítky.
    renderScreen();

    const target = screen.getByText(/zařadíme do seznamu Zákazníci/i);
    const save = screen.getByRole('button', { name: /uložit kontakty/i });
    const cancel = screen.getByRole('link', { name: /zrušit/i });

    expect(target.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(target.parentElement).not.toBe(save.parentElement);
    // Ústup je odkaz vedle hlavní akce, ne druhé stejně velké tlačítko.
    expect(cancel.parentElement).toBe(save.parentElement);
    // Důvod nedostupnosti dostane vlastní řádek pod dvojicí, ne místo mezi nimi.
    expect(save.parentElement?.className).toContain('[&>span]:basis-full');
  });

  it('řekne, co se s kontakty stane podle zvoleného stavu přihlášení', async () => {
    renderScreen();

    expect(screen.getByText(/jako přihlášené k odběru/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: /čeká na potvrzení/i }));

    expect(screen.getByText(/počkáme, až přihlášení potvrdí/i)).toBeInTheDocument();
    expect(screen.queryByText(/jako přihlášené k odběru/i)).not.toBeInTheDocument();
  });

  it('běžící zpracování ukazuje jako průběh, ne jako selhání, a odejde až na konci', async () => {
    // REGRESE NA FALEŠNOU HLÁŠKU O NEÚSPĚCHU. Obrazovka po `confirm` rovnou
    // navigovala na výsledek, jenže import byl v tu chvíli ve stavu `importing`
    // a výsledková stránka každý neznámý stav překlápí na `failed`. Uživatel četl
    // „import neproběhl" u dávky, která se o tři vteřiny později zapsala celá.
    stubApi(['importing', 'importing', 'completed']);
    renderScreen(5);
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    // Nejdřív průběh. Hledá se věta z bloku průběhu, ne nadpis: „Zakládáme
    // kontakty" je zároveň popisek tlačítka během čekání, takže by shoda byla dvojí.
    expect(await screen.findByText(/dávka je na serveru a zpracovává se/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText(/nepodařilo uložit/i)).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    // Na výsledek se odejde teprve po koncovém stavu.
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(`/w/muj-projekt/contacts/import/${IMPORT_ID}`),
    );
  });

  it('když se stav dávky nepodaří zjistit, netvrdí selhání, ale nabídne výsledek', async () => {
    // Dotazování se vzdá, jenže kontakty už na serveru vznikají. Věta
    // „neuložilo se nic" by tady byla lež, po které uživatel vloží dávku znovu.
    stubApi(['importing']);
    renderScreen();
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    expect(await screen.findByText(/zpracování ještě běží/i)).toBeInTheDocument();
    expect(screen.getByText(/nic se neztratilo/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /otevřít výsledek/i }));
    expect(push).toHaveBeenCalledWith(`/w/muj-projekt/contacts/import/${IMPORT_ID}`);
  });

  it('selhání serveru se ohlásí a nezůstane jen v konzoli', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    renderScreen();
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nepodařilo uložit/i);
    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it('nepotvrdí import, když hlavička od serveru nesedí na čekané sloupce', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.endsWith('/preview')) {
          return new Response(JSON.stringify({ header: ['email;first_name;last_name'] }), {
            status: 200,
          });
        }
        return new Response(JSON.stringify({ id: IMPORT_ID }), { status: 202 });
      }),
    );
    renderScreen();
    await type('jana@example.com; Jana');

    await userEvent.click(screen.getByRole('button', { name: /uložit 1 kontakt/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/nepodařilo uložit/i);
    // Žádné potvrzení: rozsypané sloupce se nesmí naimportovat.
    expect(calls.some((url) => url.endsWith('/confirm'))).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });
});
