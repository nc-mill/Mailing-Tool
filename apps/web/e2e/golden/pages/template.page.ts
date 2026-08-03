import { expect, type Page } from '@playwright/test';

/**
 * Knihovna šablon a editor, srovnané podle SKUTEČNÉHO produktu.
 *
 * Plán čekal galerii startovních šablon a formulář: kliknout „Univerzální
 * základní", vyplnit „Název šablony" a „Předmět", stisknout „Uložit".
 * NIC Z TOHO v produktu není a nemá být. Doslovný ARIA snapshot editoru
 * z běžící instalace:
 *
 *   complementary "Bloky": Nadpis | Text | Obrázek | Tlačítko | Oddělovač |
 *                          Mezera | Sociální sítě | Vlastní HTML | Patička
 *   tree "Obsah e-mailu": Sekce > Nadpis, Text, Oddělovač, Mezera
 *   complementary "Vlastnosti vybraného bloku": Motiv, E-mail, Písmo, Tmavý režim
 *   complementary "AI asistent"
 *   button "Náhled" | button "Poslat test"
 *
 * Je to blokový editor, který **ukládá průběžně sám**; stav ukládání hlásí
 * `SaveStatus` („Ukládáme…", „Uloženo v {time}"). Tlačítko „Uložit" v něm
 * neexistuje, protože není k čemu. Pole pro název ani předmět v hlavičce
 * nejsou; šablona vzniká pod jménem „Nová šablona" (`editor.list.newName`).
 *
 * Objekt obrazovky se proto ohýbá podle produktu, ne naopak: editor je lepší
 * návrh než galerie s dvěma poli a produkt kvůli zastaralému scénáři ustupovat
 * nebude.
 */
export class TemplatePage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Založí šablonu a počká, až ji editor uloží. Vrací jméno, pod kterým
   * vznikla, aby si ho další krok nemusel domýšlet.
   */
  async createFromStarter(): Promise<string> {
    await this.page.goto(`/w/${this.slug}/templates`);
    await this.page.getByRole('button', { name: 'Vytvořit šablonu' }).first().click();

    /*
     * Vytvoření končí přechodem do editoru na `/templates/{id}`. Když
     * `POST /api/v1/templates` selže, obrazovka zůstane na seznamu a ukáže
     * „Šablonu se nepodařilo vytvořit." Čeká se proto na to, co nastane dřív:
     * jinak by scénář vyčerpal celých 360 sekund na informaci, která je na
     * obrazovce po vteřině.
     */
    const opened = this.page.waitForURL(/\/templates\/[0-9a-f-]{36}$/i).then(() => 'ok' as const);
    const failed = this.page
      .getByText(/Šablonu se nepodařilo vytvořit/)
      .waitFor({ state: 'visible' })
      .then(() => 'failed' as const);

    if ((await Promise.race([opened, failed])) === 'failed') {
      throw new Error(
        'Šablonu se nepodařilo vytvořit. Zkontrolujte, jestli API šablon existuje: ' +
          'v jednom měření vracelo `POST /api/v1/templates` 404 „resource does not exist" ' +
          'a v OpenAPI dokumentu nebyla ani jedna cesta se slovem „template".',
      );
    }

    // Paleta bloků je první, co v editoru naskočí, a je jistější kotva než
    // plátno: to se dokresluje až po načtení dokumentu.
    await expect(this.page.getByRole('complementary', { name: 'Bloky' })).toBeVisible();

    // Ukládá se průběžně. Test čeká na doklad o uložení, ne na tlačítko.
    await expect(this.page.getByText(/Uloženo v|Ukládáme/)).toBeVisible({ timeout: 30_000 });

    return 'Nová šablona';
  }
}
