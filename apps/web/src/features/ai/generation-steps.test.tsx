import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { GenerationSteps, stepFromToolCalls } from './generation-steps';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

describe('odvození kroku z volání nástrojů', () => {
  it('bez volání jsme na prvním kroku', () => {
    expect(stepFromToolCalls([])).toBe('understand');
  });

  it('po listMergeTags jsme pořád na prvním kroku', () => {
    expect(stepFromToolCalls(['listMergeTags'])).toBe('understand');
  });

  it('po extractBrand máme barvy a logo', () => {
    expect(stepFromToolCalls(['listMergeTags', 'extractBrand'])).toBe('brand');
  });

  it('nástroj se v repozitáři jmenuje startBrandExtraction a musí platit taky', () => {
    expect(stepFromToolCalls(['startBrandExtraction'])).toBe('brand');
  });

  it('po composeTemplate skládáme e-mail', () => {
    expect(stepFromToolCalls(['composeTemplate'])).toBe('compose');
  });

  it('po dokončení se kontroluje odeslatelnost', () => {
    expect(stepFromToolCalls(['composeTemplate'], { finished: true })).toBe('validate');
  });
});

describe('zobrazení kroků', () => {
  it('ukáže všechny čtyři kroky a odhad doby, ne procenta', () => {
    wrap(<GenerationSteps current="compose" />);
    expect(screen.getByText('Rozumíme zadání')).toBeInTheDocument();
    expect(screen.getByText('Máme barvy a logo')).toBeInTheDocument();
    expect(screen.getAllByText('Skládáme e-mail').length).toBeGreaterThan(0);
    expect(screen.getByText('Kontrolujeme, že se dá odeslat')).toBeInTheDocument();
    expect(screen.getByText(/20 až 40 sekund/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('hotové kroky mají stav splněno, běžící probíhá', () => {
    wrap(<GenerationSteps current="compose" />);
    expect(screen.getByTestId('step-understand')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('step-compose')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('step-validate')).toHaveAttribute('data-state', 'pending');
  });

  it('průběh se hlásí do živé oblasti', () => {
    wrap(<GenerationSteps current="compose" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Skládáme e-mail');
  });

  it('nabídne zrušení', () => {
    wrap(<GenerationSteps current="compose" />);
    expect(screen.getByRole('button', { name: 'Zrušit' })).toBeInTheDocument();
  });
});
