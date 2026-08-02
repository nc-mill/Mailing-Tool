import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import providers from '../../../../../packages/core/data/dns-providers.json';
import presets from '../../../../../packages/core/data/smtp-presets.json';
import { AddProviderDialog } from './add-provider-dialog';
import { DnsRecords, type DnsRecord } from './dns-records';
import { DeliverabilityTiles } from './deliverability-tiles';
import { GuardThresholds } from './guard-thresholds';
import { SendingSettings } from './sending-settings';
import { renderWithProviders } from '../campaigns/test-utils';

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
    expect(screen.getByText(/Našli jsme dva SPF záznamy/)).toBeInTheDocument();
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
});

describe('dlaždice doručitelnosti', () => {
  const metrics = {
    bounce_rate: 0.062,
    complaint_rate: 0.0012,
    delivery_rate: 0.93,
    soft_rate: 0.01,
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

  it('test připojení zavolá akci a ukáže výsledek u správného účtu', async () => {
    const onTestProvider = vi
      .fn()
      .mockResolvedValue({ status: 'success', detail: 'Připojení funguje.' });
    renderWithProviders(
      <SendingSettings
        providers={[
          {
            id: 'p1',
            name: 'Firemní SES',
            type: 'ses',
            status: 'ready',
            is_default: true,
            config: { kind: 'ses', region: 'eu-central-1' },
            quota_max_24h: 50_000,
            quota_sent_24h: 100,
          },
        ]}
        domains={[]}
        guards={{}}
        limits={limits}
        basePath="/w/eshop"
        onTestProvider={onTestProvider}
      />,
    );
    await userEvent.click(screen.getByTestId('test-provider-p1'));
    expect(onTestProvider).toHaveBeenCalledWith('p1');
    expect(await screen.findByTestId('test-result-p1')).toHaveTextContent('Připojení funguje.');
  });

  it('nezdařený test připojení ukáže chybu, ne tichý neúspěch', async () => {
    const onTestProvider = vi
      .fn()
      .mockResolvedValue({ status: 'error', code: 'provider_smtp_auth_failed' });
    renderWithProviders(
      <SendingSettings
        providers={[
          {
            id: 'p1',
            name: 'Firemní SMTP',
            type: 'smtp',
            status: 'degraded',
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
        onTestProvider={onTestProvider}
      />,
    );
    await userEvent.click(screen.getByTestId('test-provider-p1'));
    expect(await screen.findByTestId('test-result-p1')).toHaveTextContent(
      'Připojení se nepodařilo ověřit.',
    );
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
    expect(screen.getByTestId('provider-region')).toBeInTheDocument();
    expect(screen.getByTestId('provider-access-key-id')).toBeInTheDocument();
    expect(screen.queryByTestId('provider-host')).not.toBeInTheDocument();
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

  it('region mimo tvar eu-central-1 se neodešle', async () => {
    const { onSubmit } = renderDialog();
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await userEvent.clear(screen.getByTestId('provider-region'));
    await userEvent.type(screen.getByTestId('provider-region'), 'Evropa');
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('add-provider-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText('Region se píše ve tvaru eu-central-1.')).toBeInTheDocument();
  });

  it('vyplněný SES účet odejde v tvaru, který přijímá POST /api/v1/providers', async () => {
    const { onSubmit, onOpenChange } = renderDialog();
    await userEvent.type(screen.getByTestId('provider-name'), 'Firemní SES');
    await userEvent.type(screen.getByTestId('provider-access-key-id'), 'AKIAIOSFODNN7EXAMPLE');
    await userEvent.type(
      screen.getByTestId('provider-secret-access-key'),
      'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    );
    await userEvent.click(screen.getByTestId('add-provider-submit'));

    expect(onSubmit).toHaveBeenCalledWith({
      type: 'ses',
      name: 'Firemní SES',
      region: 'eu-central-1',
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
