import { expect, test } from '@playwright/test';
import {
  clearMailbox,
  countMessagesWithSubject,
  extractLink,
  extractOpenPixel,
  waitForMessage,
} from '../fixtures/mailpit';
import {
  expectNoUnreplacedMergeTags,
  expectPostalAddress,
  expectUsableTextPart,
  extractLinkFromText,
} from '../fixtures/email-content';
import { freshInstallation } from '../fixtures/installation';
import {
  CAMPAIGN,
  SUBSCRIBERS_LIST,
  POSTAL_ADDRESS,
  SIGNUP,
  VERIFIED_RECIPIENT,
} from '../fixtures/test-data';
import { SetupPage } from '../pages/setup.page';
import { OnboardingPage } from '../pages/onboarding.page';
import { SendingPage } from '../pages/sending.page';
import { SettingsPage } from '../pages/settings.page';
import { ImportPage } from '../pages/import.page';
import { ListPage } from '../pages/list.page';
import { FormPage } from '../pages/form.page';
import { PublicPages } from '../pages/public.page';
import { TemplatePage } from '../pages/template.page';
import { SegmentPage } from '../pages/segment.page';
import { CampaignPage } from '../pages/campaign.page';
import { ReportPage } from '../pages/report.page';

/**
 * Zlatá cesta z kapitoly 7 hlavní specifikace, provedená na čisté instalaci:
 * instalace, připojení odesílání, import kontaktů, přihlášení přes veřejný
 * formulář, vytvoření šablony, vytvoření segmentu, odeslání kampaně, odhlášení
 * a report, který říká pravdu.
 *
 * Jede se jedním souvislým scénářem, ne deseti nezávislými testy. Zlatá cesta
 * je jeden tok a rozdělení na nezávislé testy by znamenalo deset instalací
 * a ztrátu právě té vlastnosti, kterou má test doložit.
 *
 * CO SE SEM DOPLNILO 7. 8. A PROČ. Test doložil, že kampaň odešla, ale
 * o tom, CO odešlo, netvrdil skoro nic: kontroloval jedinou větu v HTML.
 * Ručně se pak našly čtyři vady, které tudy prošly bez povšimnutí:
 *
 *   - `{{ workspace.sender_address }}` v patičce odcházel prázdný, takže
 *     obchodní sdělení nemělo poštovní adresu, kterou mít ze zákona musí;
 *   - textová verze potvrzovacího e-mailu adresu neměla vůbec a textovou
 *     verzi do té doby nekontroloval nikdo;
 *   - odmítnuté zprávy se počítaly jako doručené, takže report hlásil
 *     stoprocentní doručitelnost místo osmapadesátiprocentní;
 *   - odhlášení, které je povinné ze zákona, nebylo v testu vůbec.
 *
 * Všechny čtyři jsou v e-mailu nebo na reportu vidět na první pohled. Test
 * proto od té doby sahá na obě těla zprávy, na skutečný obsah poštovní pasti
 * a na obě cesty, kterými do produktu chodí odběratelé.
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

  // 2b. Poštovní adresa odesílatele.
  //
  // Průvodce prvním spuštěním ji nemá, takže po instalaci je prázdná. Bez
  // tohohle kroku by kontrola patičky níž nedokázala rozlišit vadu produktu
  // od toho, že adresu nikdo nezadal.
  await new SettingsPage(page, slug).setPostalAddress(POSTAL_ADDRESS);

  // 3. Seznam odběratelů.
  //
  // SCÉNÁŘ HO ZAKLÁDÁ SÁM, a je to obcházka kolem vady, ne návrh: projekt
  // z průvodce prvním spuštěním nemá ŽÁDNÝ seznam, přestože projekt založený
  // později ho dostane. Import přitom cílový seznam vyžaduje. Zapsáno jako
  // nález v oddílu 4.
  const lists = new ListPage(page, slug);
  await lists.createWithDoubleOptIn(SUBSCRIBERS_LIST);
  await lists.expectDoubleOptIn();
  await lists.expectUnsubscribeScope('list');
  await lists.expectCounts({ confirmed: 0, pending: 0 });

  // 3b. Import kontaktů včetně kontroly oslovení.
  await new ImportPage(page, slug).importFifty();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('contacts');
  await lists.expectCounts({ confirmed: 50, pending: 0 });

  // 4. Šablona. AI krok je z testu vynechaný, viz kapitola 3 plánu.
  const templates = new TemplatePage(page, slug);
  const templateName = await templates.createFromStarter();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('template');

  // 5. Segment s živým počtem.
  const segmentSize = await new SegmentPage(page, slug).createActiveNinetyDays();
  expect(segmentSize).toBeGreaterThan(0);

  // 6. Kampaň: nastavení a uložení. Odesílá se až o dva kroky dál.
  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment(templateName);

  /*
   * 6b. Zkušební e-mail.
   *
   * ODCHYLKA OD PLÁNU, vynucená produktem: testovací odeslání je v EDITORU
   * ŠABLONY, ne u kampaně. Ani obrazovka nastavení kampaně, ani její kontrolní
   * seznam žádné „Poslat test" nemají, ověřeno v prohlížeči. Testuje se obsah,
   * a ten nese šablona, takže to tam patří.
   *
   * STOJÍ AŽ ZA ULOŽENOU KAMPANÍ, A JE TO OBCHÁZKA KOLEM VADY. `senderIdentity`
   * v `templates/test-send.ts:291` hledá odesílatele VÝHRADNĚ v už uložených
   * kampaních; připojený odesílací účet ani ověřenou adresu zkušebního režimu
   * nevidí. Na čerstvém projektu proto zkušební odeslání skončí na
   *   Test se nepodařilo odeslat (validation_failed)
   * s důvodem `test_sending_not_configured`. Panel prvních kroků přitom nabízí
   * „Pošlete si zkušební e-mail" PŘED „Odešlete první kampaň", takže v pořadí,
   * které produkt sám doporučuje, ten krok udělat nejde. Zapsáno jako nález
   * v oddílu 4; až se to spraví, tenhle blok patří zpátky před krok 6.
   */
  await templates.openLatest();
  await templates.sendTestTo(VERIFIED_RECIPIENT);
  // Předmět zkušebního e-mailu je JMÉNO ŠABLONY: vlastní pole na předmět
  // šablona nemá (`test-send.ts:193`). Filtruje se podle něj, protože v pasti
  // už leží potvrzení adresy pro zkušební režim, poslané na tutéž adresu,
  // a bez filtru by se kontrolovalo ono.
  const testMail = await waitForMessage(VERIFIED_RECIPIENT, {
    subjectContains: templateName,
  });
  expect(testMail.html).toContain('Dobrý den');
  expectNoUnreplacedMergeTags(testMail, 'zkušební e-mail');
  expectUsableTextPart(testMail, 'zkušební e-mail');

  await onboarding.openDashboard();
  await onboarding.expectStepDone('testSend');

  /*
   * 6c. DRUHÁ CESTA DO PRODUKTU: přihlášení z webu s dvojím potvrzením.
   *
   * Import je cesta, kterou uživatel nasype adresy, které už má. Formulář je
   * cesta, kterou přicházejí SKUTEČNÍ odběratelé, a je na ní celý doklad
   * souhlasu. Zlatá cesta jela jen přes import, takže o té druhé netvrdila nic.
   *
   * Přihlašuje se OVĚŘENÁ ADRESA, a je to nutné, ne náhoda: ve zkušebním
   * režimu se kampaň doručí výhradně na ověřené adresy (`canSendInTrial`),
   * takže bez kontaktu s touhle adresou by publikum kampaně neobsahovalo
   * nikoho, komu se smí poslat, a krok 8 by čekal na zprávu, která nemá odkud
   * přijít. Právě na tomhle stála zlatá cesta dřív a projít nemohla.
   *
   * STOJÍ TO AŽ ZA ULOŽENOU KAMPANÍ, A JE TO OBCHÁZKA KOLEM VADY. Potvrzovací
   * e-mail si odesílatele hledá v `sender_identities` a pak v už uložených
   * kampaních (`subscription-emails.ts:368`). Připojený odesílací účet ani
   * ověřená adresa ze zkušebního režimu se do `sender_identities` nezapisují
   * a předvolbu odesílatele nejde bez ověřené domény založit, takže na čerstvém
   * projektu je e-mail bez odesílatele a odhlásí se s `sending_not_configured`.
   * Naměřeno: `list.email_send_failed` v auditu, nula řádků v `messages`, nula
   * zpráv v pasti. Uložená kampaň je jediné, co tu díru zalepí. Zapsáno jako
   * nález v oddílu 4; až se to spraví, tenhle blok patří zpátky před krok 4.
   */
  const forms = new FormPage(page, slug);
  const hostedUrl = await forms.createForList(SIGNUP.formName, SUBSCRIBERS_LIST);

  const publicPages = new PublicPages(page);
  await publicPages.submitSubscribeForm(hostedUrl, VERIFIED_RECIPIENT);

  // Potvrzovací e-mail je DOKLAD, že přihlášení opravdu vzniklo. Čeká se na něj
  // dřív než na počty: kdyby se počty ptaly první, nešlo by u nuly rozeznat
  // „přihlášení nevzniklo" od „ještě se nepropsalo".
  const confirmation = await waitForMessage(VERIFIED_RECIPIENT, {
    subjectContains: SIGNUP.confirmationSubject,
    timeoutMs: 120_000,
  });

  // Dokud člověk nepotvrdí, NENÍ odběratel. Kdyby se přihlášení počítalo hned,
  // je to vidět přesně tady.
  await lists.expectCounts({ confirmed: 50, pending: 1 });
  expectNoUnreplacedMergeTags(confirmation, 'potvrzovací e-mail');
  expectUsableTextPart(confirmation, 'potvrzovací e-mail');
  expectPostalAddress(confirmation, POSTAL_ADDRESS, 'potvrzovací e-mail');

  // Potvrzení musí jít dokončit i z TEXTOVÉ verze. Kdo čte poštu v textu,
  // jinou cestu nemá, a právě v textové verzi se adresa i odkaz ztrácely.
  const confirmUrl = extractLinkFromText(confirmation.text, '/s/c/');
  expect(confirmUrl).toBe(extractLink(confirmation.html, '/s/c/'));
  await publicPages.confirmSubscription(confirmUrl);

  const subscribersBeforeUnsubscribe = { confirmed: 51, pending: 0 };
  await lists.expectCounts(subscribersBeforeUnsubscribe);

  // 7. Kontrola připravenosti a odeslání.
  await campaign.openSendCheck();
  await campaign.send();
  await campaign.expectLiveProgress();

  // 8. Co doopravdy přišlo do schránky.
  const delivered = await waitForMessage(VERIFIED_RECIPIENT, {
    subjectContains: CAMPAIGN.subject,
    timeoutMs: 120_000,
  });

  // 8a. OBSAH, ne jen doručení. Obchodní sdělení musí nést poštovní adresu
  // odesílatele a nesmí v něm zůstat nenahrazená značka, a to v OBOU tělech.
  expect(delivered.html).toContain('Dobrý den');
  expectNoUnreplacedMergeTags(delivered, 'kampaň');
  expectUsableTextPart(delivered, 'kampaň');
  expectPostalAddress(delivered, POSTAL_ADDRESS, 'kampaň');

  // 8b. Otevření a proklik.
  const pixel = extractOpenPixel(delivered.html);
  expect((await page.request.get(pixel)).ok()).toBe(true);
  const clickUrl = extractLink(delivered.html, '/t/c/');
  const clickResponse = await page.request.get(clickUrl, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(clickResponse.status());

  // 8c. ODHLÁŠENÍ. Povinné ze zákona a do 7. 8. v testu vůbec nebylo, přestože
  // se u něj právě měnil rozsah. Odkaz se bere z DORUČENÉ zprávy, ne z API:
  // testuje se ten odkaz, který dostal příjemce.
  const unsubscribeUrl = extractLink(delivered.html, '/u/');
  await publicPages.unsubscribe(unsubscribeUrl);

  // A HLAVNĚ: opravdu přestal být odběratelem, ne jen viděl „Hotovo".
  // Měří se na počtu odběratelů seznamu, protože ten je zdrojem pravdy o tom,
  // komu se posílá. Stránka, která napíše „Hotovo" a v databázi nezmění nic,
  // je přesně ta vada, kterou má tenhle krok chytit.
  await lists.expectCounts({
    confirmed: subscribersBeforeUnsubscribe.confirmed - 1,
    pending: subscribersBeforeUnsubscribe.pending,
  });

  // 9. Report.
  //
  // Nejdřív se počká, až rozesílka skončí, a teprve pak se čtou čísla: report
  // nad běžící rozesílkou by hlásil pravdu o něčem jiném, než co se stalo.
  await campaign.openProgress();
  await campaign.waitUntilFinished();

  // Kolik zpráv kampaně DOOPRAVDY leží v poštovní pasti. Je to jediné číslo
  // v celém scénáři, které nepochází z produktu, takže se proti němu dá měřit.
  const reallyArrived = await countMessagesWithSubject(CAMPAIGN.subject);
  expect(reallyArrived, 've zkušebním režimu odchází jen na ověřené adresy').toBe(1);
  expect(await campaign.sentCount()).toBe(reallyArrived);

  const report = new ReportPage(page, slug);
  await report.open();
  await report.expectHeadlineTiles();
  await report.expectOpenRateCaveat();
  await report.expectDenominatorNextToEveryPercentage();

  // 9b. ČÍSLA MUSÍ SEDĚT NA TO, CO SE STALO. Report, který jen má dlaždice,
  // umí hlásit stoprocentní doručitelnost u kampaně, ze které polovina zpráv
  // odletěla do koše; přesně to se 7. 8. opravovalo.
  //
  // Nezměřená doručenost je `null` a je to POCTIVÁ odpověď, ne mezera v testu:
  // u SMTP účtu nikdo doručení nehlásí a produkt to na dlaždici říká větou,
  // místo aby napsal nulu. Kontroluje se tedy to, co se zkontrolovat dá:
  // když číslo je, musí sedět.
  const deliveredShown = await report.tileNumber('Doručeno');
  if (deliveredShown !== null) {
    expect(deliveredShown, 'doručeno nesedí na to, co opravdu dorazilo do schránky').toBe(
      reallyArrived,
    );
  }
  await expect
    .poll(
      async () => {
        await page.reload();
        return await report.tileNumber('Odhlásilo se');
      },
      {
        timeout: 60_000,
        message: 'Report nezapočítal odhlášení, které v kroku 8c opravdu proběhlo',
      },
    )
    .toBe(1);

  // 10. Onboarding je hotový a hlásí to jednorázově.
  await onboarding.openDashboard();
  await expect(page.getByText('Hotovo, první kampaň odeslána.')).toBeVisible();
});
