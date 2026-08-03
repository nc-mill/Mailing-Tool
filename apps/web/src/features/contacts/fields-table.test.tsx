import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldsTable, type ContactFieldRow } from './fields-table';
import { renderWithProviders } from './test-utils';

const loadImpact = vi.fn().mockResolvedValue({
  status: 'success',
  impact: {
    contacts_with_value: 8210,
    segments: [
      { id: 's1', name: 'Brno' },
      { id: 's2', name: 'VIP' },
    ],
    templates: [{ id: 't1', name: 'Newsletter', usages: 2 }],
    campaigns_scheduled: [],
    forms: [],
  },
});

vi.mock('@mlain/i18n/navigation', () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));

vi.mock('./actions', () => ({
  archiveFieldAction: vi.fn().mockResolvedValue({ status: 'success' }),
  deleteFieldAction: vi.fn().mockResolvedValue({ status: 'success' }),
  loadFieldImpactAction: (...args: unknown[]) => loadImpact(...args),
}));

const fields: ContactFieldRow[] = [
  { id: 'f-1', key: 'city', label: 'Město', type: 'text', indexed: true, archived: false },
  {
    id: 'f-2',
    key: 'orders',
    label: 'Objednávky',
    type: 'number',
    indexed: false,
    archived: false,
  },
];

function renderFields(props: Partial<React.ComponentProps<typeof FieldsTable>> = {}) {
  return renderWithProviders(
    <FieldsTable
      workspaceId="w-1"
      fields={fields}
      limits={{ fields: 100, indexed: 8 }}
      {...props}
    />,
  );
}

beforeEach(() => {
  loadImpact.mockClear();
});

describe('FieldsTable', () => {
  it('ukáže využití obou limitů', () => {
    renderFields();
    expect(screen.getByTestId('fields-usage')).toHaveTextContent('2 pole ze 100');
    expect(screen.getByTestId('fields-indexed-usage')).toHaveTextContent('1 zrychlené pole z 8');
  });

  it('na stropu polí nezešediví tlačítko, ale vysvětlí, co udělat', () => {
    renderFields({
      fields: Array.from({ length: 100 }, (_, index) => ({
        ...fields[0]!,
        id: `f${index}`,
        key: `k${index}`,
        indexed: false,
      })),
    });
    expect(screen.getByRole('button', { name: 'Přidat pole' })).not.toBeDisabled();
    expect(screen.getByText(/Nepoužívané pole nejdřív archivujte/)).toBeInTheDocument();
  });

  it('nabízí archivaci a vysvětlí, proč je bezpečnější', () => {
    renderFields();
    expect(screen.getAllByRole('button', { name: 'Archivovat' })).toHaveLength(2);
    expect(screen.getAllByText(/hodnoty zůstanou a segmenty dál fungují/).length).toBeGreaterThan(
      0,
    );
  });

  it('dialog smazání ukáže dopad z endpointu impact', async () => {
    const user = userEvent.setup();
    renderFields();
    await user.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);
    expect(loadImpact).toHaveBeenCalledWith({ workspaceId: 'w-1', id: 'f-1' });
    expect(await screen.findByText(/8\s210 kontaktů/)).toBeInTheDocument();
    expect(screen.getByText(/1 šablona pole používá/)).toBeInTheDocument();
    expect(screen.getByText(/2 segmenty na pole odkazují/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Archivovat místo smazání' })).toBeInTheDocument();
  });

  it('u pole drženého naplánovanou kampaní smazání nenabídne a řekne proč', async () => {
    const user = userEvent.setup();
    loadImpact.mockResolvedValueOnce({
      status: 'success',
      impact: {
        contacts_with_value: 10,
        segments: [],
        templates: [],
        campaigns_scheduled: [{ id: 'c1', name: 'Letní výprodej' }],
        forms: [],
      },
    });
    renderFields();
    await user.click(screen.getAllByRole('button', { name: 'Smazat' })[0]!);
    expect(
      await screen.findByText(/Pole používá naplánovaná kampaň Letní výprodej/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Smazat pole' })).toBeNull();
  });

  it('prázdný stav vysvětlí, k čemu vlastní pole jsou', () => {
    renderFields({ fields: [] });
    expect(
      screen.getByRole('heading', { name: 'Zatím tu není žádné vlastní pole' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Přidat první pole' })).toBeInTheDocument();
  });
});
