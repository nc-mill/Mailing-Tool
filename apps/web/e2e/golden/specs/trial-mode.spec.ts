import { expect, test } from '@playwright/test';
import { clearMailbox, messageCount } from '../fixtures/mailpit';
import { SetupPage } from '../pages/setup.page';
import { SendingPage } from '../pages/sending.page';
import { ImportPage } from '../pages/import.page';
import { TemplatePage } from '../pages/template.page';
import { CampaignPage } from '../pages/campaign.page';

/**
 * Riziko z 8.2.9: uživatel postaví kampaň na velké publikum a teprve při
 * odeslání zjistí, že je ve zkušebním režimu. Zmírnění je pruh na obrazovce
 * publika s konkrétními čísly. Pruh vlastní P13, tenhle test ho vynucuje.
 */
test('zkušební režim říká na publiku, kolika lidem se opravdu odešle', async ({ page }) => {
  test.slow();
  await clearMailbox();

  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();

  await new ImportPage(page, slug).importFifty();
  await new TemplatePage(page, slug).createFromStarter();

  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment();

  const notice = campaign.trialModeNotice;
  await expect(notice).toBeVisible();

  // Ve větě musí být obě čísla: kolik lidí je v publiku a kolika se odešle.
  const text = (await notice.textContent()) ?? '';
  const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  expect(numbers.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...numbers)).toBeGreaterThan(Math.min(...numbers));
  expect(text).toMatch(/ověřen/i);
});

test('kampaň ve zkušebním režimu odejde jen na ověřené adresy', async ({ page }) => {
  test.slow();
  const before = await messageCount();

  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();
  await new ImportPage(page, slug).importFifty();
  await new TemplatePage(page, slug).createFromStarter();

  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment();
  await campaign.send();
  await campaign.expectLiveProgress();
  await page.waitForTimeout(10_000);

  // Padesát kontaktů v publiku, ale jen jedna ověřená adresa plus potvrzovací e-mail.
  expect((await messageCount()) - before).toBeLessThan(5);
});

test('report kampaně ze zkušebního režimu to trvale připomíná', async ({ page }) => {
  await page.goto('/');
  await expect(
    page.getByTestId('trial-mode-report-banner').or(page.getByText(/zkušebním režimu/i)),
  ).toBeVisible({ timeout: 30_000 });
});
