import { expect, test } from '@playwright/test';
import { SetupPage } from '../pages/setup.page';
import { OnboardingPage } from '../pages/onboarding.page';

test('ukázková data jde nahrát, hromadně vybrat i beze zbytku smazat', async ({ page }) => {
  test.slow();

  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const onboarding = new OnboardingPage(page, slug);
  await onboarding.openDashboard();

  // Nahrání z panelu onboardingu, kde jsou ukázková data rovnocennou nabídkou.
  await onboarding.loadDemoData();
  await expect(page.getByText('Ukázková data jsou v projektu.')).toBeVisible();

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

  // Po smazání jde sada nahrát znovu.
  await onboarding.openDashboard();
  await onboarding.loadDemoData();
  await expect(page.getByText('Ukázková data jsou v projektu.')).toBeVisible();
});

test('ukázkové publikum se v kontrolním seznamu kampaně pozná', async ({ page }) => {
  // Rozhraní I→P13.1: kontrolní seznam musí říct, že publikum obsahuje jen
  // ukázkové kontakty. Když tenhle test spadne, patří oprava do P13.
  await page.goto('/');
  await expect(
    page
      .getByText(/Publikum obsahuje jen ukázkové kontakty/)
      .or(page.getByTestId('preflight-demo-only')),
  ).toBeVisible({ timeout: 30_000 });
});
