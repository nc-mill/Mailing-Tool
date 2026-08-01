import { describe, expect, it, vi } from 'vitest';
import { runConversation } from './chat';
import { buildSystemPrompt } from './prompt';
import { buildTools } from './tools/index';

/**
 * Kritérium 70. Data kontaktů se do promptu nedostanou ani omylem: nástroj
 * `listMergeTags` smí vrátit jen názvy polí, popisky a **ukázkovou** hodnotu,
 * která nepochází z databáze kontaktů.
 */
describe('do promptu nejdou data kontaktů', () => {
  const contactsInDatabase = {
    email: 'jana.novakova@example.cz',
    firstName: 'Jana',
    lastName: 'Nováková',
    phone: '+420601123456',
  };

  /**
   * Katalog polí tak, jak ho dodává P07: definice, ne hodnoty. Do
   * `sampleContact` schválně dáme skutečná data kontaktu, abychom ověřili, že
   * se do výstupu nedostanou ani omylem. Kdo je do nástroje začne propouštět,
   * shodí tenhle soubor.
   */
  const fieldCatalog = {
    fields: [
      { path: 'first_name', type: 'string', label: 'Křestní jméno' },
      { path: 'email', type: 'string', label: 'E-mail' },
      { path: 'phone', type: 'string', label: 'Telefon' },
    ],
    sampleContact: contactsInDatabase,
  };

  it('systémový prompt neobsahuje žádnou hodnotu z databáze', () => {
    const prompt = buildSystemPrompt({ language: 'cs', workspaceName: 'Kolo Shop' });
    for (const value of Object.values(contactsInDatabase)) {
      expect(prompt).not.toContain(value);
    }
  });

  /**
   * Nástroj se volá SKUTEČNÝ, ne jeho náhrada. Katalog polí se mu předává
   * osazený hodnotami z databáze, takže kdyby je `listMergeTags` propouštěl
   * do výstupu, test to pozná.
   *
   * Dřívější podoba tohohle testu injektovala `listMergeTags` jako `vi.fn()`
   * vracející bezpečná data a pak ověřovala, že jsou bezpečná. To netestovalo
   * nic: skutečná implementace se ho neúčastnila.
   */
  it('výstup listMergeTags nese cesty a popisky, ne hodnoty kontaktů', async () => {
    const tools = buildTools({
      workspaceId: 'w1',
      templateId: 't1',
      language: 'cs',
      userUrls: new Set(),
      fieldCatalog,
      startBrandExtraction: vi.fn(),
      composeTemplate: vi.fn(),
      writeCopy: vi.fn(),
      suggestSubject: vi.fn(),
    });

    const result = await tools.listMergeTags.execute();
    const serialized = JSON.stringify(result);

    for (const value of Object.values(contactsInDatabase)) {
      expect(serialized, `hodnota ${value} unikla do výstupu nástroje`).not.toContain(value);
    }
    // Názvy polí naopak ve výstupu být musí, jinak by je model vymýšlel.
    expect(serialized).toContain('contact.first_name');
  });

  /**
   * Kritérium 70 doslova: „test zachytí odchozí požadavek a ověří, že
   * neobsahuje adresu ani jméno".
   *
   * Zachytává se na hranici, za kterou prompt odchází do AI SDK a odtud
   * providerovi, tedy na `deps.streamConversation`. Celý požadavek sestavuje
   * produkční `runConversation`, test do něj nedodává nic než katalog polí
   * osazený skutečnými daty kontaktu.
   *
   * Plán tady počítal s `MockLanguageModelV4` z podcesty `ai/test`. Balíček
   * `ai` zatím není v repozitáři nainstalovaný, takže se zachytává o jednu
   * vrstvu výš. Měřená vlastnost je stejná: sestavený systémový prompt,
   * zprávy i popisy nástrojů projdou testem v té podobě, v jaké by odešly.
   */
  it('prompt zachycený na hranici modelu neobsahuje žádnou hodnotu z databáze', async () => {
    const captured: string[] = [];

    await runConversation(
      {
        workspaceId: 'w1',
        workspaceName: 'Kolo Shop',
        templateId: 't1',
        language: 'cs',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Napiš newsletter' }] },
      },
      {
        model: {},
        fieldCatalog,
        loadHistory: vi.fn(async () => []),
        appendMessage: vi.fn(async () => {}),
        recordUsage: vi.fn(async () => {}),
        streamConversation: (args) => {
          // Celý požadavek tak, jak by odešel providerovi: systémový prompt,
          // zprávy i definice nástrojů včetně jejich popisů.
          captured.push(
            JSON.stringify({
              system: args.system,
              messages: args.messages,
              tools: Object.entries(args.tools).map(([name, tool]) => ({
                name,
                description: tool.description,
              })),
            }),
          );
          return { finishReason: 'stop' };
        },
        toolImplementations: {
          startBrandExtraction: vi.fn(),
          composeTemplate: vi.fn(),
          writeCopy: vi.fn(),
          suggestSubject: vi.fn(),
        },
      },
    );

    expect(captured.length, 'model se vůbec nezavolal, test by neměl co ověřovat').toBeGreaterThan(
      0,
    );

    const body = captured.join('\n');
    for (const value of Object.values(contactsInDatabase)) {
      expect(body, `hodnota ${value} se dostala do promptu`).not.toContain(value);
    }
  });

  /**
   * Kritérium 70 má i druhou půlku: nástroj, který model zavolá, se do
   * konverzace vrací a stává se součástí dalšího promptu. Ověřuje se proto
   * i výstup nástroje sestavený produkčním kódem uvnitř `runConversation`.
   */
  it('nástroje sestavené v runConversation vrací merge tagy bez hodnot kontaktů', async () => {
    let tools: Record<string, { execute: () => Promise<unknown> }> = {};

    await runConversation(
      {
        workspaceId: 'w1',
        workspaceName: 'Kolo Shop',
        templateId: 't1',
        language: 'cs',
        userMessage: { role: 'user', parts: [{ type: 'text', text: 'Napiš newsletter' }] },
      },
      {
        model: {},
        fieldCatalog,
        loadHistory: vi.fn(async () => []),
        appendMessage: vi.fn(async () => {}),
        recordUsage: vi.fn(async () => {}),
        streamConversation: (args) => {
          tools = args.tools as unknown as typeof tools;
          return { finishReason: 'stop' };
        },
        toolImplementations: {
          startBrandExtraction: vi.fn(),
          composeTemplate: vi.fn(),
          writeCopy: vi.fn(),
          suggestSubject: vi.fn(),
        },
      },
    );

    const serialized = JSON.stringify(await tools.listMergeTags!.execute());
    for (const value of Object.values(contactsInDatabase)) {
      expect(serialized, `hodnota ${value} se dostala do výsledku nástroje`).not.toContain(value);
    }
    expect(serialized).toContain('contact.first_name');
  });
});
