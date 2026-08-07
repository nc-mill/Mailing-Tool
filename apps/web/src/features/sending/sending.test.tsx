import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import providers from '../../../../../packages/core/data/dns-providers.json';
import sesRegions from '../../../../../packages/core/data/ses-regions.json';
import presets from '../../../../../packages/core/data/smtp-presets.json';
import { AddProviderDialog } from './add-provider-dialog';
import { DnsRecords, type DnsRecord } from './dns-records';
import { DeliverabilityTiles } from './deliverability-tiles';
import { DeleteProviderDialog, EditProviderDialog } from './edit-provider-dialog';
import { GuardThresholds } from './guard-thresholds';
import { ProductionAccessDialog, VerifyIdentityDialog } from './identity-dialogs';
import { SendingSettings, type ProviderView } from './sending-settings';
import { renderWithProviders } from '../campaigns/test-utils';

/**
 * Radix Select po otevření odroluje na zvolenou položku, a `scrollIntoView`
 * v jsdom prostě není. Bez téhle náhrady spadne KAŽDÉ otevření výběru na
 * `candidate?.scrollIntoView is not a function`, tedy na chybu prostředí,
 * ne na chybu komponenty. Náhrada stojí tady, ne v `vitest.setup.ts`:
 * sdílený setup patří P01 a tenhle soubor do něj nemá co psát.
 */
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * Vybere region v `SelectField`. Radix se v jsdom neotevře kliknutím (chybí
 * pointer events), ale klávesnicí ano, a je to zároveň ta cesta, kterou projde
 * uživatel čtečky.
 */
async function pickRegion(fieldName: string, optionLabel: RegExp): Promise<void> {
  screen.getByRole('combobox', { name: 'Region u Amazonu' }).focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.click(screen.getByRole('option', { name: optionLabel }));
  // Hodnota se do formuláře dostane skrytým polem, ne Radixem, takže se ověří tam.
  expect(document.querySelector(`input[name="${fieldName}"]`)).not.toHaveValue('');
}

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

const records: DnsRecord[] = [
  {
    type: 'CNAME',
    name: 'x7k2m._domainkey.kolo-shop.cz',
    value: 'x7k2m.dkim.amazonses.com',
    ttl: 1800,
    purpose: 'dkim',
    required: true,
  },
  {
    type: 'TXT',
    name: 'kolo-shop.cz',
    value: 'v=spf1 include:amazonses.com ~all',
    ttl: 1800,
    purpose: 'spf',
    required: true,
  },
  {
    type: 'TXT',
    name: '_dmarc.kolo-shop.cz',
    value: 'v=DMARC1; p=none',
    ttl: 1800,
    purpose: 'dmarc',
    required: false,
  },
];

const checks = {
  spf: {
    ok: false,
    record: null,
    findings: [{ code: 'spf_multiple_records', severity: 'error' }],
  },
  dkim: { ok: false, found: 2, expected: 3, findings: [] },
  dmarc: { ok: null, findings: [] },
  mx: { ok: null, findings: [] },
};

const limits = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: 0.08,
  DELIVERABILITY_COMPLAINT_GUARD_RATE: 0.003,
  DELIVERABILITY_BOUNCE_WARN_RATE: 0.04,
  DELIVERABILITY_COMPLAINT_WARN_RATE: 0.001,
  DELIVERABILITY_GUARD_MIN_SENT: 500,
};

