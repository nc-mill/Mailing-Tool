const PARAM = 'ml_token';

/**
 * Přečte ml_token a hned ho odstraní z adresního řádku.
 * Odstranění se dělá PŘED odesláním schválně: kdyby uživatel stránku sdílel
 * nebo kdyby se adresa dostala do analytiky třetí strany, token už tam nebude.
 * replaceState nevytváří položku v historii, takže tlačítko zpět funguje normálně.
 */
export function takeIdentityToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(PARAM);
  if (token === null || token === '') return null;

  url.searchParams.delete(PARAM);
  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${search === '' ? '' : `?${search}`}${url.hash}`,
  );
  return token;
}

export async function sendIdentityToken(input: {
  host: string;
  key: string;
  anonymousId: string;
  token: string;
  fetchImpl: typeof fetch;
  onIdentified: () => void;
}): Promise<void> {
  try {
    const response = await input.fetchImpl(`${input.host}/e/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        key: input.key,
        anonymous_id: input.anonymousId,
        token: input.token,
      }),
    });
    // Ve všech chybových případech uživatel na webu nic nepozná
    // a tracking pokračuje anonymně.
    if (response.ok) input.onIdentified();
  } catch {
    // Tiše pokračuje anonymně.
  }
}
