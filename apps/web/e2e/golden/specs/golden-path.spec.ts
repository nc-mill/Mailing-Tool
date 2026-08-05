import { expect, test } from '@playwright/test';
import { clearMailbox, extractLink, extractOpenPixel, waitForMessage } from '../fixtures/mailpit';
import { freshInstallation } from '../fixtures/installation';
import { CAMPAIGN, VERIFIED_RECIPIENT } from '../fixtures/test-data';
import { SetupPage } from '../pages/setup.page';
import { OnboardingPage } from '../pages/onboarding.page';
import { SendingPage } from '../pages/sending.page';
import { ImportPage } from '../pages/import.page';
import { TemplatePage } from '../pages/template.page';
import { SegmentPage } from '../pages/segment.page';
import { CampaignPage } from '../pages/campaign.page';
import { ReportPage } from '../pages/report.page';

/**
 * Zlatá cesta z kapitoly 7 hlavní specifikace, provedená na čisté instalaci:
 * instalace, připojení odesílání, import kontaktů, vytvoření šablony,
 * vytvoření segmentu, odeslání kampaně, kvalitní report.
 *
 * Jede se jedním souvislým scénářem, ne osmi nezávislými testy. Zlatá cesta
 * je jeden tok a rozdělení na nezávislé testy by znamenalo osm instalací
 * a ztrátu právě té vlastnosti, kterou má test doložit.
 */
test('zlatá cesta od instalace k reportu', async ({ page }) => {
  test.slow();
  // Krok 1 zlaté cesty JE instalace, takže musí začít na panenské:
  // s obsazenou by průvodce prvním spuštěním neměl co založit.
  await freshInstallation();
  await clearMailbox();

  // 1. Instalace: průvodce vytvoří správce a první projekt.
  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const onboarding = new OnboardingPage(page, slug);
  await onboarding.openDashboard();
  await expect(onboarding.panel).toBeVisible();
  await onboarding.expectStepNotDone('sending');

  // 2. Připojení odesílání ve zkušebním režimu, viz rozpor R2.
  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();

  await onboarding.openDashboard();
  await onboarding.expectStepDone('sending');

  // 3. Import kontaktů včetně kontroly oslovení.
  await new ImportPage(page, slug).importFifty();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('contacts');

  // 4. Šablona. AI krok je z testu vynechaný, viz kapitola 3 plánu.
  const templates = new TemplatePage(page, slug);
  const templateName = await templates.createFromStarter();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('template');

  // 5. Segment s živým počtem.
  const segmentSize = await new SegmentPage(page, slug).createActiveNinetyDays();
  expect(segmentSize).toBeGreaterThan(0);

  // 6. Zkušební e-mail.
  //
  // ODCHYLKA OD PLÁNU, vynucená produktem: testovací odeslání je v EDITORU
  // ŠABLONY, ne u kampaně. Ani obrazovka nastavení kampaně, ani její kontrolní
  // seznam žádné „Poslat test" nemají, ověřeno v prohlížeči. Testuje se obsah,
  // a ten nese šablona, takže to tam patří.
  await templates.openLatest();
  await templates.sendTestTo(VERIFIED_RECIPIENT);
  const testMail = await waitForMessage(VERIFIED_RECIPIENT);
  expect(testMail.html).toContain('Dobrý den');

  await onboarding.openDashboard();
  await onboarding.expectStepDone('testSend');

  // 7. Kampaň: nastavení, kontrola připravenosti, odeslání.
  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment(templateName);
  await campaign.openSendCheck();
  await campaign.send();
  await campaign.expectLiveProgress();

  // 8. Otevření, proklik a časová osa.
  const delivered = await waitForMessage(VERIFIED_RECIPIENT, {
    subjectContains: CAMPAIGN.subject,
    timeoutMs: 120_000,
  });
  const pixel = extractOpenPixel(delivered.html);
  expect((await page.request.get(pixel)).ok()).toBe(true);
  const clickUrl = extractLink(delivered.html, '/t/c/');
  const clickResponse = await page.request.get(clickUrl, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(clickResponse.status());

  // 9. Report.
  const report = new ReportPage(page, slug);
  await report.open();
  await report.expectHeadlineTiles();
  await report.expectOpenRateCaveat();
  await report.expectDenominatorNextToEveryPercentage();

  // 10. Onboarding je hotový a hlásí to jednorázově.
  await onboarding.openDashboard();
  await expect(page.getByText('Hotovo, první kampaň odeslána.')).toBeVisible();
});
