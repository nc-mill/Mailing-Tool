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

  /**
   * Id projektu pro volání API mimo prohlížeč.
   *
   * Bere se z `/api/v1/auth/me`, protože ta cesta je v `CONTEXT_FREE_PREFIXES`,
   * takže jako jediná projektovou hlavičku nepotřebuje a nevznikne slepice
   * s vejcem. Ostatní cesty `/api/v1/**` bez `X-Workspace-Id` vracejí 404.
   */
  async workspaceId(): Promise<string> {
    const response = await this.page.request.get('/api/v1/auth/me');
    // Pole se jmenuje `memberships` a id projektu v něm je `workspace_id`.
    // `workspaces` s klíčem `id` vrací POUZE odpověď přihlášení, ne `/me`.
    const body = (await response.json()) as {
      memberships?: { workspace_id: string; slug: string }[];
    };
    const found = body.memberships?.find((m) => m.slug === this.slug) ?? body.memberships?.[0];
    if (found === undefined) {
      throw new Error(
        `Projekt ${this.slug} nemá id. /api/v1/auth/me vrátilo ${response.status()}: ` +
          `${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    return found.workspace_id;
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

  /**
   * Nahrání ukázkových dat z prázdného stavu kontaktů.
   *
   * ODCHYLKA OD PLÁNU, vynucená skutečnou obrazovkou. Plán čekal nabídku
   * v panelu onboardingu na přehledu („klikni odkaz Ukázková, pak tlačítko").
   * Panel takovou nabídku nemá a banner ukázkových dat se vykresluje JEDINĚ
   * tehdy, když už ukázková data v projektu jsou, takže uměl výhradně mazat.
   * Jediné místo, kde se dají nahrát, je čtvrtá cesta v prázdném stavu
   * kontaktů; do produktu ji bylo potřeba doplnit, protože znění pro ni
   * v katalogu leželo nepoužité (`contacts.list.emptySample`).
   */
  async loadDemoData(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/contacts`);
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
