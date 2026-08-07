import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { formats } from '@mlain/i18n/formats';
import { describe, expect, it, vi } from 'vitest';
import csCommon from '../../../../../packages/i18n/messages/cs/common.json';
import { JobDetail } from './job-detail';
import type { ApiJob } from './job-view';

vi.mock('@mlain/i18n/navigation', async () => {
  const react = await import('react');
  return {
    Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
      react.createElement('a', { href, ...rest }, children),
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
  };
});

const job: ApiJob = {
  id: 'i-1',
  kind: 'import',
  title: 'kveten.csv',
  status: 'running',
  done: 1240,
  total: 5000,
  started_by: 'Jana Nováková',
  started_at: '2026-08-07T10:00:00.000Z',
  updated_at: '2026-08-07T10:01:00.000Z',
  finished_at: null,
  note: null,
  can_cancel: true,
  stopping: false,
};

function renderDetail(overrides: Partial<ApiJob> = {}) {
  return render(
    <NextIntlClientProvider
      locale="cs"
      messages={{ common: csCommon }}
      formats={formats}
      timeZone="Europe/Prague"
    >
      <JobDetail job={{ ...job, ...overrides }} workspaceSlug="eshop-kolo" workspaceId="w-1" />
    </NextIntlClientProvider>,
  );
}

/**
 * Srovná všechny druhy mezer na obyčejnou.
 *
 * Oddělovačem tisíců je v češtině nezlomitelná mezera, a podle verze dat CLDR
 * buď U+00A0, nebo úzká U+202F. Bez tohohle srovnání by test měřil verzi ICU
 * v běhovém prostředí místo toho, jestli se číslo vůbec formátuje.
 */
function spaces(value: string): string {
  return value.replace(/\s/g, ' ');
}

describe('detail úlohy', () => {
  /**
   * Postup dostával HOLÁ ČÍSLA, takže na detailu stálo „1240 z 5000", zatímco
   * potvrzovací okno zastavení hned vedle psalo „1 240 z 5 000". Test měří
   * vykreslený text, ne to, čím se formátuje: kdyby se formátování jen přesunulo
   * jinam, musí pořád vyjít totéž.
   */
  it('postup má oddělovač tisíců, stejně jako potvrzovací okno vedle', () => {
    renderDetail();
    const text = document.body.textContent ?? '';
    expect(spaces(text)).toContain('1 240 z 5 000');
    expect(text).not.toContain('1240 z 5000');
  });

  it('bez známého celku se místo postupu píše, že se počet ještě počítá', () => {
    renderDetail({ total: 0, done: 12000 });
    expect(screen.getByText(/ještě počítá/i)).toBeInTheDocument();
    // I samotný počet zpracovaných řádků musí být čitelný.
    expect(spaces(document.body.textContent ?? '')).toContain('12 000');
  });

  /**
   * Pruh průběhu patří k NEDOKONČENÉ práci, ne jen k běžící: u pozastavené
   * úlohy je „kolik už je hotovo" ta informace, kvůli které se na detail chodí.
   */
  it('pozastavená úloha pruh průběhu má, dokončená ne', () => {
    const paused = renderDetail({ status: 'paused' });
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    paused.unmount();

    renderDetail({ status: 'completed', done: 5000, finished_at: '2026-08-07T11:00:00.000Z' });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
