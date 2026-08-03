import { expect, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data';

/**
 * Segment builder, srovnaný podle SKUTEČNÉ obrazovky.
 *
 * Rozdíly proti plánu, každý ověřený v prohlížeči proti běžící instalaci:
 *
 * 1. Cesta je `/segments`, ne `/contacts/segments`. Shodují se na tom všechny
 *    tři zdroje: plán P11 (kapitola 12, `apps/web/src/app/[locale]/w/[slug]/segments/`),
 *    navigační rejstřík (`contacts-segments` → `/segments`) i skutečný adresář
 *    stránek. `/contacts/segments` neexistuje a nikdy neexistovalo, měl ho jen
 *    tenhle objekt obrazovky.
 * 2. Pole se jmenuje „Datum vytvoření", ne „Přidán".
 * 3. Operátor se jmenuje „je za posledních", ne „za posledních N dní".
 * 4. Živý počet PRODUKT MÁ, jen nemá `data-testid="segment-live-count"`.
 *    Objeví se sám, jakmile je podmínka úplná; do té doby je na jeho místě
 *    „Ještě jsme nepočítali" s tlačítkem „Spočítat". Testovací háček se kvůli
 *    tomu do produktu nedoplňoval: `role="status"` je součást přístupnosti,
 *    takže je stabilnější než atribut zavedený jen kvůli testu.
 * 5. Po uložení se přechází rovnou na seznam segmentů. Hlášku „Segment uložen",
 *    kterou čekal plán, produkt neukazuje.
 */
export class SegmentPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createActiveNinetyDays(): Promise<number> {
    await this.page.goto(`/w/${this.slug}/segments`);
    await this.page.getByRole('button', { name: 'Postavit vlastní segment' }).first().click();

    await this.page.getByLabel('Název segmentu').fill(CAMPAIGN.segmentName);
    await this.page.getByRole('button', { name: 'Přidat podmínku' }).click();
    await this.page.getByLabel('Pole').selectOption({ label: 'Datum vytvoření' });
    await this.page.getByLabel('Podmínka').selectOption({ label: 'je za posledních' });
    await this.page.getByLabel('Hodnota').fill('90');

    // Počet se dopočítá sám, jakmile je podmínka úplná. Čeká se proto na číslo,
    // ne na kliknutí: kdyby se tu tisklo „Spočítat", test by měřil obcházku
    // kolem živého počtu místo živého počtu.
    const count = this.page.getByRole('status').first();
    await expect(count).toBeVisible();
    await expect(count).not.toHaveText('');
    const text = (await count.textContent()) ?? '0';

    await this.page.getByRole('button', { name: 'Uložit segment' }).click();
    await expect(this.page.getByRole('link', { name: CAMPAIGN.segmentName })).toBeVisible();

    return Number(text.replace(/\D/g, ''));
  }
}
