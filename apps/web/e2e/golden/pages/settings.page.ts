import { expect, type Page } from '@playwright/test';

/**
 * Obecné nastavení projektu, `/w/{slug}/settings/general`.
 *
 * Zlatou cestu zajímá jedno jediné pole: POŠTOVNÍ ADRESA ODESÍLATELE. Průvodce
 * prvním spuštěním ji nemá (má pět polí, viz `SetupPage`), takže po instalaci je
 * prázdná, a prázdná adresa je legitimní stav projektu, který se rozkoukává.
 * Jenže obchodní sdělení ji podle zákona nést musí, a dokud ji zlatá cesta
 * nevyplní, nemůže o patičce tvrdit vůbec nic: kontrola „adresa v patičce je
 * vyplněná" by měřila jen to, že ji uživatel nezadal.
 *
 * Vyplnění proto patří do scénáře jako krok, ne jako obcházka.
 */
export class SettingsPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async setPostalAddress(address: string): Promise<void> {
    await this.page.goto(`/w/${this.slug}/settings/general`);

    // Karta „Základní údaje" je `<section>` s přístupným jménem, takže se dá
    // adresovat jako oblast. Kotví se na ni, ne na `<form>`: hlásič „Uloženo"
    // stojí v hlavičce karty VEDLE formuláře, ne uvnitř něj, a uvnitř formuláře
    // by se nenašel. Na obrazovce je přitom tlačítek „Uložit" víc.
    const card = this.page.getByRole('region', { name: 'Základní údaje' });

    const field = card.getByLabel('Poštovní adresa odesílatele');
    await expect(field).toBeVisible();
    await field.fill(address);

    await card.getByRole('button', { name: /^Uložit/ }).click();

    // Uložení hlásí `role="status"` textem „Uloženo". Čeká se na doklad, ne na
    // kliknutí: bez toho by scénář jel dál nad neuloženou hodnotou a patička
    // by odešla prázdná ze zcela jiného důvodu, než jaký má test hlídat.
    await expect(card.getByText('Uloženo', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });
  }
}
