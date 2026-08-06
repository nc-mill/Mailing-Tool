import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { AssistantPanelView } from './assistant-panel';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

describe('panel asistenta', () => {
  it('je panel, ne modální okno, takže nemá roli dialog', () => {
    wrap(<AssistantPanelView state={{ phase: 'idle' }} hasCredential brandName="Kolo Shop" />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('bez klíče ukáže vysvětlení a odkaz do nastavení, ne prázdné pole', () => {
    wrap(<AssistantPanelView state={{ phase: 'idle' }} hasCredential={false} brandName={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/potřebujete vlastní klíč od OpenAI/);
    expect(screen.getByRole('link', { name: 'Nastavit klíč' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Co má e-mail obsahovat/)).toBeNull();
  });

  it('s klíčem ukáže zadání, tón, jazyk a délku', () => {
    wrap(<AssistantPanelView state={{ phase: 'idle' }} hasCredential brandName="Kolo Shop" />);
    expect(screen.getByLabelText(/Co má e-mail obsahovat/)).toBeInTheDocument();
    expect(screen.getByLabelText('Tón')).toBeInTheDocument();
    expect(screen.getByLabelText('Jazyk')).toBeInTheDocument();
    expect(screen.getByLabelText('Délka')).toBeInTheDocument();
  });

  /**
   * Tlačítko „Změnit" vedle značky se odstranilo: byla to prázdná obsluha,
   * propa `onChangeBrand` se nikdy odnikud nepředávala a klik nedělal nic.
   * Test proto nově hlídá, že tam žádné tlačítko není, aby se mrtvé ovládání
   * nevrátilo. Změna značky patří na `/settings/brand`.
   */
  it('ukáže vybranou značku bez mrtvého tlačítka na její změnu', () => {
    wrap(<AssistantPanelView state={{ phase: 'idle' }} hasCredential brandName="Kolo Shop" />);
    expect(screen.getByText(/Značka: Kolo Shop/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Změnit' })).toBeNull();
  });

  it('při generování ukáže kroky, ne spinner', () => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'generating', step: 'compose' }}
        hasCredential
        brandName="Kolo Shop"
      />,
    );
    expect(screen.getAllByText('Skládáme e-mail').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('spinner')).toBeNull();
  });

  it('po dokončení nabídne návrh nechat nebo zkusit jinak', () => {
    wrap(<AssistantPanelView state={{ phase: 'done' }} hasCredential brandName="Kolo Shop" />);
    expect(screen.getByRole('button', { name: 'Nechat si ho' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit jinak' })).toBeInTheDocument();
  });

  it('chyba providera jmenuje providera a nabídne akci', () => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'error', code: 'ai_insufficient_credit', provider: 'OpenAI' }}
        hasCredential
        brandName={null}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/účtu u OpenAI došel kredit/);
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('rate limit hlásí automatické opakování s odpočtem', () => {
    wrap(
      <AssistantPanelView
        state={{
          phase: 'error',
          code: 'ai_rate_limited',
          provider: 'OpenAI',
          retryAfterSeconds: 20,
        }}
        hasCredential
        brandName={null}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/za 20 sekund automaticky/);
  });

  it('ukáže útratu za posledních 30 dní a odkaz na podrobnosti', () => {
    wrap(
      <AssistantPanelView
        state={{ phase: 'idle' }}
        hasCredential
        brandName={null}
        spendLabel="84 Kč"
      />,
    );
    expect(screen.getByText(/utratili asi 84 Kč/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Podrobnosti' })).toBeInTheDocument();
  });

  it('zastavení je dostupné během generování', () => {
    const onStop = vi.fn();
    wrap(
      <AssistantPanelView
        state={{ phase: 'generating', step: 'compose' }}
        hasCredential
        brandName={null}
        onStop={onStop}
      />,
    );
    screen.getByRole('button', { name: 'Zrušit' }).click();
    expect(onStop).toHaveBeenCalled();
  });

  it('odeslání předá zadání i tón, jazyk a délku', () => {
    const onSubmit = vi.fn();
    wrap(
      <AssistantPanelView
        state={{ phase: 'idle' }}
        hasCredential
        brandName={null}
        onSubmit={onSubmit}
      />,
    );
    screen.getByRole('button', { name: 'Vytvořit návrh' }).click();
    expect(onSubmit).toHaveBeenCalledWith({
      brief: '',
      tone: 'friendly',
      language: 'cs',
      length: 'medium',
    });
  });
});
