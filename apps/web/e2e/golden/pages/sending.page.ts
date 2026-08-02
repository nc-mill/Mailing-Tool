import { expect, type Locator, type Page } from '@playwright/test';
import { SMTP, VERIFIED_RECIPIENT } from '../fixtures/test-data';
import { extractLink, waitForMessage } from '../fixtures/mailpit';
import { button, chooseOption, chooseRadio } from './controls';

export class SendingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async open(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/settings/sending`);
  }

  private get dialog(): Locator {
    return this.page.getByRole('dialog', { name: 'Nový odesílací účet' });
  }

  /**
   * Krok 2 demo skriptu ve variantě podle rozporu R2: doména se neověřuje,
   * zapíná se zkušební režim. DNS propagace trvá minuty až hodiny a test na ni
   * čekat nemůže.
   *
   * ODCHYLKA OD PLÁNU, vynucená skutečnou obrazovkou. Plán počítá s průvodcem
   * o čtyřech krocích, kde se mezi nimi kliká „Pokračovat" a je v něm
   * „Otestovat připojení" i „Odesílací adresa". Skutečnost je JEDEN dialog za
   * tlačítkem „Přidat odesílací účet", zakončený tlačítkem „Založit účet".
   * Doslovný ARIA snapshot varianty SMTP:
   *
   *   dialog "Nový odesílací účet"
   *     radiogroup "Typ účtu": radio "Amazon SES" | radio "Vlastní SMTP"
   *     textbox "Název účtu" / "Server" / "Uživatelské jméno" / "Heslo"
   *     combobox "Port" (587) / combobox "Šifrování" (STARTTLS)
   *     checkbox "Nastavit jako výchozí účet"
   *     button "Zrušit" / button "Založit účet"
   *
   * `Port` a `Šifrování` jsou výběry z design systému, ne textová pole, takže
   * se vybírají, nevyplňují.
   */
  async connectSmtpInTrialMode(): Promise<void> {
    await button(this.page, 'Přidat odesílací účet').click();
    await expect(this.dialog).toBeVisible();

    await chooseRadio(this.page, /Vlastní SMTP/);

    await this.dialog.getByLabel('Název účtu').fill(SMTP.accountName);
    await this.dialog.getByLabel('Server').fill(SMTP.host);
    await chooseOption(this.page, 'Port', SMTP.port);
    await this.dialog.getByLabel('Uživatelské jméno').fill(SMTP.username);
    await this.dialog.getByLabel('Heslo', { exact: true }).fill(SMTP.password);
    await chooseOption(this.page, 'Šifrování', SMTP.encryption);
    await this.dialog.getByRole('checkbox', { name: /výchozí účet/ }).check();

    await this.dialog.getByRole('button', { name: 'Založit účet' }).click();
    await expect(this.dialog).toBeHidden();
    await expect(this.page.getByText(SMTP.accountName).first()).toBeVisible();
  }

  /** Ověří jednu adresu potvrzovacím e-mailem z pasti. */
  async verifyRecipient(): Promise<void> {
    await button(this.page, 'Přidat ověřenou adresu').click();
    await this.page.getByLabel('E-mail').fill(VERIFIED_RECIPIENT);
    await button(this.page, 'Odeslat potvrzení').click();

    const message = await waitForMessage(VERIFIED_RECIPIENT);
    await this.page.goto(extractLink(message.html, '/verify-sender/'));
    await expect(this.page.getByText(/Adresa je ověřená/)).toBeVisible();
  }
}
