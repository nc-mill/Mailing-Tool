import type { Page } from '@playwright/test';
import { ADMIN, PROJECT } from '../fixtures/test-data';
import { button, chooseOption, chooseRadio } from './controls';

export class SetupPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/setup');
  }

  /**
   * Průvodce prvním spuštěním.
   *
   * ODCHYLKA OD PLÁNU, vynucená skutečnou obrazovkou. Plán podle 8.1.2 čeká dva
   * kroky a osm polí. Doslovný ARIA snapshot běžící instalace ale ukazuje
   * JEDEN krok a pět polí:
   *
   *   heading "Založte si účet a první projekt"
   *   textbox "Jméno a příjmení" / "E-mail" / "Heslo" / "Název projektu"
   *   combobox "Jazyk rozhraní"
   *   button "Založit účet a projekt"
   *
   * „Jazyk e-mailů", „Časová zóna" ani přepínač oslovení na obrazovce nejsou
   * a tlačítka „Pokračovat" a „Vytvořit projekt" se jmenují jinak. Objekt
   * obrazovky se ohýbá podle produktu, ne naopak; chybějící pole jsou zapsaná
   * jako nález proti P06 v `docs/operations/p16-nalezy.md`.
   *
   * Volitelná pole se vyplní, jen když na obrazovce jsou, takže až je P06
   * doplní, tenhle objekt se měnit nemusí.
   */
  async createAdminAndProject(): Promise<string> {
    await this.page.getByLabel(/Jméno/).fill(ADMIN.name);
    await this.page.getByLabel('E-mail').fill(ADMIN.email);
    await this.page.getByLabel('Heslo', { exact: true }).fill(ADMIN.password);
    await this.page.getByLabel('Název projektu').fill(PROJECT.name);
    await chooseOption(this.page, /Jazyk/, ADMIN.locale);

    await this.fillIfPresent('Jazyk e-mailů', PROJECT.emailLocale);
    await this.fillIfPresent('Časová zóna', PROJECT.timezone);
    if ((await this.page.getByRole('radio', { name: PROJECT.addressForm }).count()) > 0) {
      await chooseRadio(this.page, PROJECT.addressForm);
    }

    await button(this.page, /Založit účet a projekt|Vytvořit projekt/).click();

    await this.page.waitForURL(/\/w\/[^/]+$/);
    const slug = this.page.url().match(/\/w\/([^/]+)/)?.[1];
    if (slug === undefined) throw new Error('Po vytvoření projektu se nečekaně změnila adresa.');
    return slug;
  }

  private async fillIfPresent(label: string, value: string): Promise<void> {
    if ((await this.page.getByLabel(label).count()) > 0) {
      await chooseOption(this.page, label, value);
    }
  }
}
