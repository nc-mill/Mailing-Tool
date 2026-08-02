import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csAi from '@mlain/i18n/messages/cs/ai.json';
import { CredentialList, type PublicCredential } from './credential-list';

const wrap = (ui: ReactNode) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ ai: csAi }} timeZone="Europe/Prague">
      {ui}
    </NextIntlClientProvider>,
  );

const credential = (overrides: Partial<PublicCredential> = {}): PublicCredential => ({
  id: 'c1',
  provider: 'anthropic',
  label: 'Hlavní klíč',
  key_hint: 'XYZW',
  base_url: null,
  default_model: 'claude-opus-5',
  default_credential: true,
  last_used_at: null,
  last_error_at: null,
  last_error_code: null,
  created_at: '2026-07-31T10:00:00.000Z',
  updated_at: '2026-07-31T10:00:00.000Z',
  ...overrides,
});

describe('seznam klíčů AI', () => {
  it('prázdný stav vysvětlí, že bez klíče funguje všechno ostatní', () => {
    wrap(<CredentialList credentials={[]} providers={[]} />);
    expect(
      screen.getByText(/potřebuje váš vlastní klíč. Bez něj funguje všechno ostatní/i),
    ).toBeInTheDocument();
  });

  it('prázdný stav nabídne odkazy na registraci u čtyř providerů', () => {
    wrap(
      <CredentialList
        credentials={[]}
        providers={[
          { id: 'anthropic', label: 'Anthropic', signupUrl: 'https://a.example' },
          { id: 'openai', label: 'OpenAI', signupUrl: 'https://b.example' },
          { id: 'google', label: 'Google', signupUrl: 'https://c.example' },
          { id: 'openrouter', label: 'OpenRouter', signupUrl: 'https://d.example' },
          // OpenAI-kompatibilní nemá kam poslat, prázdná adresa se neukazuje.
          { id: 'openai_compatible', label: 'Kompatibilní s OpenAI', signupUrl: '' },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  it('prázdný stav říká, že do promptu nejdou data kontaktů', () => {
    wrap(<CredentialList credentials={[]} providers={[]} />);
    expect(screen.getByText(/neposíláme data vašich kontaktů/)).toBeInTheDocument();
  });

  it('kritérium 66: v seznamu je jen nápověda o čtyřech znacích, nikdy klíč', () => {
    const { container } = wrap(<CredentialList credentials={[credential()]} providers={[]} />);
    expect(screen.getByText(/Končí na XYZW/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/sk-[a-z0-9-]{6,}/i);
  });

  it('klíč s poslední chybou má červený štítek, aby uživatel nemusel čekat na selhání', () => {
    wrap(
      <CredentialList
        credentials={[
          credential({
            default_credential: false,
            last_error_at: '2026-07-31T09:00:00.000Z',
            last_error_code: 'ai_invalid_credentials',
          }),
        ]}
        providers={[]}
      />,
    );
    const badge = screen.getByTestId('credential-error-c1');
    expect(badge).toHaveTextContent(/neplatný/i);
  });

  it('výchozí klíč je označený', () => {
    wrap(<CredentialList credentials={[credential()]} providers={[]} />);
    expect(screen.getByText('Výchozí')).toBeInTheDocument();
  });

  it('akce se nabízí jen tam, kde je obsluha, aby v UI nebyla mrtvá tlačítka', () => {
    wrap(<CredentialList credentials={[credential()]} providers={[]} />);
    expect(screen.queryByRole('button', { name: 'Smazat klíč' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Otestovat' })).toBeNull();
  });
});
