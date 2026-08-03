import { expect, test } from '@playwright/test';
import { freshInstallation } from '../fixtures/installation';
import { SetupPage } from '../pages/setup.page';
import { OnboardingPage } from '../pages/onboarding.page';

test('ukázková data jde nahrát, hromadně vybrat i beze zbytku smazat', async ({ page }) => {
  test.slow();
  // Scénář zakládá účet, takže potřebuje instalaci bez uživatele.
  await freshInstallation();

  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const onboarding = new OnboardingPage(page, slug);
  await onboarding.openDashboard();

  // Nahrání ze čtvrté cesty prázdného stavu kontaktů. Panel onboardingu, se
  // kterým počítal plán, ukázková data nabízet nikdy neuměl.
  await onboarding.loadDemoData();

  await onboarding.openDashboard();
  await expect(onboarding.demoBanner).toBeVisible();
  await expect(page.getByText(/50 ukázkových kontaktů/)).toBeVisible();

  // Krok „Přidejte kontakty" zůstává neodškrtnutý, protože ukázková data
  // nejsou nastavení, jen ukázka.
  await onboarding.expectStepNotDone('contacts');

  // Hromadný výběr přes štítek, rozhodnutí zadavatele Z2.
  await page.goto(`/w/${slug}/contacts?tag=ukazkova-data`);
  await expect(page.getByRole('row')).toHaveCount(51); // 50 řádků plus hlavička
  await page.getByRole('checkbox', { name: /Vybrat vše/ }).check();
  await expect(page.getByText(/Vybráno 50/)).toBeVisible();

  // Odstranění jedním tlačítkem s potvrzením N2.
  await onboarding.openDashboard();
  await onboarding.removeDemoData();
  await expect(page.getByText('Ukázková data jsou pryč.')).toBeVisible();

  await onboarding.openDashboard();
  await expect(onboarding.demoBanner).toBeHidden();
  await page.goto(`/w/${slug}/contacts`);
  await expect(page.getByText(/Zatím tu nejsou žádné kontakty/)).toBeVisible();

  // Po smazání jde sada nahrát znovu. Dialog o odstranění to slibuje větou
  // „Ukázková data si můžete kdykoli nahrát znovu.", takže se to ověřuje.
  await onboarding.loadDemoData();
  await onboarding.openDashboard();
  await expect(onboarding.demoBanner).toBeVisible();

  // Rozhraní I→P13.1: kontrolní seznam kampaně musí říct, že publikum obsahuje
  // jen ukázkové kontakty. Když tohle spadne, patří oprava do P13.
  await page.goto(`/w/${slug}/campaigns`);
  await page.getByRole('button', { name: 'Vytvořit kampaň' }).first().click();
  await expect(
    page
      .getByText(/Publikum obsahuje jen ukázkové kontakty/)
      .or(page.getByTestId('preflight-demo-only')),
  ).toBeVisible({ timeout: 30_000 });
});

/*
 * Kontrolní seznam kampaně (rozhraní I→P13.1) byl původně samostatný test,
 * který začínal `page.goto('/')`. Nemohl projít nikdy: každý test dostává
 * čistý kontext prohlížeče, takže nebyl přihlášený a na kořeni skončil na
 * přihlašovací obrazovce. Kontrola je proto na konci scénáře, který ukázková
 * data nahrál a tedy má co kontrolovat.
 */
