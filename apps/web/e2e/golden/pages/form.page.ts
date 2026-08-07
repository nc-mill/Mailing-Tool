import { expect, type Page } from '@playwright/test';
import { chooseOption } from './controls';

/**
 * Přihlašovací formulář: založení v administraci a jeho VEŘEJNÁ adresa.
 *
 * Veřejná adresa se z obrazovky ČTE, neskládá se v testu. Formulář má vlastní
 * veřejný identifikátor, který není slugem z databáze (`features/forms/types.ts`),
 * takže kdyby si ho test odvozoval z názvu, měřil by svůj vlastní výpočet
 * místo toho, co produkt člověku ukáže.
 */
export class FormPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /**
   * Založí formulář nad daným seznamem a vrátí jeho veřejnou adresu.
   *
   * JEDEN KROK, ne dva. Založení totiž obrazovku rovnou odveze do editoru
   * formuláře, takže řádek v tabulce, na který dřívější znění čekalo, nikdy
   * nenaskočí: běh na něm skončil vypršením limitu, přestože formulář vznikl
   * a editor s ním byl na obrazovce. Ověřeno snímkem z pádu.
   */
  async createForList(formName: string, listName: string): Promise<string> {
    await this.page.goto(`/w/${this.slug}/forms`);
    await this.page.getByTestId('create-form').click();

    await this.page.getByTestId('form-name').fill(formName);
    // Cílový seznam je výběr z design systému, ne nativní `<select>`, a přístupné
    // jméno nese `aria-label` na nabídce, ne popisek. `chooseOption` zvládne obojí.
    await chooseOption(this.page, 'Do kterého seznamu bude zapisovat?', listName);
    await this.page.getByTestId('create-form-submit').click();

    // Čeká se na to, co nastane dřív, aby se selhání založení nepoznalo až
    // vypršením limitu.
    const opened = this.page
      .waitForURL(/\/forms\/[0-9a-f-]{36}$/i, { timeout: 30_000 })
      .then(() => 'ok' as const);
    const failed = this.page
      .getByTestId('create-form-error')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => 'failed' as const);

    if ((await Promise.race([opened, failed])) === 'failed') {
      throw new Error(
        `Formulář se nepodařilo založit: ${(
          await this.page.getByTestId('create-form-error').innerText()
        ).trim()}`,
      );
    }

    await expect(this.page.getByRole('heading', { name: formName })).toBeVisible();

    const link = this.page.getByTestId('open-public-form');
    await expect(link).toBeVisible();
    const href = await link.getAttribute('href');
    if (href === null || href === '') {
      throw new Error('Odkaz na veřejný formulář nemá cíl.');
    }
    return href;
  }
}
