// Matchery jest-dom se typují modulovou augmentací. Registruje je
// `apps/web/vitest.setup.ts`, jenže ten soubor vlastní P01 a v `tsconfig.json`
// není v `include`, takže `tsc` augmentaci nevidí. Import tady je typová
// oprava bez dopadu na chování: modul se stejně načítá v setupu.
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Problem } from '@/lib/api-client/problem';
import { ProblemBlock } from './problem-block';

const LABELS = {
  technicalDetails: 'Technické detaily',
  code: 'Kód',
  requestId: 'Číslo požadavku',
  time: 'Čas',
  copyBlock: 'Zkopírovat vše',
  copied: 'Zkopírováno',
  tryAgain: 'Zkusit znovu',
};

const PROBLEM: Problem = {
  type: 'https://docs.mlain.dev/errors/dependency_timeout',
  title: 'Dependency timeout',
  status: 504,
  detail: 'Databáze neodpověděla včas.',
  instance: '/api/v1/api-keys',
  code: 'dependency_timeout',
  request_id: 'req_01J8XK2M9P',
};

const OCCURRED_AT = '2026-07-31T12:32:07.000Z';

function renderBlock(problem: Problem = PROBLEM, onRetry?: () => void) {
  return render(
    <ProblemBlock
      problem={problem}
      title="Klíče k API se nepodařilo načíst"
      body="Většinou je to přechodné a druhý pokus projde."
      labels={LABELS}
      occurredAt={OCCURRED_AT}
      {...(onRetry ? { onRetry } : {})}
    />,
  );
}

describe('ProblemBlock', () => {
  it('ukáže nadpis, vysvětlení a tlačítko Zkusit znovu', () => {
    renderBlock(PROBLEM, vi.fn());
    expect(
      screen.getByRole('heading', { name: 'Klíče k API se nepodařilo načíst' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Většinou je to přechodné a druhý pokus projde.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('vykresluje ErrorBlock z design systému, ne vlastní kopii', () => {
    // Kdyby se blok začal kreslit znovu u sebe, tenhle test spadne
    // a upozorní dřív, než se obě verze rozejdou (uzávěr S3).
    expect(renderBlock().container.querySelector('[data-testid="error-block"]')).not.toBeNull();
  });

  it('drží kód chyby v atributu data-error-code kvůli testům', () => {
    const { container } = renderBlock();
    expect(container.querySelector('[data-error-code="dependency_timeout"]')).not.toBeNull();
  });

  it('technické detaily jsou sbalené a po rozbalení nesou kód, číslo požadavku a čas', async () => {
    renderBlock();
    // `Collapsible` z P05 stojí na Radixu, takže to není `<details>`.
    // Sbalený stav se pozná podle toho, že obsah v dokumentu není.
    expect(screen.queryByText('dependency_timeout')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.getByText('dependency_timeout')).toBeInTheDocument();
    expect(screen.getByText('req_01J8XK2M9P')).toBeInTheDocument();
    expect(screen.getByText(OCCURRED_AT)).toBeInTheDocument();
  });

  it('zkopíruje celý blok jedním tlačítkem, včetně čísla požadavku', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderBlock();
    await userEvent.click(screen.getByText('Technické detaily'));
    await userEvent.click(screen.getByRole('button', { name: 'Zkopírovat vše' }));
    const copied = writeText.mock.calls.at(-1)![0] as string;
    expect(copied).toContain('dependency_timeout');
    expect(copied).toContain('req_01J8XK2M9P');
    expect(copied).toContain('/api/v1/api-keys');
  });

  it('bez onRetry tlačítko Zkusit znovu nenabídne', () => {
    renderBlock();
    expect(screen.queryByRole('button', { name: 'Zkusit znovu' })).not.toBeInTheDocument();
  });

  it('u prázdného request_id nevymýšlí číslo (rozhodnutí R5)', async () => {
    renderBlock({ ...PROBLEM, request_id: '', code: 'service_unavailable' });
    await userEvent.click(screen.getByText('Technické detaily'));
    expect(screen.queryByText('req_01J8XK2M9P')).not.toBeInTheDocument();
  });
});
