import { expect, type Page } from '@playwright/test';

/**
 * Veřejné stránky, které vidí ODBĚRATEL, ne uživatel produktu: přihlašovací
 * formulář, potvrzení přihlášení a odhlášení.
 *
 * Všechny tři leží mimo přihlášenou část aplikace a mimo routování s jazykem,
 * takže se na ně chodí obyčejným `goto` na absolutní adresu z e-mailu. Je to
 * záměr: kdo klikne na odkaz v e-mailu, žádnou relaci nemá.
 */
export class PublicPages {
  constructor(private readonly page: Page) {}

  /**
   * Odešle veřejný formulář a ověří, že se produkt přiznal k odeslanému e-mailu.
   *
   * ČEKÁNÍ PŘED ODESLÁNÍM NENÍ OŠETŘENÍ ČASOVÁNÍ, JE TO PRAVIDLO PRODUKTU.
   * Formulář má časovou past: odeslání dřív než za `min_fill_seconds` (výchozí
   * dvě sekundy) se TIŠE zahodí a stránka přesto poděkuje. Bez téhle pauzy
   * skončí přihlášení jako `form_submissions.status = 'dropped'` s
   * `error_code = 'too_fast'`, žádný kontakt nevznikne a žádný potvrzovací
   * e-mail neodejde, přestože obrazovka tvrdí opak. Naměřeno na běžící
   * instalaci, doslovný řádek z databáze.
   *
   * Čeká se DÉLE než minimum, ne přesně na něj: hranice je nastavitelná na
   * formuláři a test nemá stát na její výchozí hodnotě.
   */
  async submitSubscribeForm(hostedUrl: string, email: string): Promise<void> {
    await this.page.goto(hostedUrl);

    // Formulář je obyčejné HTML bez skriptu, pole nese `type="email"`. Kotví se
    // přes typ, ne přes popisek: popisky polí si mění správce formuláře.
    const field = this.page.locator('input[type=email]').first();
    await expect(field).toBeVisible();
    await field.fill(email);

    await this.page.waitForTimeout(4_000);
    await this.page.getByRole('button', { name: 'Přihlásit se k odběru' }).click();

    await expect(this.page.getByText(/Poslali jsme vám e-mail s odkazem/)).toBeVisible({
      timeout: 30_000,
    });
  }

  /**
   * Dokončí dvojí potvrzení odkazem z e-mailu.
   *
   * ZVLÁDÁ OBA REŽIMY, a není to opatrnost navíc. Nový seznam se zakládá
   * v režimu „jedním kliknutím" (`DEFAULT_CONFIRMATION_MODE = 'one_step'`),
   * kde stránka formulář odešle sama skriptem a rovnou ukáže potvrzení;
   * v režimu „kliknutím a potvrzením na stránce" čeká na tlačítko. Test se
   * proto ptá, co je na obrazovce, místo aby jeden z těch dvou tvarů
   * předpokládal.
   *
   * Společné je to podstatné: potvrzuje POST, nikdy GET. Firemní bezpečnostní
   * skenery odkazy v e-mailech samy proklikávají, a kdyby přihlášení dokončilo
   * pouhé otevření, potvrzení by nedokládalo souhlas člověka.
   */
  async confirmSubscription(confirmUrl: string): Promise<void> {
    await this.page.goto(confirmUrl);

    const done = this.page.getByText(/Hotovo, přihlášení je potvrzené/);
    const confirmButton = this.page.getByRole('button', { name: 'Potvrdit přihlášení' });

    await expect(done.or(confirmButton).first()).toBeVisible({ timeout: 30_000 });
    if (await confirmButton.isVisible()) await confirmButton.click();

    await expect(done).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Odhlášení odkazem z doručené kampaně.
   *
   * ROZSAH SE NEPŘEDPOKLÁDÁ, ČTE SE ZE STRÁNKY a pak se ověří, že výsledek
   * odpovídá slibu. Odhlášení umí od 7. 8. obojí, jeden seznam i všechno,
   * a rozhoduje o tom nastavení seznamu. Tvrdit „už vám nic nepošleme"
   * a odhlásit přitom z jednoho seznamu je nepravda, kvůli které příjemce
   * u druhého e-mailu sáhne po tlačítku spam; a naopak tvrdit „ostatní e-maily
   * vám budou chodit dál" a odhlásit ze všeho je porušení jeho volby.
   */
  async unsubscribe(unsubscribeUrl: string): Promise<void> {
    await this.page.goto(unsubscribeUrl);

    // GET NIC NEODHLAŠUJE. Stránka se musí nejdřív zeptat, jinak by odhlášení
    // udělal každý skener, který odkaz v e-mailu jen otevře.
    await expect(this.page.getByRole('heading', { name: /Odhlášení z e-mailů od/ })).toBeVisible();

    const scopeSentence = this.page.getByText(
      /Odhlašujete se ze seznamu|Odhlašujete se ze všech e-mailů/,
    );
    await expect(scopeSentence).toBeVisible();
    const scopedToOneList = (await scopeSentence.innerText()).includes('ze seznamu');

    await this.page.getByRole('button', { name: 'Odhlásit se' }).click();

    // Potvrzení musí mluvit o TÉMŽE rozsahu, o jakém mluvila otázka.
    await expect(
      this.page.getByRole('heading', {
        name: scopedToOneList
          ? /^Hotovo, ze seznamu .* jsme vás odhlásili/
          : /^Hotovo, už vám nic nepošleme/,
      }),
    ).toBeVisible({ timeout: 30_000 });
  }
}
