import { expect, type Page } from '@playwright/test';

/**
 * Text, který scénář do šablony napíše.
 *
 * Věta začíná „Dobrý den", protože právě na ni se pak ptá kontrola doručené
 * zprávy: je to nejlevnější doklad, že obsah šablony opravdu doputoval až
 * do e-mailu, který dostal příjemce.
 */
const TEMPLATE_BODY = 'Dobrý den, posíláme novinky z našeho e-shopu.';

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
 *   tree "Obsah e-mailu": Sekce > Patička (nová šablona je jinak PRÁZDNÁ)
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

    /*
     * NEČEKÁ se na text „Uloženo v…".
     *
     * Editor ukládá průběžně, ale u ČERSTVĚ otevřené šablony nemá co hlásit:
     * `SaveStatus` skládá text ze `status`, `isDirty` a `savedAt`, a dokud
     * uživatel nic nezmění, jsou to `idle`, `false` a `null`, takže vypíše
     * prázdný řetězec. Dřívější znění na ten text čekalo a padalo, přestože
     * šablona vznikla a editor běžel.
     *
     * Doklad o vzniku je adresa s jejím id (výš) a to, že ji `openLatest()`
     * najde v seznamu šablon. Ukládání obsahu ověřuje `saveDesign` v jednotkových
     * testech portů, ne tenhle krok.
     */
    await this.writeBody();
    return 'Nová šablona';
  }

  /**
   * Napíše do šablony text.
   *
   * MUSÍ TO UDĚLAT SCÉNÁŘ. Nová šablona vzniká PRÁZDNÁ: v dokumentu je jedna
   * sekce a v ní jediný blok, patička (ověřeno výpisem `templates.design`
   * z běžící instalace). Prázdný e-mail se ale neodesílá, a je to správně:
   * zkušební odeslání odmítne `test_template_empty` s větou „E-mail je zatím
   * prázdný: kromě patičky v něm není žádný obsah." Dřívější znění tenhle krok
   * nemělo a spoléhalo na startovní šablonu s obsahem, která v produktu není.
   *
   * Psaní textu do e-mailu je navíc přesně ten krok zlaté cesty, který se
   * jmenuje „vytvoření šablony". Bez něj by se přeskočil.
   */
  private async writeBody(): Promise<void> {
    await this.page
      .getByRole('complementary', { name: 'Bloky' })
      .getByRole('button', { name: 'Text', exact: true })
      .click();

    // Vložený blok je prázdný odstavec a editor na něj posadí kurzor. Text se
    // píše do pole s přístupným jménem „Text bloku" (`role="textbox"`, který
    // ProseMirroru dodává `rich-text-field.tsx`).
    const body = this.page.getByRole('textbox', { name: 'Text bloku' }).first();
    await expect(body).toBeVisible();
    await body.click();
    await body.pressSequentially(TEMPLATE_BODY);

    // Editor ukládá průběžně. Čeká se na jeho vlastní hlášení, ne na pauzu:
    // bez uloženého obsahu by kampaň převzala prázdný dokument.
    await expect(this.page.getByText(/Uloženo/).first()).toBeVisible({ timeout: 30_000 });
  }

  /** Otevře poslední založenou šablonu ze seznamu. */
  async openLatest(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/templates`);
    await this.page.getByRole('link', { name: 'Nová šablona' }).first().click();
    await this.page.waitForURL(/\/templates\/[0-9a-f-]{36}$/i);
    await expect(this.page.getByRole('complementary', { name: 'Bloky' })).toBeVisible();
  }

  /**
   * Testovací odeslání.
   *
   * Bydlí v EDITORU ŠABLONY, ne u kampaně, jak čekal plán: obrazovka kampaně
   * ani její kontrolní seznam žádné „Poslat test" nemají. Dává to smysl,
   * protože testuje obsah, a ten nese šablona.
   *
   * Doslovný tvar dialogu z produktu (`features/editor/components/test-send`):
   *   DialogTitle "Testovací e-mail"
   *   textarea aria-label "Adresy"   (víc adres se odděluje čárkou, nejvýš pět)
   *   switch "Přidat do předmětu značku TEST"
   *   button "Poslat test"
   * Po odeslání se ukáže „Testovací e-mail odešel."
   */
  async sendTestTo(email: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Poslat test' }).first().click();

    const dialog = this.page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Adresy').fill(email);
    await dialog.getByRole('button', { name: 'Poslat test' }).click();

    /*
     * Čeká se na to, co nastane dřív: potvrzení, nebo chybová hláška.
     *
     * Dialog vypisuje nezdar do `role="alert"` (limit testovacích e-mailů,
     * nepřipravený odesílací účet, cokoli dalšího). Holé čekání na potvrzení
     * by z toho udělalo obyčejné vypršení bez jediné stopy po příčině.
     */
    const success = dialog
      .getByText(/Testovací e-mail odešel/)
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'ok' as const);
    const failure = dialog
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'failed' as const);

    if ((await Promise.race([success, failure])) === 'failed') {
      throw new Error(
        `Testovací e-mail neodešel: ${(await dialog.getByRole('alert').innerText()).trim()}`,
      );
    }
  }
}
