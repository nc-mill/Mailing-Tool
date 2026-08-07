import { expect, type Page } from '@playwright/test';

/**
 * Seznam odběratelů a jeho počty.
 *
 * PROČ JE SEZNAM VE ZLATÉ CESTĚ. Do produktu se odběratelé dostávají dvěma
 * cestami: importem a přihlášením přes formulář. Zlatá cesta uměla jen import,
 * takže o druhé cestě netvrdila nic, přestože právě tou chodí lidé z webu
 * a je na ní celý zákonný doklad souhlasu.
 *
 * Počty na detailu seznamu (`list-counts`) jsou nejlevnější poctivá kontrola
 * dvojího potvrzení: po odeslání formuláře musí být jeden ČEKAJÍCÍ a nula
 * potvrzených, po kliknutí na odkaz naopak. Kdyby se přihlášení počítalo hned,
 * je to vidět na prvním z těch dvou měření. Týž počet doloží i odhlášení:
 * po kliknutí na odhlašovací odkaz musí o jednoho klesnout.
 *
 * PRACUJE SE S VÝCHOZÍM SEZNAMEM PROJEKTU, nezakládá se nový. Kampaň si bere
 * seznam pro odhlášení z projektu, takže kdyby přihlášený člověk seděl jinde,
 * odhlašovací odkaz z kampaně by mířil na seznam, ve kterém není, a test by
 * hlásil vadu tam, kde je jen špatně postavený scénář.
 */
export type ListCounts = { confirmed: number; pending: number };

export class ListPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  /** Adresa detailu, doplněná při prvním otevření. */
  private detailUrl: string | null = null;

  /**
   * Založí seznam s dvojím potvrzením.
   *
   * SCÉNÁŘ HO ZAKLÁDAT MUSÍ, i když by neměl. Projekt vzniklý PRŮVODCEM PRVNÍM
   * SPUŠTĚNÍM nemá žádný seznam: `identity/setup.ts` vloží uživatele, projekt
   * a členství, ale výchozí seznam nezaloží, ačkoli `createWorkspace` ve
   * `workspace-service.ts` ho u každého dalšího projektu zakládá. Ověřeno
   * dotazem do databáze čerstvé instalace: tabulka `lists` má nula řádků.
   * Zapsáno jako nález; test se tomu přizpůsobuje, opravovat produkt mu
   * nepřísluší.
   */
  async createWithDoubleOptIn(name: string): Promise<void> {
    await this.page.goto(`/w/${this.slug}/lists/new`);

    await this.page.getByTestId('new-list-name').fill(name);
    // Dvojí potvrzení je sice výchozí volba, ale vybírá se výslovně: kdyby se
    // výchozí hodnota jednou obrátila, test má spadnout na tom, co měří, a ne
    // tiše přejít na jednokrokové přihlášení.
    await this.page.getByRole('radio', { name: 'Vyžádat potvrzení e-mailem' }).click();
    await this.page.getByTestId('new-list-submit').click();

    await this.page.waitForURL(/\/lists\/[0-9a-f-]{36}$/i, { timeout: 30_000 });
    await expect(this.page.getByRole('heading', { name })).toBeVisible();
    this.detailUrl = this.page.url();
  }

  /**
   * Seznam musí opravdu vyžadovat potvrzení e-mailem.
   *
   * Bez téhle kontroly by celý krok s dvojím potvrzením mohl projít i na
   * seznamu přepnutém na „Přihlásit rovnou", kde se žádný potvrzovací e-mail
   * neposílá a čekající stav nevzniká.
   */
  async expectDoubleOptIn(): Promise<void> {
    await expect(
      this.page.getByRole('radio', { name: 'Vyžádat potvrzení e-mailem' }),
    ).toBeChecked();
  }

  /** Rozsah odhlášení, který si seznam nese. Od 7. 8. se dá přepnout. */
  async expectUnsubscribeScope(scope: 'list' | 'global'): Promise<void> {
    const label = scope === 'list' ? 'Odhlásit jen z tohohle seznamu' : 'Odhlásit ze všech seznamů';
    await expect(this.page.getByRole('radio', { name: label })).toBeChecked();
  }

  /** Aktuální počty, načtené znovu ze serveru. */
  async readCounts(): Promise<ListCounts> {
    if (this.detailUrl === null) throw new Error('Seznam ještě nebyl otevřen.');
    await this.page.goto(this.detailUrl);
    return parseCounts(await this.page.getByTestId('list-counts').innerText());
  }

  /**
   * Počká, až počty na detailu odpovídají očekávání.
   *
   * Čeká se na STAV, ne na uplynulý čas: přihlášení i potvrzení jdou veřejnou
   * trasou mimo přihlášenou relaci, takže první načtení detailu může ještě
   * ukazovat starý stav.
   */
  async expectCounts(counts: ListCounts): Promise<void> {
    await expect
      .poll(async () => await this.readCounts(), {
        timeout: 60_000,
        message:
          `Detail seznamu neukázal ${counts.confirmed} potvrzených ` +
          `a ${counts.pending} čekajících`,
      })
      .toEqual(counts);
  }
}

/**
 * „1 potvrzený kontakt · nikdo nečeká na potvrzení" na dvojici čísel.
 *
 * Čísla se z věty VYTAHUJÍ, neopisuje se celá: množné číslo má v češtině pět
 * tvarů a nula je vyjádřená slovem („Žádný potvrzený kontakt", „nikdo nečeká
 * na potvrzení"), takže doslovná shoda by se rozbila při každé změně počtu.
 */
export function parseCounts(meta: string): ListCounts {
  const [confirmedPart = '', pendingPart = ''] = meta.split('·');
  return { confirmed: leadingNumber(confirmedPart), pending: leadingNumber(pendingPart) };
}

function leadingNumber(part: string): number {
  const digits = part.match(/\d+/)?.[0];
  return digits === undefined ? 0 : Number(digits);
}