describe('datové soubory poskytovatelů', () => {
  it('každá položka nese verifiedAt, aby uživatel poznal, jak starou radu čte', () => {
    for (const p of providers as Array<{ verifiedAt: string }>) {
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const p of presets as Array<{ verifiedAt: string }>) {
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('existuje obecný návod pro neznámé poskytovatele', () => {
    expect((providers as Array<{ id: string }>).some((p) => p.id === 'generic')).toBe(true);
  });

  it('datový soubor NIKDY neobsahuje hodnoty záznamů, jen návod', () => {
    const s = JSON.stringify(providers);
    expect(s).not.toContain('_domainkey');
    expect(s).not.toContain('v=spf1');
  });
});

describe('obrazovka se záznamy', () => {
  function renderRecords() {
    return renderWithProviders(
      <DnsRecords
        domain="kolo-shop.cz"
        records={records}
        checks={checks}
        checkedAt="2026-08-01T12:00:00.000Z"
        onCheckNow={vi.fn()}
      />,
    );
  }

  it('každá hodnota má tlačítko kopírovat', () => {
    renderRecords();
    expect(screen.getAllByRole('button', { name: 'Kopírovat' }).length).toBeGreaterThanOrEqual(
      records.length,
    );
  });

  it('nabízí stažení jako CSV', () => {
    renderRecords();
    expect(screen.getByRole('button', { name: 'Stáhnout jako CSV' })).toBeInTheDocument();
  });

  it('kontrola jde spustit na jedno kliknutí', async () => {
    const onCheckNow = vi.fn();
    renderWithProviders(
      <DnsRecords
        domain="kolo-shop.cz"
        records={records}
        checks={checks}
        checkedAt={null}
        onCheckNow={onCheckNow}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Zkontrolovat teď' }));
    expect(onCheckNow).toHaveBeenCalledTimes(1);
  });

  it('dva SPF záznamy hlásí jmenovitě, co s tím', () => {
    renderRecords();
    expect(screen.getByText(/Domény smí mít jediný SPF záznam/)).toBeInTheDocument();
  });

  it('nález stojí U SVÉ kontroly, ne ve společné hromadě pod seznamem', () => {
    renderRecords();
    // Nález o dvou SPF záznamech musí být uvnitř položky SPF, ne kdekoli na stránce.
    expect(screen.getByTestId('check-spf')).toHaveTextContent(/Domény smí mít jediný SPF záznam/);
    expect(screen.getByTestId('check-dmarc')).not.toHaveTextContent(/SPF/);
  });

  it('částečný DKIM řekne, kolik ze tří je vidět', () => {
    renderRecords();
    expect(screen.getByTestId('dkim-status')).toHaveTextContent('2');
  });

  it('neznámý stav má šedé kolečko, ne červené', () => {
    renderRecords();
    expect(screen.getByTestId('dot-dmarc')).toHaveAttribute('data-tone', 'grey');
    expect(screen.getByTestId('dot-spf')).toHaveAttribute('data-tone', 'red');
  });

  it('říká, že stránku jde zavřít a kontrolujeme dál', () => {
    renderRecords();
    expect(screen.getByText(/Stránku můžete zavřít/)).toBeInTheDocument();
  });

  it('počet záznamů je ICU plurál, ne pevné slovo', () => {
    renderRecords();
    expect(screen.getByText('Přidejte 3 záznamy')).toBeInTheDocument();
  });

  it('tabulka u každého řádku říká, ke které kontrole patří', () => {
    renderRecords();
    const dkimRow = document.querySelector('tr[data-purpose="dkim"]')!;
    const spfRow = document.querySelector('tr[data-purpose="spf"]')!;
    expect(dkimRow).toHaveTextContent('DKIM podpis');
    expect(spfRow).toHaveTextContent('SPF');
  });

  it('řekne, že se záznamy vkládají do DNS, ne k jmenným serverům', () => {
    renderRecords();
    expect(screen.getByText(/ne do nastavení jmenných serverů \(NS\)/)).toBeInTheDocument();
  });
});

/**
 * Regrese na ostrý nález u domény brevio.cz.
 *
 * Uživatel viděl pod seznamem kontrol DVAKRÁT větu „Záznam existuje, ale má jinou
 * hodnotu." a nešlo poznat, čeho se týká. Data níže jsou DOSLOVA sloupec `checks`
 * z tabulky `sender_domains` po skutečné kontrole (databáze mlain_clean), takže
 * test drží přesně ten stav, který si uživatel vyfotil:
 *
 *   dig +short TXT brevio.cz        -> "v=spf1 include:amazonses.com ~all"
 *   dig +short TXT _dmarc.brevio.cz -> "v=DMARC1; p=none; rua=mailto:dmarc@brevio.cz; ..."
 *   dig +short MX brevio.cz         -> 10 mail.brevio.cz.
 *
 * Obě hlášky patřily k něčemu úplně jinému: první k radě u DMARC (`dmarc_policy_none`,
 * záznam je PLATNÝ), druhá k MX, které se nemělo kontrolovat vůbec, protože doména
 * nemá vlastní zpáteční adresu.
 */
describe('doména brevio.cz, skutečný stav z databáze', () => {
  const brevioRecords: DnsRecord[] = [
    {
      type: 'CNAME',
      name: 'ovrqoge3ayz5zqesds4faoksqglr3mi4._domainkey.brevio.cz',
      value: 'ovrqoge3ayz5zqesds4faoksqglr3mi4.dkim.amazonses.com',
      ttl: 1800,
      purpose: 'dkim',
      required: true,
    },
    {
      type: 'TXT',
      name: 'brevio.cz',
      value: 'v=spf1 include:amazonses.com ~all',
      ttl: 1800,
      purpose: 'spf',
      required: true,
    },
    {
      type: 'TXT',
      name: '_dmarc.brevio.cz',
      value: 'v=DMARC1; p=none; rua=mailto:dmarc@brevio.cz; pct=100; adkim=r; aspf=r',
      ttl: 1800,
      purpose: 'dmarc',
      required: false,
    },
  ];

  const brevioChecks = {
    spf: { ok: true, record: 'v=spf1 include:amazonses.com ~all', findings: [] },
    dkim: { ok: true, found: 3, expected: 3, findings: [] },
    dmarc: {
      ok: true,
      pct: 100,
      policy: 'none',
      record: 'v=DMARC1; p=none; rua=mailto:dmarc@brevio.cz; pct=100; adkim=r; aspf=r',
      findings: [
        {
          code: 'dmarc_policy_none',
          severity: 'warning',
          params: {
            actual: 'v=DMARC1; p=none; rua=mailto:dmarc@brevio.cz; pct=100; adkim=r; aspf=r',
          },
        },
      ],
    },
    // Po opravě posílá jádro u domény bez vlastní zpáteční adresy `null`.
    mx: null,
  };

  function renderBrevio() {
    renderWithProviders(
      <DnsRecords
        domain="brevio.cz"
        records={brevioRecords}
        checks={brevioChecks}
        checkedAt="2026-08-03T13:33:24.000Z"
        onCheckNow={vi.fn()}
      />,
    );
  }

  it('věta „Záznam existuje, ale má jinou hodnotu" se na obrazovce už neobjeví', () => {
    renderBrevio();
    expect(screen.queryByText(/má jinou hodnotu/)).not.toBeInTheDocument();
  });

  it('MX pro zpáteční adresu se vůbec nenabízí, když ho uživatel nemá jak splnit', () => {
    renderBrevio();
    expect(screen.queryByTestId('check-mx')).not.toBeInTheDocument();
    expect(screen.getByTestId('mail-from-off')).toHaveTextContent(/Amazon svojí vlastní doménou/);
  });

  it('MX zmizí hned, i když je v uložených kontrolách po staré verzi pořád neshoda', () => {
    // Přesně to, co je dnes v `sender_domains.checks` u brevio.cz: MX ok=false
    // proti `mail.brevio.cz`. Tabulka MX řádek nemá, takže se kontrola neukazuje
    // a nečeká se na další běh kontroly.
    renderWithProviders(
      <DnsRecords
        domain="brevio.cz"
        records={brevioRecords}
        checks={{
          ...brevioChecks,
          mx: {
            ok: false,
            records: ['mail.brevio.cz'],
            findings: [
              {
                code: 'mail_from_mx_wrong',
                severity: 'warning',
                params: { expected: 'feedback-smtp.eu-central-1.amazonses.com' },
              },
            ],
          },
        }}
        checkedAt={null}
        onCheckNow={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('check-mx')).not.toBeInTheDocument();
    expect(screen.queryByText(/mail\.brevio\.cz/)).not.toBeInTheDocument();
  });

  it('SPF a DKIM jsou v pořádku a je to napsané slovem, ne jen barvou', () => {
    renderBrevio();
    expect(screen.getByTestId('check-spf')).toHaveAttribute('data-state', 'ok');
    expect(screen.getByTestId('state-spf')).toHaveTextContent('V pořádku');
    expect(screen.getByTestId('check-dkim')).toHaveAttribute('data-state', 'ok');
  });

  it('DMARC je platný: stav je rada, ne neshoda, a řekne co dál', () => {
    renderBrevio();
    expect(screen.getByTestId('check-dmarc')).toHaveAttribute('data-state', 'note');
    expect(screen.getByTestId('check-dmarc')).toHaveTextContent(/p=none jen sbírá hlášení/);
    expect(screen.getByTestId('check-dmarc')).toHaveTextContent(/přitvrďte na p=quarantine/);
  });
});

/** U neshody musí být vidět OBĚ hodnoty, jinak není co porovnat a co opravit. */
describe('neshoda ukazuje čekanou i nalezenou hodnotu', () => {
  it('MX s vlastní zpáteční adresou porovná feedback-smtp proti tomu, co v DNS je', () => {
    renderWithProviders(
      <DnsRecords
        domain="brevio.cz"
        records={[
          {
            type: 'MX',
            name: 'mail.brevio.cz',
            value: '10 feedback-smtp.eu-central-1.amazonses.com',
            ttl: 1800,
            purpose: 'mail_from_mx',
            required: true,
          },
        ]}
        checks={{
          mx: {
            ok: false,
            records: ['mail.brevio.cz'],
            findings: [
              {
                code: 'mail_from_mx_wrong',
                severity: 'warning',
                params: {
                  expected: 'feedback-smtp.eu-central-1.amazonses.com',
                  actual: 'mail.brevio.cz',
                  host: 'mail.brevio.cz',
                },
              },
            ],
          },
        }}
        checkedAt={null}
        onCheckNow={vi.fn()}
      />,
    );

    expect(screen.getByTestId('check-mx')).toHaveAttribute('data-state', 'mismatch');
    expect(screen.getByTestId('expected-mx')).toHaveTextContent(
      'feedback-smtp.eu-central-1.amazonses.com',
    );
    expect(screen.getByTestId('found-mx')).toHaveTextContent('mail.brevio.cz');
  });

  it('chybějící záznam je „čekáme na rozšíření", ne neshoda', () => {
    renderWithProviders(
      <DnsRecords
        domain="kolo-shop.cz"
        records={records}
        checks={{
          spf: {
            ok: false,
            record: null,
            findings: [
              {
                code: 'spf_missing',
                severity: 'error',
                params: { host: 'kolo-shop.cz', expected: 'include:amazonses.com' },
              },
            ],
          },
        }}
        checkedAt={null}
        onCheckNow={vi.fn()}
      />,
    );

    expect(screen.getByTestId('check-spf')).toHaveAttribute('data-state', 'missing');
    expect(screen.getByTestId('found-spf')).toHaveTextContent('nic');
  });
});

describe('dlaždice doručitelnosti', () => {
  const metrics = {
    bounce_rate: 0.062,
    complaint_rate: 0.0012,
    delivery_known: true,
  };
  const account = {
    enforcement_status: 'HEALTHY',
    production_access: true,
    quota_max_24h: 50_000,
    quota_sent_24h: 12_000,
    quota_max_send_rate: 14,
  };
  const thresholds = {
    bounce_warn_rate: 0.04,
    bounce_guard_rate: 0.08,
    complaint_warn_rate: 0.001,
    complaint_guard_rate: 0.003,
  };

  it('u míry stížností je napsáno, že je to odhad', () => {
    renderWithProviders(
      <DeliverabilityTiles
        metrics={metrics}
        account={account}
        unmatchedEvents={0}
        thresholds={thresholds}
        campaignsHref="/w/eshop/campaigns"
      />,
    );
    expect(screen.getByText(/Naše číslo je odhad/)).toBeInTheDocument();
  });

  it('míra mezi varováním a brzdou je oranžová zóna', () => {
    renderWithProviders(
      <DeliverabilityTiles
        metrics={metrics}
        account={account}
        unmatchedEvents={0}
        thresholds={thresholds}
        campaignsHref="/w/eshop/campaigns"
      />,
    );
    expect(screen.getByTestId('tile-bounce')).toHaveAttribute('data-zone', 'orange');
    expect(screen.getByTestId('tile-complaint')).toHaveAttribute('data-zone', 'orange');
  });

  it('prázdný stav vysvětluje, kdy se čísla objeví', () => {
    renderWithProviders(
      <DeliverabilityTiles
        metrics={null}
        account={null}
        unmatchedEvents={0}
        thresholds={thresholds}
        campaignsHref="/w/eshop/campaigns"
      />,
    );
    expect(screen.getByText(/Až odešlete první kampaň/)).toBeInTheDocument();
  });

  /**
   * REGRESE: obrazovka hlásila „Nedoručitelnost 0 %" a „Stížnosti 0 %"
   * v zelené zóně u instalace, od jejíž odesílací služby nedorazila ani jedna
   * zpráva o osudu e-mailů. Nula tam nebyla údaj, ale jeho absence, a zelený
   * rámeček k tomu dodal klid, který se nemá čím podložit.
   */
  it('bez zpětné vazby od služby ukáže „zatím nevíme" a žádnou barevnou zónu', () => {
    renderWithProviders(
      <DeliverabilityTiles
        metrics={{ bounce_rate: 0, complaint_rate: 0, delivery_known: false }}
        account={account}
        unmatchedEvents={0}
        thresholds={thresholds}
        campaignsHref="/w/eshop/campaigns"
      />,
    );

    expect(screen.getByTestId('tile-bounce')).toHaveTextContent('zatím nevíme');
    expect(screen.getByTestId('tile-complaint')).toHaveTextContent('zatím nevíme');
    expect(screen.getByTestId('tile-bounce')).not.toHaveAttribute('data-zone');
    expect(screen.getByTestId('tile-complaint')).not.toHaveAttribute('data-zone');
    expect(screen.queryByText('0 %')).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/Odesílací služba nám o osudu odeslaných e-mailů zatím nic nehlásí/)
        .length,
    ).toBe(2);
  });

  /**
   * Druhá půlka téhož pravidla. Co je naměřené, zůstat vidět MUSÍ: stav účtu
   * a kvóta s doručovacími událostmi nemají nic společného a schovat je kvůli
   * chybějící zpětné vazbě by z opravy udělala jinou vadu.
   */
  it('stav účtu a kvótu ukazuje i tehdy, když míry chybí', () => {
    renderWithProviders(
      <DeliverabilityTiles
        metrics={{ bounce_rate: null, complaint_rate: null, delivery_known: false }}
        account={account}
        unmatchedEvents={0}
        thresholds={thresholds}
        campaignsHref="/w/eshop/campaigns"
      />,
    );

    expect(screen.getByText('HEALTHY')).toBeInTheDocument();
    expect(screen.getByText('12 000 / 50 000')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    // A pořád je to obrazovka s dlaždicemi, ne prázdný stav.
    expect(screen.queryByText(/Až odešlete první kampaň/)).not.toBeInTheDocument();
  });
});

describe('prahy doručitelnosti', () => {
  it('pole mají strop na instalační hodnotě, ne jen v nápovědě', () => {
    renderWithProviders(<GuardThresholds settings={{}} limits={limits} onSave={vi.fn()} />);
    expect(screen.getByTestId('guard-bounce_guard_rate')).toHaveAttribute('max', '8');
    expect(screen.getByTestId('guard-guard_min_sent')).toHaveAttribute('max', '500');
  });

  it('volnější hodnota se neuloží a řekne proč', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'success' });
    renderWithProviders(<GuardThresholds settings={{}} limits={limits} onSave={onSave} />);
    const field = screen.getByTestId('guard-bounce_guard_rate');
    await userEvent.clear(field);
    await userEvent.type(field, '50');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit brzdy' }));
    expect(onSave).not.toHaveBeenCalled();
    // Chyba stojí u pole, ne v souhrnném bloku: uživatel ji čte tam, kde ji vyrobil.
    // Druhý výskyt je vysvětlení u tlačítka, které z principu P5 nesmí být zašedlé.
    expect(screen.getAllByText(/Nastavit jde jen přísnější hodnotu/).length).toBeGreaterThan(0);
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('přísnější hodnota se uloží', async () => {
    const onSave = vi.fn().mockResolvedValue({ status: 'success' });
    renderWithProviders(<GuardThresholds settings={{}} limits={limits} onSave={onSave} />);
    const field = screen.getByTestId('guard-bounce_guard_rate');
    await userEvent.clear(field);
    await userEvent.type(field, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Uložit brzdy' }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ bounce_guard_rate: 0.05 }));
  });
});

/**
 * Tvar je `config_public` z `presentProvider`, tedy s maskovanými údaji a bez
 * tajemství. Přesně tak přijde ze serveru a přesně na tom stojí dialog úpravy.
 */
const ses: ProviderView = {
  id: 'p1',
  name: 'Firemní SES',
  type: 'ses',
  status: 'ready',
  is_default: true,
  config: {
    kind: 'ses',
    region: 'eu-central-1',
    configuration_set_name: 'mlain-eshop',
    access_key_id_masked: 'AKIA****MPLE',
  },
  quota_max_24h: 50_000,
  quota_sent_24h: 100,
};

const smtp: ProviderView = {
  id: 'p2',
  name: 'Firemní SMTP',
  type: 'smtp',
  status: 'ready',
  is_default: false,
  config: {
    kind: 'smtp',
    host: 'smtp.wedos.net',
    port: 587,
    encryption: 'starttls',
    username_masked: 'post****p.cz',
  },
  quota_max_24h: null,
  quota_sent_24h: null,
};

describe('nastavení odesílání', () => {
  it('u SMTP účtu svítí trvalé upozornění na ruční seznam blokovaných adres', () => {
    renderWithProviders(
      <SendingSettings
        providers={[
          {
            id: 'p1',
            name: 'Firemní SMTP',
            type: 'smtp',
            status: 'ready',
            is_default: true,
            config: { kind: 'smtp', host: 'smtp.wedos.net' },
            quota_max_24h: null,
            quota_sent_24h: null,
          },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
      />,
    );
    expect(screen.getByTestId('smtp-warning')).toHaveTextContent(/musíte udržovat ručně/);
  });

  it('bez účtu i bez domény vysvětlí, co ta věc je', () => {
    renderWithProviders(
      <SendingSettings
        providers={[]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
      />,
    );
    expect(screen.getByText(/odkud e-maily fyzicky odcházejí/)).toBeInTheDocument();
    expect(screen.getByText(/musí dovolit posílat jejím jménem/)).toBeInTheDocument();
  });

  it('test připojení zavolá akci pro správný účet', async () => {
    const onTestProvider = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[ses, smtp]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onTestProvider={onTestProvider}
      />,
    );
    await userEvent.click(screen.getByTestId('test-provider-p2'));
    expect(onTestProvider).toHaveBeenCalledWith('p2');
  });

  it('hotové ověření řekne u účtu, že údaje fungují', () => {
    renderWithProviders(
      <SendingSettings
        providers={[ses]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{
          p1: {
            state: 'ok',
            detail: 'Amazon odpověděl na dotaz na stav účtu.',
            sandbox: false,
            providerStatus: 'ready',
            blockers: [],
            region: 'eu-west-1',
            verifiedIdentities: ['brevio.cz', 'petr.novak@gmail.com'],
            verifiedIdentityCount: 2,
          },
        }}
      />,
    );
    // Věta mluví jen o tom, co test doložil, tedy o přístupových údajích.
    // O připravenosti k odesílání rozhoduje odznak, ne tahle věta: dokud to
    // tvrdila i ona, stálo na obrazovce „Ověřeno, účet je připravený odesílat"
    // vedle odznaku „Neověřený".
    expect(screen.getByTestId('test-result-p1')).toHaveTextContent(/údaje fungují/);
    expect(screen.getByTestId('provider-status-p1')).toHaveAttribute('data-status', 'ready');
  });

  it('účet v testovacím režimu Amazonu je úspěch s výhradou, ne chyba', () => {
    renderWithProviders(
      <SendingSettings
        providers={[ses]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{
          p1: {
            state: 'ok',
            detail: '',
            sandbox: true,
            providerStatus: 'degraded',
            blockers: ['sandbox'],
            region: 'eu-central-1',
            verifiedIdentities: ['brevio.cz'],
            verifiedIdentityCount: 1,
          },
        }}
      />,
    );
    const result = screen.getByTestId('test-result-p1');
    // Tón je varování, ne chyba: údaje jsou v pořádku, jen doručení je omezené.
    expect(result.querySelector('[data-tone="warning"]')).not.toBeNull();
    // Text hlídá slovník názvosloví (`packages/i18n/src/checks/glossary.ts`):
    // anglické „sandbox" se v rozhraní nepoužívá, mluví se o testovacím režimu.
    // Věta stojí v seznamu překážek, ne ve výsledku testu: je to vlastnost účtu,
    // která platí i po obnovení stránky, ne jednorázová odpověď na kliknutí.
    expect(screen.getByTestId('provider-blockers-p1')).toHaveTextContent(/testovacím režimu/);
    // A odznak se s tou větou nesmí rozejít.
    expect(screen.getByTestId('provider-status-p1')).toHaveAttribute('data-status', 'degraded');
  });

  it('nezdařené ověření SMTP řekne, co má uživatel opravit', () => {
    renderWithProviders(
      <SendingSettings
        providers={[smtp]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{
          p2: {
            state: 'failed',
            code: 'provider_smtp_auth_failed',
            reason: null,
            detail: '535 5.7.8 Authentication credentials invalid',
            providerStatus: 'unverified',
            blockers: ['credentials_invalid'],
            // SMTP server žádný region nemá. `null` je jediná pravdivá hodnota.
            region: null,
            verifiedIdentities: [],
            verifiedIdentityCount: null,
          },
        }}
      />,
    );
    const result = screen.getByTestId('test-result-p2');
    expect(result).toHaveTextContent(/odmítl jméno nebo heslo/);
    // Syrová odpověď serveru zůstává vidět vedle rady, ne místo ní.
    expect(result).toHaveTextContent(/535 5.7.8/);
    expect(result).not.toHaveTextContent('Ověření se nepodařilo a účet takhle odesílat nebude.');
  });

  it('u SES rozhoduje o radě důvod, ne kód: špatný region není špatný klíč', () => {
    renderWithProviders(
      <SendingSettings
        providers={[ses]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{
          p1: {
            state: 'failed',
            code: 'provider_credentials_invalid',
            reason: 'region',
            detail: 'getaddrinfo ENOTFOUND email.eu-cetnral-1.amazonaws.com',
            providerStatus: 'unverified',
            blockers: ['credentials_invalid'],
            region: 'eu-central-1',
            verifiedIdentities: [],
            verifiedIdentityCount: null,
          },
        }}
      />,
    );
    expect(screen.getByTestId('test-result-p1')).toHaveTextContent(/Region nesedí/);
  });

  it('neznámý důvod i neznámý kód spadnou na obecnou větu, nikdy na prázdno', () => {
    renderWithProviders(
      <SendingSettings
        providers={[ses]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{
          p1: {
            state: 'failed',
            code: 'internal_error',
            reason: 'co_to_je',
            detail: '',
            providerStatus: 'unverified',
            blockers: [],
            region: null,
            verifiedIdentities: [],
            verifiedIdentityCount: null,
          },
        }}
      />,
    );
    expect(screen.getByTestId('test-result-p1')).toHaveTextContent(
      'Ověření se nepodařilo a účet takhle odesílat nebude.',
    );
  });

  it('běžící ověření je vidět na tlačítku i u účtu', () => {
    renderWithProviders(
      <SendingSettings
        providers={[ses]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        verification={{ p1: { state: 'running' } }}
        onTestProvider={vi.fn()}
      />,
    );
    expect(screen.getByTestId('test-result-p1')).toHaveTextContent(/Ověřujeme/);
  });

  it('u každého účtu je tlačítko Upravit i Odebrat', async () => {
    const onEditProvider = vi.fn();
    const onDeleteProvider = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[ses, smtp]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onEditProvider={onEditProvider}
        onDeleteProvider={onDeleteProvider}
      />,
    );
    await userEvent.click(screen.getByTestId('edit-provider-p1'));
    await userEvent.click(screen.getByTestId('delete-provider-p2'));
    expect(onEditProvider).toHaveBeenCalledWith('p1');
    expect(onDeleteProvider).toHaveBeenCalledWith('p2');
  });

  it('tlačítko Nastavit jako výchozí se ukazuje jen u nevýchozího účtu', async () => {
    const onMakeDefault = vi.fn().mockResolvedValue({ status: 'success' });
    renderWithProviders(
      <SendingSettings
        providers={[
          {
            id: 'p1',
            name: 'Výchozí SES',
            type: 'ses',
            status: 'ready',
            is_default: true,
            config: { kind: 'ses', region: 'eu-central-1' },
            quota_max_24h: null,
            quota_sent_24h: null,
          },
          {
            id: 'p2',
            name: 'Záložní SMTP',
            type: 'smtp',
            status: 'ready',
            is_default: false,
            config: { kind: 'smtp', host: 'smtp.forpsi.com' },
            quota_max_24h: null,
            quota_sent_24h: null,
          },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onMakeDefault={onMakeDefault}
      />,
    );
    expect(screen.queryByTestId('make-default-p1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('make-default-p2'));
    expect(onMakeDefault).toHaveBeenCalledWith('p2');
  });

  it('tlačítko Přidat odesílací účet je i tam, kde už nějaký účet je', async () => {
    const onAddProvider = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[
          {
            id: 'p1',
            name: 'Výchozí SES',
            type: 'ses',
            status: 'ready',
            is_default: true,
            config: { kind: 'ses', region: 'eu-central-1' },
            quota_max_24h: null,
            quota_sent_24h: null,
          },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onAddProvider={onAddProvider}
      />,
    );
    await userEvent.click(screen.getByTestId('add-provider'));
    expect(onAddProvider).toHaveBeenCalledTimes(1);
  });

  it('prázdný stav volá tutéž obsluhu jako tlačítko v hlavičce', async () => {
    const onAddProvider = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onAddProvider={onAddProvider}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Přidat odesílací účet' }));
    expect(onAddProvider).toHaveBeenCalledTimes(1);
  });
});

describe('dialog pro nový odesílací účet', () => {
  function renderDialog(
    onSubmit = vi.fn().mockResolvedValue({ status: 'success', providerId: 'p9' }),
  ) {
    const onOpenChange = vi.fn();
    renderWithProviders(<AddProviderDialog open onOpenChange={onOpenChange} onSubmit={onSubmit} />);
    return { onSubmit, onOpenChange };
  }

  it('typ účtu je přepínač, ne rozbalovací seznam: obě volby jsou vidět naráz', () => {
    renderDialog();
    expect(screen.getByRole('radio', { name: 'Amazon SES' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Vlastní SMTP/ })).toBeInTheDocument();
    // Rozbalovací seznam typu by tady být neměl, jinak by se druhá volba schovala.
    expect(screen.queryByRole('combobox', { name: 'Typ účtu' })).not.toBeInTheDocument();
  });

  it('výchozí typ je SES a ukazuje klíče a region, ne SMTP pole', () => {
    renderDialog();
    expect(screen.getByRole('combobox', { name: 'Region u Amazonu' })).toBeInTheDocument();
    expect(screen.getByTestId('provider-access-key-id')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-host')).not.toBeInTheDocument();
  });

  /*
   * REGION JE VÝBĚR, NE VOLNÝ TEXT, a nic se nepředvybírá.
   *
   * Obojí je oprava naměřené vady: region se psal rukou, dialog nabízel
   * předvyplněný `eu-central-1` a uživatel ho odklikl, přestože měl adresy
   * ověřené v Severní Virginii. Tři různé pravdy o jednom účtu, čtyři dny
   * bez jediné odeslané zprávy.
   */
  it('region je výběr ze seznamu, ne textové pole', () => {
    renderDialog();
    expect(screen.getByRole('combobox', { name: 'Region u Amazonu' })).toBeInTheDocument();
    // Textové pole pro region tady být NESMÍ, jinak se překlep vrátí.
    expect(screen.queryByTestId('provider-region')).not.toBeInTheDocument();
  });

  it('nepředvybírá tiše žádný region', () => {
    renderDialog();
    expect(document.querySelector('input[name="provider-region"]')).toHaveValue('');
  });

  it('nabízí jen regiony, ve kterých SES doopravdy je, a doporučený označí', async () => {
    renderDialog();
    screen.getByRole('combobox', { name: 'Region u Amazonu' }).focus();
    await userEvent.keyboard('{Enter}');
    const options = screen.getAllByRole('option');
    // Počet se bere z datového souboru, ne z čísla natvrdo: seznam se
    // aktualizuje podle dokumentace AWS a test nemá zastarat dřív než on.
    expect(options).toHaveLength(sesRegions.regions.length);
    // Doporučený region je označený, ale je to jen návrh, ne předvolba.
    expect(screen.getByRole('option', { name: /Frankfurt.*doporučeno/ })).toBeInTheDocument();
    // Region, který má účet u Amazonu ve výchozím stavu vypnutý, se pozná hned.
    expect(screen.getByRole('option', { name: /Curych.*vypnutý/ })).toBeInTheDocument();
  });

  /*
   * Jméno z konzole AWS je ten údaj, podle kterého uživatel pozná, že se dívá
   * do správného regionu: vpravo nahoře v konzoli nestojí `eu-west-1`, ale
   * `Europe (Ireland)`. V popisku položky být nemůže, s ním rozbalený seznam
   * přetekl přes okraj dialogu (naměřeno snímkem), takže stojí pod výběrem.
   */
  it('u vybraného regionu ukáže jméno, pod kterým ho uživatel najde v konzoli AWS', async () => {
    renderDialog();
    expect(screen.queryByTestId('provider-region-console-name')).not.toBeInTheDocument();
    await pickRegion('provider-region', /Irsko/);
    expect(screen.getByTestId('provider-region-console-name')).toHaveTextContent(
      'V konzoli AWS se tenhle region jmenuje Europe (Ireland).',
    );
  });

  it('u regionu vypnutého u Amazonu poradí, že se musí nejdřív zapnout', async () => {
    renderDialog();
    await pickRegion('provider-region', /Curych/);
    expect(screen.getByTestId('provider-region-console-name')).toHaveTextContent(
      /zapněte v nastavení účtu AWS/,
    );
  });

  it('u výběru vysvětlí, co všechno je u Amazonu vázané na region', () => {
    renderDialog();
    const warning = screen.getByTestId('region-warning');
    expect(warning).toHaveTextContent(/ověřené adresy a domény/);
    expect(warning).toHaveTextContent(/testovací režim/);
    expect(warning).toHaveTextContent(/denní limit/);
    expect(warning).toHaveTextContent(/konfigurační sada/);
    expect(warning).toHaveTextContent(/DKIM/);
    // A kde ho v konzoli najde. Bez toho je požadavek „musí sedět" nesplnitelný.
    expect(warning).toHaveTextContent(/vpravo nahoře/);
  });

  it('bez vybraného regionu se účet neodešle', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('add-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    // Hláška se hledá celá: samotné „Vyberte region" je i text prázdného výběru,
    // takže by test prošel i tehdy, kdyby se žádná chyba neukázala.
    expect(
      screen.getByText(
        'Vyberte region. Musí to být ten, ve kterém máte u Amazonu ověřenou doménu nebo adresu.',
      ),
    ).toBeInTheDocument();
  });

  it('přepnutí na Vlastní SMTP vymění sadu polí', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /Vlastní SMTP/ }));
    expect(screen.getByTestId('provider-host')).toBeInTheDocument();
    expect(screen.getByTestId('provider-username')).toBeInTheDocument();
    expect(screen.getByTestId('provider-password')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-access-key-id')).not.toBeInTheDocument();
  });

  it('prázdný formulář se neodešle a řekne u kterého pole je problém', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.click(screen.getByTestId('add-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('Tohle pole je potřeba vyplnit.').length).toBeGreaterThan(0);
  });

  it('krátký přístupový klíč SES se neodešle: schéma jádra chce aspoň 16 znaků', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIA1');
    await userEvent.type(screen.getByTestId('provider-secret-access-key'), 'krátké');
    await userEvent.click(screen.getByTestId('add-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText('Musí mít aspoň 16 znaků.').length).toBe(2);
  });

  it('vyplněný SES účet odejde v tvaru, který přijímá POST /api/v1/providers', async () => {
    const { onSubmit, onOpenChange } = renderDialog();
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await pickRegion('provider-region', /Irsko/);
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('add-provider-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'ses',
      name: 'Firemní SES',
      region: 'eu-west-1',
      access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
    // Prázdná konfigurační sada se NEPOSÍLÁ ani jako prázdný řetězec.
    expect(Object.keys(onSubmit.mock.calls[0]![0])).not.toContain('configuration_set_name');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('vyplněný SMTP účet odejde s portem a šifrováním z výchozích hodnot schématu', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.click(screen.getByRole('radio', { name: /Vlastní SMTP/ }));
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SMTP');
    await userEvent.type(screen.getByTestId('provider-host'), 'smtp.wedos.net');
    await userEvent.type(screen.getByTestId('provider-username'), 'posta@kolo-shop.cz');
    await userEvent.type(screen.getByTestId('provider-password'), 'tajne-heslo');
    await userEvent.click(screen.getByTestId('add-provider-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'smtp',
      name: 'Firemní SMTP',
      host: 'smtp.wedos.net',
      port: 587,
      username: 'posta@kolo-shop.cz',
      password: 'tajne-heslo',
      encryption: 'starttls',
    });
  });

  it('chyba ze serveru se ukáže v dialogu a dialog zůstane otevřený', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'validation_failed',
      detail: 'Klíč Amazon neuznal.',
    });
    const { onOpenChange } = renderDialog(onSubmit);
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await pickRegion('provider-region', /Frankfurt/);
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('add-provider-submit'));

    expect(await screen.findByTestId('add-provider-error')).toHaveTextContent(
      'Klíč Amazon neuznal.',
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('dialog úpravy odesílacího účtu', () => {
  function renderEdit(
    provider: ProviderView,
    onSubmit = vi.fn().mockResolvedValue({ status: 'success', credentialsRotated: false }),
  ) {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <EditProviderDialog
        provider={provider}
        open
        onOpenChange={onOpenChange}
        onSubmit={onSubmit}
      />,
    );
    return { onSubmit, onOpenChange };
  }

  it('předvyplní, co server vrací, a tajemství nechá prázdná', () => {
    renderEdit(ses);
    expect(screen.getByTestId('edit-provider-name')).toHaveValue('Firemní SES');
    // Uložený region je ve výběru předvybraný. Tady předvolba SMYSL DÁVÁ:
    // je to hodnota, kterou uživatel opravdu má, ne náš odhad za něj.
    expect(document.querySelector('input[name="edit-provider-region"]')).toHaveValue(
      'eu-central-1',
    );
    expect(screen.getByTestId('edit-provider-configuration-set')).toHaveValue('mlain-eshop');
    // Maskovaná hodnota se do pole NEVKLÁDÁ, jinak by ji uživatel odeslal jako klíč.
    expect(screen.getByTestId('edit-provider-access-key-id')).toHaveValue('');
    expect(screen.getByTestId('edit-provider-secret-access-key')).toHaveValue('');
  });

  it('u prázdných tajemství vysvětlí, že se změní jen po vyplnění', () => {
    renderEdit(ses);
    expect(screen.getByText(/Teď je uložené AKIA\*\*\*\*MPLE/)).toBeInTheDocument();
    expect(screen.getByText(/Vyplňte jen, když měníte klíč/)).toBeInTheDocument();
  });

  it('samotné přejmenování pošle jen jméno, žádné tajemství', async () => {
    const { onSubmit, onOpenChange } = renderEdit(ses);
    await userEvent.clear(screen.getByTestId('edit-provider-name'));
    await userEvent.type(screen.getByTestId('edit-provider-name'), 'Hlavní SES');
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Hlavní SES' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('opravený region odejde, i když se klíče nemění', async () => {
    const { onSubmit } = renderEdit(ses);
    await pickRegion('edit-provider-region', /Irsko/);
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ region: 'eu-west-1' });
  });

  /*
   * ZMĚNA REGIONU U HOTOVÉHO ÚČTU. Zadavatel právě přepnul Frankfurt na Irsko
   * a přišel přitom o konfigurační sadu, ověřené identity i platnost DKIM
   * záznamů. Nedozvěděl se to předem, dozvěděl se to tím, že přestalo fungovat
   * odesílání. Dialog to proto říká dřív, než se klikne na Uložit.
   */
  it('při změně regionu řekne předem, o co uživatel přijde', async () => {
    renderEdit(ses);
    expect(screen.queryByTestId('region-change-warning')).not.toBeInTheDocument();

    await pickRegion('edit-provider-region', /Irsko/);
    const warning = screen.getByTestId('region-change-warning');
    expect(warning).toHaveTextContent(/Frankfurt \(eu-central-1\)/);
    expect(warning).toHaveTextContent(/Irsko \(eu-west-1\)/);
    expect(warning).toHaveTextContent(/Konfigurační sadu v novém regionu Amazon nemá/);
    expect(warning).toHaveTextContent(/Ověřené adresy a domény se mezi regiony nepřenášejí/);
    expect(warning).toHaveTextContent(/DKIM záznamy domény platí jen pro region/);
    expect(warning).toHaveTextContent(/Testovací režim i produkční přístup/);
  });

  it('vyměněný pár klíčů odejde celý', async () => {
    const { onSubmit } = renderEdit(ses);
    await userEvent.type(screen.getByTestId('edit-provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('edit-provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      access_key_id: 'AKIAIOSFODNN7EXAMPLE',
      secret_access_key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
  });

  it('půlka páru klíčů se neodešle: účet by přestal fungovat', async () => {
    const { onSubmit } = renderEdit(ses);
    await userEvent.type(screen.getByTestId('edit-provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(/vydávají v páru/).length).toBeGreaterThan(0);
  });

  it('u SMTP účtu jde vyměnit heslo bez zásahu do zbytku', async () => {
    const { onSubmit } = renderEdit(smtp);
    await userEvent.type(screen.getByTestId('edit-provider-password'), 'nove-heslo');
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ password: 'nove-heslo' });
  });

  it('beze změny se neposílá prázdný PATCH, řekne se to na místě', async () => {
    const { onSubmit } = renderEdit(smtp);
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-provider-error')).toHaveTextContent('Nic jste nezměnili');
  });

  it('chyba ze serveru zůstane v dialogu a dialog se nezavře', async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue({ status: 'error', code: 'validation_failed', detail: 'Region neznáme.' });
    const { onOpenChange } = renderEdit(ses, onSubmit);
    await userEvent.clear(screen.getByTestId('edit-provider-name'));
    await userEvent.type(screen.getByTestId('edit-provider-name'), 'Jiný název');
    await userEvent.click(screen.getByTestId('edit-provider-submit'));
    expect(await screen.findByTestId('edit-provider-error')).toHaveTextContent('Region neznáme.');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

describe('dialog odebrání odesílacího účtu', () => {
  function renderDelete(
    provider: ProviderView,
    onConfirm = vi.fn().mockResolvedValue({ status: 'success' }),
  ) {
    const onOpenChange = vi.fn();
    renderWithProviders(
      <DeleteProviderDialog
        provider={provider}
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );
    return { onConfirm, onOpenChange };
  }

  it('řekne, co se stane, ne jen „opravdu?"', () => {
    renderDelete(smtp);
    expect(screen.getByText(/nenávratně smažeme uložené přístupové údaje/)).toBeInTheDocument();
    expect(screen.getByText(/statistiky zůstanou/)).toBeInTheDocument();
    expect(screen.getByText(/naplánovaná kampaň, odebrat ho nepůjde/)).toBeInTheDocument();
  });

  it('u výchozího účtu varuje navíc, že žádný výchozí nezbude', () => {
    renderDelete(ses);
    expect(screen.getByTestId('delete-provider-default-warning')).toHaveTextContent(
      /žádný výchozí nezbude/,
    );
  });

  it('u nevýchozího účtu se varování o výchozím účtu neukazuje', () => {
    renderDelete(smtp);
    expect(screen.queryByTestId('delete-provider-default-warning')).not.toBeInTheDocument();
  });

  it('potvrzení zavolá akci a dialog zavře', async () => {
    const { onConfirm, onOpenChange } = renderDelete(smtp);
    await userEvent.click(screen.getByTestId('delete-provider-submit'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('rozpracovaná kampaň odebrání zablokuje a dialog to vysvětlí', async () => {
    const onConfirm = vi.fn().mockResolvedValue({ status: 'error', code: 'conflict', detail: '' });
    const { onOpenChange } = renderDelete(smtp, onConfirm);
    await userEvent.click(screen.getByTestId('delete-provider-submit'));
    expect(await screen.findByTestId('delete-provider-error')).toHaveTextContent(
      /běží nebo je naplánovaná kampaň/,
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('neznámý kód spadne na text ze serveru, nikdy na prázdno', async () => {
    const onConfirm = vi
      .fn()
      .mockResolvedValue({ status: 'error', code: 'internal_error', detail: 'Databáze mlčí.' });
    renderDelete(smtp, onConfirm);
    await userEvent.click(screen.getByTestId('delete-provider-submit'));
    expect(await screen.findByTestId('delete-provider-error')).toHaveTextContent('Databáze mlčí.');
  });
});

/**
 * REGION ÚČTU A CO V NĚM MÁ AMAZON OVĚŘENÉ.
 *
 * Tahle skupina hlídá tu vadu, která zadavatele stála čtyři dny: on měl adresy
 * ověřené v Severní Virginii, produkt odesílal z Frankfurtu a obrazovka o tom
 * mlčela. Od téhle chvíle musí umět odpovědět na obě otázky naráz, tedy
 * „odkud posíláme" a „máme tam vůbec něco ověřeného".
 */
describe('region účtu na obrazovce odesílání', () => {
  const inIreland: ProviderView = {
    ...ses,
    production_access: true,
    status_detail: {
      blockers: [],
      region: 'eu-west-1',
      verified_identities: ['brevio.cz', 'petr.novak@gmail.com'],
      verified_identity_count: 2,
    },
  };

  function renderList(provider: ProviderView) {
    renderWithProviders(
      <SendingSettings
        providers={[provider]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
      />,
    );
  }

  it('řekne, ve kterém regionu účet je, lidským jménem i zkratkou', () => {
    renderList(inIreland);
    const facts = screen.getByTestId('provider-region-facts-p1');
    expect(facts).toHaveTextContent('Účet je v regionu Irsko (eu-west-1).');
  });

  it('vypíše, co má Amazon ověřené právě v tom regionu', () => {
    renderList(inIreland);
    const facts = screen.getByTestId('provider-region-facts-p1');
    expect(facts).toHaveTextContent(/brevio\.cz/);
    expect(facts).toHaveTextContent(/petr\.novak@gmail\.com/);
  });

  it('u delšího seznamu vypíše první tři a zbytek shrne počtem', () => {
    renderList({
      ...inIreland,
      status_detail: {
        blockers: [],
        region: 'eu-west-1',
        verified_identities: ['a.cz', 'b.cz', 'c.cz', 'd.cz', 'e.cz'],
        verified_identity_count: 25,
      },
    });
    // Zkrácený výčet nese počet ÚPLNÝ, ne délku výčtu: účet zadavatele má
    // v Irsku 25 identit a stav účtu není adresář.
    expect(screen.getByTestId('provider-region-facts-p1')).toHaveTextContent(/22 dalších/);
  });

  /*
   * „Nevíme" a „nemáte tu nic" jsou dvě různé zprávy. Splést je znamená napsat
   * uživateli nejtvrdší možné tvrzení o účtu, který jsme si nepřečetli.
   */
  it('nezjištěný seznam se NEVYDÁVÁ za prázdný', () => {
    renderList({
      ...inIreland,
      status_detail: {
        blockers: [],
        region: 'eu-west-1',
        verified_identities: [],
        verified_identity_count: null,
      },
    });
    expect(screen.getByTestId('provider-region-facts-p1-unknown')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-region-facts-p1-none')).not.toBeInTheDocument();
  });

  it('účet bez ověření se o regionu vůbec nevyjadřuje', () => {
    renderList({ ...ses, status_detail: null });
    expect(screen.queryByTestId('provider-region-facts-p1')).not.toBeInTheDocument();
  });

  /*
   * HLASITÉ VAROVÁNÍ. Testovací režim bez jediné ověřené identity v regionu,
   * ze kterého odesíláme, znamená, že neodejde vůbec nic, ani zkušební zpráva
   * na vlastní adresu. Odrážka mezi ostatními poznámkami by tuhle zprávu
   * utopila, takže má vlastní hlášení.
   */
  it('testovací režim bez jediné ověřené adresy je hlasité varování, ne odrážka', () => {
    renderList({
      ...ses,
      production_access: false,
      status_detail: {
        blockers: ['sandbox', 'sandbox_no_identities'],
        region: 'eu-central-1',
        verified_identities: [],
        verified_identity_count: 0,
      },
    });
    const loud = screen.getByTestId('provider-region-facts-p1-blocked');
    expect(loud).toHaveTextContent(/Takhle neodejde vůbec nic|neodejde vůbec nic/);
    expect(loud).toHaveTextContent(/Frankfurt \(eu-central-1\)/);
    // A NESMÍ zároveň viset jako obyčejná odrážka: dvakrát řečená zeď se čte
    // jako dvě různé věci a uživatel hledá dvě příčiny místo jedné.
    const bullets = screen.getByTestId('provider-blockers-p1');
    expect(bullets.querySelector('[data-blocker="sandbox_no_identities"]')).toBeNull();
    expect(bullets.querySelector('[data-blocker="sandbox"]')).not.toBeNull();
  });

  it('ověření adresy u Amazonu se nabízí u SES, u SMTP ne', () => {
    const onVerifyIdentity = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[inIreland, smtp]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onVerifyIdentity={onVerifyIdentity}
      />,
    );
    expect(screen.getByTestId('verify-identity-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('verify-identity-p2')).not.toBeInTheDocument();
  });

  /*
   * Žádost o produkční přístup se nabízí JEN tehdy, když účet v testovacím
   * režimu prokazatelně je. U `null`, tedy „nevíme", by to bylo tvrzení
   * o stavu, který jsme si nepřečetli.
   */
  it('žádost o produkční přístup se nabízí jen u účtu v testovacím režimu', () => {
    const onRequestProductionAccess = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[
          { ...ses, id: 'p1', production_access: false },
          { ...ses, id: 'p3', production_access: true },
          { ...ses, id: 'p4', production_access: null },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onRequestProductionAccess={onRequestProductionAccess}
      />,
    );
    expect(screen.getByTestId('production-access-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('production-access-p3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('production-access-p4')).not.toBeInTheDocument();
  });

  /*
   * STAV ŽÁDOSTI O PRODUKČNÍ PŘÍSTUP.
   *
   * `production_access === false` je na otázku „jak to stojí" NEDOSTATEČNÁ
   * odpověď: platí stejně pro toho, kdo nikdy nežádal, pro toho, komu se žádost
   * posuzuje, i pro toho, komu ji Amazon zamítl. Dokud to obrazovka nerozlišila,
   * nabízela všem třem tentýž formulář a druhé odeslání skončilo chybou od
   * Amazonu místo vysvětlení předem.
   */
  it('u každého stavu žádosti řekne, jak to stojí', () => {
    renderWithProviders(
      <SendingSettings
        providers={[
          { ...ses, id: 'p1', production_access: false, review_status: null },
          { ...ses, id: 'p2', production_access: false, review_status: 'PENDING' },
          { ...ses, id: 'p3', production_access: false, review_status: 'DENIED' },
          { ...ses, id: 'p4', production_access: false, review_status: 'FAILED' },
          { ...ses, id: 'p5', production_access: true, review_status: 'GRANTED' },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
      />,
    );
    expect(screen.getByTestId('provider-review-status-p1')).toHaveTextContent(/zatím nežádali/);
    expect(screen.getByTestId('provider-review-status-p2')).toHaveTextContent(/posuzuje/);
    expect(screen.getByTestId('provider-review-status-p3')).toHaveTextContent(/zamítl/);
    expect(screen.getByTestId('provider-review-status-p4')).toHaveTextContent(/nedorazila/);
    expect(screen.getByTestId('provider-review-status-p5')).toHaveTextContent(/udělil/);
  });

  /*
   * U posuzované žádosti se tlačítko SKRÝVÁ, ne zašeďuje. Odeslat ji stejně
   * nejde, Amazon druhou odmítne (`ConflictException`), takže zašedlé pole by
   * slibovalo akci, která neexistuje. U zamítnuté a neodeslané se nabízí dál,
   * protože novou žádost Amazon přijme.
   */
  it('u posuzované žádosti se formulář nenabízí, u zamítnuté a neodeslané ano', () => {
    const onRequestProductionAccess = vi.fn();
    renderWithProviders(
      <SendingSettings
        providers={[
          { ...ses, id: 'p1', production_access: false, review_status: null },
          { ...ses, id: 'p2', production_access: false, review_status: 'PENDING' },
          { ...ses, id: 'p3', production_access: false, review_status: 'DENIED' },
          { ...ses, id: 'p4', production_access: false, review_status: 'FAILED' },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onRequestProductionAccess={onRequestProductionAccess}
      />,
    );
    expect(screen.getByTestId('production-access-p1')).toBeInTheDocument();
    expect(screen.queryByTestId('production-access-p2')).not.toBeInTheDocument();
    expect(screen.getByTestId('production-access-p3')).toBeInTheDocument();
    expect(screen.getByTestId('production-access-p4')).toBeInTheDocument();
  });

  /*
   * Amazon smí výčet rozšířit. Neznámý stav se NEPŘEKLÁDÁ na nejbližší známý:
   * radši o něm mlčíme, než abychom uživateli napsali nepravdu.
   */
  it('o neznámém stavu mlčí, místo aby si domýšlel', () => {
    renderList({ ...ses, production_access: false, review_status: 'SOMETHING_NEW' });
    expect(screen.queryByTestId('provider-review-status-p1')).not.toBeInTheDocument();
  });
});

/**
 * Ověření adresy odesílatele přímo z naší aplikace.
 *
 * Dialog musí říct tři věci, bez kterých je celá akce k ničemu: v jakém
 * REGIONU se ověřuje, kdo posílá potvrzovací e-mail, a že odkaz má omezenou
 * platnost.
 */
describe('dialog ověření adresy u Amazonu', () => {
  function renderIdentity(region: string | null = 'eu-west-1') {
    const onSubmit = vi.fn().mockResolvedValue({
      status: 'success',
      identity: {
        region: 'eu-west-1',
        email: 'petr@brevio.cz',
        status: 'pending',
        verified: false,
        already_existed: false,
      },
    });
    const onRefresh = vi.fn().mockResolvedValue({
      status: 'success',
      identity: {
        region: 'eu-west-1',
        email: 'petr@brevio.cz',
        status: 'verified',
        verified: true,
        already_existed: true,
      },
    });
    renderWithProviders(
      <VerifyIdentityDialog
        providerName="Firemní SES"
        region={region}
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        onRefresh={onRefresh}
      />,
    );
    return { onSubmit, onRefresh };
  }

  it('pojmenuje region, ve kterém ověření proběhne', () => {
    renderIdentity();
    expect(screen.getByTestId('identity-region')).toHaveTextContent(/Irsko \(eu-west-1\)/);
  });

  it('řekne, že potvrzovací e-mail posílá Amazon a odkaz má omezenou platnost', () => {
    renderIdentity();
    const note = screen.getByTestId('identity-who-sends');
    expect(note).toHaveTextContent(/posílá Amazon, ne my/);
    expect(note).toHaveTextContent(/omezenou platnost/);
  });

  it('nesmyslnou adresu neposílá k Amazonu vůbec', async () => {
    const { onSubmit } = renderIdentity();
    await userEvent.type(screen.getByTestId('identity-email'), 'tohle-není-adresa');
    await userEvent.click(screen.getByTestId('identity-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('po založení ukáže, že se čeká na potvrzení, a umí se doptat na stav', async () => {
    const { onSubmit, onRefresh } = renderIdentity();
    await userEvent.type(screen.getByTestId('identity-email'), 'petr@brevio.cz');
    await userEvent.click(screen.getByTestId('identity-submit'));

    expect(onSubmit).toHaveBeenCalledWith('petr@brevio.cz');
    expect(await screen.findByTestId('identity-status')).toHaveAttribute('data-status', 'pending');

    await userEvent.click(screen.getByTestId('identity-refresh'));
    expect(onRefresh).toHaveBeenCalledWith('petr@brevio.cz');
    expect(await screen.findByTestId('identity-status')).toHaveAttribute('data-status', 'verified');
  });
});

/**
 * Žádost o produkční přístup. Ověřeno v dokumentaci SESv2: `PutAccountDetails`
 * to umí a povinné jsou přesně dva údaje.
 */
describe('dialog žádosti o produkční přístup', () => {
  function renderProduction(
    onSubmit = vi.fn().mockResolvedValue({ status: 'success', region: 'eu-west-1' }),
  ) {
    renderWithProviders(
      <ProductionAccessDialog
        providerName="Firemní SES"
        region="eu-west-1"
        open
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    return { onSubmit };
  }

  it('řekne předem, co bude Amazon chtít vědět a co se bude dít', () => {
    renderProduction();
    const expectations = screen.getByTestId('production-access-expectations');
    expect(expectations).toHaveTextContent(/marketingovou, nebo transakční/);
    expect(expectations).toHaveTextContent(/adresu vašeho webu/);
    expect(expectations).toHaveTextContent(/posuzuje člověk z podpory AWS/);
    expect(expectations).toHaveTextContent(/nejde údaje změnit ani podat druhou žádost/);
    // Lhůtu NESLIBUJEME. Amazon uvádí 24 hodin jako obvyklé, ne zaručené, takže
    // by z naší věty byla lež pokaždé, když posouzení trvá dýl.
    expect(expectations).not.toHaveTextContent(/24 hodin/);
  });

  it('upozorní, že schválení platí jen pro region účtu', () => {
    renderProduction();
    expect(screen.getByTestId('production-access-region')).toHaveTextContent(
      /jen pro region Irsko \(eu-west-1\)/,
    );
  });

  it('bez adresy webu žádost neodešle: Amazon ji má jako povinnou', async () => {
    const { onSubmit } = renderProduction();
    await userEvent.click(screen.getByTestId('production-access-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('odešle druh pošty i adresu webu a po odeslání už nenabízí druhý pokus', async () => {
    const { onSubmit } = renderProduction();
    await userEvent.type(screen.getByTestId('production-access-website'), 'https://brevio.cz');
    await userEvent.click(screen.getByTestId('production-access-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      mailType: 'MARKETING',
      websiteUrl: 'https://brevio.cz',
      additionalContactEmails: [],
    });
    expect(await screen.findByTestId('production-access-sent')).toBeInTheDocument();
    // Druhá žádost během posuzování skončí u Amazonu na 409, takže tlačítko zmizí.
    expect(screen.queryByTestId('production-access-submit')).not.toBeInTheDocument();
  });

  it('probíhající posouzení vysvětlí vlastní větou, ne obecnou chybou', async () => {
    const onSubmit = vi.fn().mockResolvedValue({
      status: 'error',
      code: 'conflict',
      reason: 'production_access_review_in_progress',
      detail: '',
    });
    renderProduction(onSubmit);
    await userEvent.type(screen.getByTestId('production-access-website'), 'https://brevio.cz');
    await userEvent.click(screen.getByTestId('production-access-submit'));
    expect(await screen.findByTestId('production-access-error')).toHaveTextContent(
      /už jednu vaši žádost posuzuje/,
    );
  });
});
