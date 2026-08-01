import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ForbiddenState } from './forbidden-state';

describe('ForbiddenState', () => {
  it('pojmenuje chybějící oprávnění, roli i to, kdo ji změní', () => {
    render(
      <ForbiddenState
        title="K téhle akci vám chybí oprávnění"
        body="K akci je potřeba oprávnění campaigns:send, které má role Editor a výš. Vy máte roli Prohlížející."
        whoCanHelp="Změnit vám ji může Jana Nováková."
        code="forbidden"
        requestId="req_01J8XK2M9P"
      />,
    );
    expect(screen.getByText(/campaigns:send/)).toBeVisible();
    expect(screen.getByText(/Prohlížející/)).toBeVisible();
    expect(screen.getByText(/Jana Nováková/)).toBeVisible();
  });

  it('nese kód v DOM kvůli testům', () => {
    render(
      <ForbiddenState
        title="Chybí oprávnění"
        body="Potřeba je backups:read."
        code="forbidden"
        requestId="req_x"
      />,
    );
    expect(screen.getByTestId('forbidden-state')).toHaveAttribute('data-error-code', 'forbidden');
  });

  it('u API klíče použije kód insufficient_scope', () => {
    render(
      <ForbiddenState
        title="Klíč nemá potřebné oprávnění"
        body="Klíč potřebuje contacts:export."
        code="insufficient_scope"
        requestId="req_x"
      />,
    );
    expect(screen.getByTestId('forbidden-state')).toHaveAttribute(
      'data-error-code',
      'insufficient_scope',
    );
  });
});
