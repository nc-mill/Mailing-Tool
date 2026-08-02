import { expect, type Locator, type Page } from '@playwright/test';

/** Pět kroků panelu podle `packages/core/src/onboarding`. */
export type OnboardingStepId = 'sending' | 'contacts' | 'template' | 'testSend' | 'firstCampaign';

export class OnboardingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async openDashboard(): Promise<void> {
    await this.page.goto(`/w/${this.slug}`);
  }

  get panel(): Locator {
    return this.page.getByRole('region', { name: 'Vaše první kampaň' });
  }

  /**
   * Krok panelu podle jeho identifikátoru, ne podle textu.
   *
   * ODCHYLKA OD PLÁNU, vynucená skutečným katalogem. Plán píše kroky jako
   * „Nastavte odesílání", „Připravte e-mail" a „Pošlete si test", jenže
   * `packages/i18n/messages/cs/onboarding.json` má jiná znění a zdrojem pravdy
   * je katalog, ne plán. Mapování je tady na jednom místě, takže scénář zůstává
   * čitelný a přejmenování textu se opraví jedním řádkem.
   */
  private static readonly STEP_TITLES = {
    sending: 'Připojte odesílání',
    contacts: 'Přidejte kontakty',
    template: 'Vytvořte šablonu',
    testSend: 'Pošlete si zkušební e-mail',
    firstCampaign: 'Odešlete první kampaň',
  } as const satisfies Record<string, string>;

  step(step: OnboardingStepId): Locator {
    return this.panel.getByRole('listitem').filter({ hasText: OnboardingPage.STEP_TITLES[step] });
  }

  async expectStepDone(step: OnboardingStepId): Promise<void> {
    await expect(this.step(step)).toContainText('hotovo');
  }

  async expectStepNotDone(step: OnboardingStepId): Promise<void> {
    await expect(this.step(step)).not.toContainText('hotovo');
  }

  get demoBanner(): Locator {
    return this.page.getByText('V projektu jsou ukázková data.');
  }

  async loadDemoData(): Promise<void> {
    await this.page.getByRole('link', { name: 'Ukázková' }).click();
    await this.page.getByRole('button', { name: 'Nahrát ukázková data' }).click();
  }

  async removeDemoData(): Promise<void> {
    await this.page.getByRole('button', { name: 'Odstranit' }).click();
    await this.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Odstranit ukázková data' })
      .click();
  }
}
