import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { GroupSentence } from '../../src/features/segments/group-sentence';

const renderWith = (messages: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ segments: messages }}>
      <GroupSentence op="and" not={false} onChange={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );

const cs = {
  builder: {
    groupSentence: 'Kontakty, které {polarity} {quantifier}',
    polarity: { match: 'splňují', notMatch: 'nesplňují' },
    quantifier: { all: 'všechny podmínky', any: 'alespoň jednu podmínku' },
    polarityLabel: 'splňují, nebo nesplňují',
    quantifierLabel: 'všechny podmínky, nebo alespoň jednu',
    negationHint: {
      andNot: 'Neplatí aspoň jedna z podmínek níž.',
      orNot: 'Neplatí ani jedna z podmínek níž.',
    },
  },
};

describe('group sentence', () => {
  it('renders the two selects inside the sentence, in the catalogue order', () => {
    renderWith(cs);
    const text = screen.getByTestId('group-sentence').textContent ?? '';
    expect(text.indexOf('Kontakty, které')).toBeLessThan(text.indexOf('splňují'));
    expect(text.indexOf('splňují')).toBeLessThan(text.indexOf('všechny podmínky'));
  });

  it('follows a locale that reorders the slots, without touching the component', () => {
    const reversed = {
      ...cs,
      builder: { ...cs.builder, groupSentence: '{quantifier} musí platit: {polarity}' },
    };
    renderWith(reversed);
    const text = screen.getByTestId('group-sentence').textContent ?? '';
    expect(text.indexOf('všechny podmínky')).toBeLessThan(text.indexOf('splňují'));
  });

  it('shows the explanation line for and plus not', () => {
    renderWith(cs, { op: 'and', not: true });
    expect(screen.getByText(/neplatí aspoň jedna/i)).toBeInTheDocument();
  });

  it('shows the explanation line for or plus not as well, not only for the third combination', () => {
    renderWith(cs, { op: 'or', not: true });
    expect(screen.getByText(/neplatí ani jedna/i)).toBeInTheDocument();
  });

  it('shows no explanation line when the group is not negated', () => {
    renderWith(cs, { op: 'and', not: false });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('never renders the words AND, OR, NOT or operator', () => {
    for (const combo of [
      { op: 'and', not: false },
      { op: 'or', not: false },
      { op: 'and', not: true },
      { op: 'or', not: true },
    ] as const) {
      const { unmount } = renderWith(cs, combo);
      const text = document.body.textContent ?? '';
      expect(text).not.toMatch(/\bAND\b|\bOR\b|\bNOT\b|operátor/i);
      unmount();
    }
  });
});
